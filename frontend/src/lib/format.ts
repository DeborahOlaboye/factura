import { formatUnits } from "viem";
import { TOKEN_DECIMALS, TOKEN_LABEL } from "./chain";

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** USA₮ atomic units (6 dp) → "$1,200.00". */
export const usd = (atomic: string | bigint) => usdFmt.format(Number(formatUnits(BigInt(atomic), 6)));

export const usdNumber = (n: number) => usdFmt.format(n);

export function tokenAmount(symbol: string, atomic: string | bigint) {
  const n = Number(formatUnits(BigInt(atomic), TOKEN_DECIMALS[symbol] ?? 18));
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${TOKEN_LABEL[symbol] ?? symbol}`;
}

export const shortHex = (h: string, lead = 6, tail = 4) => (h.length > lead + tail + 2 ? `${h.slice(0, lead)}…${h.slice(-tail)}` : h);

export function longDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function daysUntil(iso: string, now = Date.now()) {
  return Math.ceil((Date.parse(iso) - now) / 86_400_000);
}
