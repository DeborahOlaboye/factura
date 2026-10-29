import { describe, expect, it } from "vitest";
import { settlementFrom } from "../src/buy.ts";
import { defaultAllocations } from "../src/factura.ts";
import { shortfallBps } from "../src/fx.ts";
import { invoiceId } from "../src/ledger.ts";
import { effectiveRate } from "../src/textile.ts";
import { planLegs, validateAllocations } from "../src/treasury.ts";
import { hasSanctionMatch, parseJsonObject } from "../src/vetting.ts";

const usd = (n: number) => BigInt(Math.round(n * 1e6));

describe("planLegs", () => {
  it("splits an invoice by allocation", () => {
    const legs = planLegs(usd(1200), [
      { symbol: "USAT", bps: 5000 },
      { symbol: "wBRL", bps: 5000 },
    ]);
    expect(legs).toEqual([
      { symbol: "USAT", usat: usd(600) },
      { symbol: "wBRL", usat: usd(600) },
    ]);
  });

  it("keeps rounding dust in USA₮ so the legs always add up", () => {
    const amount = 1_000_001n;
    const legs = planLegs(amount * 3n, [
      { symbol: "USDT", bps: 3333 },
      { symbol: "wBRL", bps: 3333 },
      { symbol: "USAT", bps: 3334 },
    ]);
    expect(legs.reduce((s, l) => s + l.usat, 0n)).toBe(amount * 3n);
  });

  it("folds legs under Textile's $1 floor into USA₮", () => {
    const legs = planLegs(usd(10), [
      { symbol: "USAT", bps: 9500 },
      { symbol: "wCOP", bps: 500 }, // $0.50, below the floor
    ]);
    expect(legs).toEqual([{ symbol: "USAT", usat: usd(10) }]);
  });
});

describe("validateAllocations", () => {
  it("requires a full 10000 bps", () => {
    expect(validateAllocations([{ symbol: "USAT", bps: 9000 }])).toMatch(/sum to 10000/);
    expect(validateAllocations([{ symbol: "USAT", bps: 10000 }])).toBeUndefined();
  });

  it("rejects tokens Factura can't pay out", () => {
    expect(validateAllocations([{ symbol: "USDC", bps: 10000 }])).toMatch(/unsupported/);
  });

  it("country defaults are valid", () => {
    for (const c of ["BR", "AR", "CO", "OTHER"] as const) {
      expect(validateAllocations(defaultAllocations(c))).toBeUndefined();
    }
  });
});

describe("x402 receipts", () => {
  const tx = `0x${"ab".repeat(32)}`;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

  it("reads the settlement tx from a v1 receipt header", () => {
    expect(settlementFrom(new Headers({ "X-PAYMENT-RESPONSE": b64({ success: true, transaction: tx, network: "celo" }) }))).toBe(tx);
  });

  it("reads the settlement tx from a v2 receipt header", () => {
    expect(settlementFrom(new Headers({ "PAYMENT-RESPONSE": b64({ success: true, transaction: tx, network: "eip155:42220" }) }))).toBe(tx);
  });

  it("ignores failed or missing receipts", () => {
    expect(settlementFrom(new Headers({ "PAYMENT-RESPONSE": b64({ success: false, transaction: tx }) }))).toBeUndefined();
    expect(settlementFrom(new Headers())).toBeUndefined();
  });
});

describe("vetting helpers", () => {
  it("detects sanctions matches in both response shapes", () => {
    expect(hasSanctionMatch({ verdict: "match", entity: "LAZARUS GROUP" })).toBe(true);
    expect(hasSanctionMatch({ matches: [{ name: "GAZPROM" }] })).toBe(true);
    expect(hasSanctionMatch({ matches: [], verdict: "no_match" })).toBe(false);
    expect(hasSanctionMatch(undefined)).toBe(false);
  });

  it("pulls a JSON object out of a chatty completion", () => {
    expect(parseJsonObject('Sure! {"verdict":"review","summary":"No footprint."} Hope that helps')).toEqual({
      verdict: "review",
      summary: "No footprint.",
    });
    expect(parseJsonObject("no json here")).toBeUndefined();
  });
});

describe("fx", () => {
  it("measures how far a quote is below the reference", () => {
    expect(shortfallBps(4.95, 5.0)).toBe(100);
    expect(shortfallBps(5.05, 5.0)).toBe(-100);
  });

  it("computes the effective rate across decimals", () => {
    // 100 USD₮ (6 dp) → 500 wBRL (18 dp)
    expect(effectiveRate(100_000_000n, 6, 500n * 10n ** 18n, 18)).toBeCloseTo(5);
  });
});

describe("invoiceId", () => {
  it("is deterministic per salt and distinct across deployments", () => {
    expect(invoiceId("FAC-0001", "a")).toBe(invoiceId("FAC-0001", "a"));
    expect(invoiceId("FAC-0001", "a")).not.toBe(invoiceId("FAC-0001", "b"));
  });
});
