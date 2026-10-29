/**
 * Reference FX: what one US dollar stablecoin is worth in local currency on the open
 * market. Used to sanity-check Textile quotes before the agent fills one with a
 * freelancer's money. For ARS the crypto-dollar rate is the honest reference (the
 * official rate trades far from where people actually swap), so we take USD₮'s market
 * price per currency rather than a central-bank fixing.
 */

type Currency = "BRL" | "ARS" | "COP";

let cache: { at: number; rates: Partial<Record<Currency, number>> } | undefined;
const TTL_MS = 60_000;

export async function usdReference(currency: Currency): Promise<number | undefined> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), rates: await fetchRates() };
  }
  return cache.rates[currency];
}

async function fetchRates(): Promise<Partial<Record<Currency, number>>> {
  try {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=brl,ars,cop";
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    const body = (await res.json()) as { tether?: { brl?: number; ars?: number; cop?: number } };
    if (body.tether) return { BRL: body.tether.brl, ARS: body.tether.ars, COP: body.tether.cop };
  } catch {
    // fall through to the fixing
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(8_000) });
    const body = (await res.json()) as { rates?: Record<string, number> };
    return { BRL: body.rates?.BRL, ARS: body.rates?.ARS, COP: body.rates?.COP };
  } catch {
    return {};
  }
}

/** How much worse `quoted` is than `reference`, in bps. Negative means better. */
export function shortfallBps(quoted: number, reference: number): number {
  return Math.round(((reference - quoted) / reference) * 10_000);
}
