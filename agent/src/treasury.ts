import type { Hex } from "viem";
import { shortfallBps, usdReference } from "./fx.ts";
import type { Ledger } from "./ledger.ts";
import type { Allocation, Conversion, Invoice, Payout, Store } from "./store.ts";
import { effectiveRate, TextileError, type Textile } from "./textile.ts";
import { TOKENS, type Symbol } from "./tokens.ts";

/** Textile's corridor floor is about $1 of notional; smaller legs fold into USA₮. */
const MIN_LEG_USD = 1_000_000n; // 1.00 in 6-decimal dollars

export interface Leg {
  symbol: Symbol;
  /** USA₮ (6 decimals) earmarked for this leg. */
  usat: bigint;
}

/**
 * Split an invoice's USA₮ across the freelancer's allocations. Rounding dust and any
 * leg below Textile's minimum notional stays in USA₮, so nothing is ever stranded.
 */
export function planLegs(amount: bigint, allocations: Allocation[]): Leg[] {
  const legs = new Map<Symbol, bigint>();
  let assigned = 0n;
  for (const a of allocations) {
    if (a.bps <= 0) continue;
    const share = (amount * BigInt(a.bps)) / 10_000n;
    if (a.symbol !== "USAT" && share < MIN_LEG_USD) continue;
    legs.set(a.symbol, (legs.get(a.symbol) ?? 0n) + share);
    assigned += share;
  }
  const rest = amount - assigned;
  if (rest > 0n) legs.set("USAT", (legs.get("USAT") ?? 0n) + rest);
  return [...legs].map(([symbol, usat]) => ({ symbol, usat })).filter((l) => l.usat > 0n);
}

export function validateAllocations(allocations: Allocation[]): string | undefined {
  const total = allocations.reduce((s, a) => s + a.bps, 0);
  if (total !== 10_000) return `allocations must sum to 10000 bps (got ${total})`;
  const supported: Symbol[] = ["USAT", "USDT", "wBRL", "wARS", "wCOP"];
  const bad = allocations.find((a) => !supported.includes(a.symbol));
  if (bad) return `unsupported payout token ${bad.symbol}`;
  return undefined;
}

interface Deps {
  textile: Textile;
  ledger: Ledger;
  store: Store;
  maxDeviationBps: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

/**
 * Managed payout for a paid invoice: USA₮ → USD₮ on Textile for every non-USA₮ leg,
 * then USD₮ → wFIAT per local leg, then forward each result to the freelancer through
 * the ledger. A leg that can't be filled at a fair price is paid in the best dollar
 * token already in hand instead, and the reason is written onto the invoice.
 */
export async function settleManaged(invoice: Invoice, allocations: Allocation[], deps: Deps) {
  const { textile, ledger, store, log } = deps;
  const id = invoice.id as Hex;
  const legs = planLegs(BigInt(invoice.amount), allocations);
  const payouts = new Map<Symbol, bigint>();
  const add = (s: Symbol, v: bigint) => payouts.set(s, (payouts.get(s) ?? 0n) + v);
  const note = (msg: string) => store.updateInvoice(id, (inv) => inv.notes.push(msg));
  const recordConversion = async (c: Conversion) => {
    store.updateInvoice(id, (inv) => inv.conversions.push(c));
    await ledger.recordConversion(
      id,
      TOKENS[c.sell].address,
      BigInt(c.sellAmount),
      TOKENS[c.buy].address,
      BigInt(c.buyAmount),
      c.txHash as Hex,
    );
  };

  // Step 1: one USA₮ → USD₮ swap covering every leg that needs dollars-on-Textile.
  const usatLeg = legs.find((l) => l.symbol === "USAT")?.usat ?? 0n;
  add("USAT", usatLeg);
  const needsUsdt = legs.filter((l) => l.symbol !== "USAT");
  const usdtIn = needsUsdt.reduce((s, l) => s + l.usat, 0n);

  let usdtOut = 0n;
  if (usdtIn > 0n) {
    const filled = await swap(textile, "USAT", "USDT", usdtIn, deps);
    if (filled) {
      usdtOut = BigInt(filled.buyAmount);
      await recordConversion(filled);
    } else {
      note(`USA₮→USD₮ not filled; ${fmt(usdtIn, 6)} USA₮ paid out as USA₮`);
      add("USAT", usdtIn);
    }
  }

  // Step 2: share the USD₮ across legs pro rata, convert local legs.
  if (usdtOut > 0n) {
    let remaining = usdtOut;
    for (const [i, leg] of needsUsdt.entries()) {
      const share = i === needsUsdt.length - 1 ? remaining : (usdtOut * leg.usat) / usdtIn;
      remaining -= share;
      if (leg.symbol === "USDT") {
        add("USDT", share);
        continue;
      }
      const filled = await swap(textile, "USDT", leg.symbol, share, deps);
      if (filled) {
        await recordConversion(filled);
        add(leg.symbol, BigInt(filled.buyAmount));
      } else {
        note(`USD₮→${leg.symbol} not filled at a fair price; ${fmt(share, 6)} USD₮ paid out as USD₮`);
        add("USDT", share);
      }
    }
  }

  // Step 3: forward everything. The ledger only ever pays the invoice's freelancer.
  const sent: Payout[] = [];
  for (const [symbol, amount] of payouts) {
    if (amount <= 0n) continue;
    const txHash = await ledger.payout(id, TOKENS[symbol].address, amount);
    sent.push({ symbol, amount: amount.toString(), txHash });
    log("payout sent", { invoice: invoice.number, symbol, amount: amount.toString(), txHash });
  }
  store.updateInvoice(id, (inv) => {
    inv.payouts.push(...sent);
    inv.status = "settled";
  });
  return sent;
}

async function swap(textile: Textile, sell: Symbol, buy: Symbol, amount: bigint, deps: Deps): Promise<Conversion | undefined> {
  const s = TOKENS[sell];
  const b = TOKENS[buy];
  try {
    const outcome = await textile.requestQuote(s.address, b.address, amount);
    if (outcome.status !== "quoted") {
      deps.log("no quote", { sell, buy, amount: amount.toString(), reason: outcome.reason });
      return undefined;
    }
    const q = outcome.quote;
    const rate = effectiveRate(BigInt(q.takerPays), s.decimals, BigInt(q.buyAmount), b.decimals);

    // Dollar-to-dollar legs should sit at ~1; local legs are checked against the market.
    const reference = b.currency === "USD" ? 1 : await usdReference(b.currency);
    if (reference) {
      const gap = shortfallBps(rate, reference);
      if (gap > deps.maxDeviationBps) {
        deps.log("quote rejected: too far from reference", { sell, buy, rate, reference, gapBps: gap });
        await textile.cancel(q).catch(() => undefined);
        return undefined;
      }
    }

    const fill = await textile.execute(q, s.address);
    return {
      sell,
      buy,
      sellAmount: fill.sellAmount,
      buyAmount: fill.buyAmount,
      rfqId: fill.rfqId,
      txHash: fill.txHash,
    };
  } catch (err) {
    const reason = err instanceof TextileError ? (err.reason ?? err.code) : undefined;
    deps.log("swap failed", { sell, buy, error: String(err), reason });
    return undefined;
  }
}

function fmt(v: bigint, decimals: number) {
  return (Number(v) / 10 ** decimals).toFixed(2);
}
