import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactEvmSchemeV1 } from "@x402/evm/exact/v1/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { LocalAccount } from "viem";
import type { Store } from "./store.ts";

/**
 * Paid calls into services Factura doesn't own, through the buy marketplace on Celo
 * (gateway.usebuy.ai) and Agent402.
 *
 * The agent pays the 402 challenges itself with an x402 client signing from the agent
 * wallet: the same wallet that holds the ERC-8004 identity. buy's gateway speaks x402 v1
 * (network "celo"), Agent402 speaks v2 (eip155:42220); both settle EIP-3009 transfers on
 * Celo, so the payer needs USDC but no CELO. We don't drive the `buy` CLI here because
 * its keystore needs an OS keychain on mainnet, which servers and containers don't have.
 *
 * Every call has a hard price cap (refused before signing if the quote is higher), the
 * agent has a daily budget, and every payment is logged with its settlement tx.
 */

export interface BuyRequest {
  service: string;
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  /** Hard cap in USD for this call; the client refuses to sign above it. */
  maxUsd: number;
  purpose: string;
  invoiceId?: string;
}

export interface BuyResult<T = unknown> {
  ok: boolean;
  data?: T;
  raw: string;
  settlementTx?: string;
  error?: string;
}

export class BudgetExceeded extends Error {}

export interface BuyOptions {
  signer: LocalAccount;
  dailyBudgetUsd: number;
}

export class Buy {
  constructor(
    private readonly store: Store,
    private readonly opts: BuyOptions,
  ) {}

  private payingFetch(maxUsd: number) {
    const client = new x402Client()
      .register("eip155:42220", new ExactEvmScheme(this.opts.signer))
      .registerV1("celo", new ExactEvmSchemeV1(this.opts.signer))
      .setSpendControls({ maxAmountPerPayment: `$${maxUsd}` });
    return wrapFetchWithPayment(fetch, client);
  }

  async call<T = unknown>(req: BuyRequest): Promise<BuyResult<T>> {
    const spent = this.store.spentTodayUsd();
    if (spent + req.maxUsd > this.opts.dailyBudgetUsd) {
      throw new BudgetExceeded(
        `daily buy budget reached (${spent.toFixed(3)} of ${this.opts.dailyBudgetUsd} USD spent)`,
      );
    }

    let res: Response;
    try {
      res = await this.payingFetch(req.maxUsd)(req.url, {
        method: req.method ?? "POST",
        headers: { accept: "application/json", ...(req.body !== undefined ? { "content-type": "application/json" } : {}) },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      // Refused before signing (over the cap, no matching scheme) or a network failure.
      return { ok: false, raw: "", error: err instanceof Error ? err.message : String(err) };
    }

    const settlementTx = settlementFrom(res.headers);
    const raw = await res.text();

    // A settled payment with a failed response is still money spent: log it either way.
    if (settlementTx || res.ok) {
      this.store.addPaidCall({
        at: new Date().toISOString(),
        service: req.service,
        url: req.url,
        maxUsd: req.maxUsd,
        settlementTx,
        purpose: req.purpose,
        invoiceId: req.invoiceId,
      });
    }

    let data: T | undefined;
    try {
      data = JSON.parse(raw) as T;
    } catch {
      // non-JSON body: returned raw
    }
    if (!res.ok) return { ok: false, data, raw, settlementTx, error: `HTTP ${res.status}${raw ? `: ${raw.slice(0, 160)}` : ""}` };
    return { ok: true, data, raw, settlementTx };
  }
}

/** Settlement tx from the x402 receipt header (v2 `PAYMENT-RESPONSE`, v1 `X-PAYMENT-RESPONSE`). */
export function settlementFrom(headers: Headers): string | undefined {
  const header = headers.get("PAYMENT-RESPONSE") ?? headers.get("X-PAYMENT-RESPONSE");
  if (!header) return undefined;
  try {
    const receipt = decodePaymentResponseHeader(header) as { success?: boolean; transaction?: string };
    return receipt.success !== false && receipt.transaction ? receipt.transaction : undefined;
  } catch {
    return undefined;
  }
}
