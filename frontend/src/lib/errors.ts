/**
 * Turn anything thrown or returned as an error into one readable line. Wallets and RPCs
 * don't agree on a shape: viem errors carry `shortMessage`, some providers reject with
 * plain `{ code, message }` objects, and APIs nest `{ error: { message } }`.
 */
export function errorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (typeof e === "string") return firstLine(e) || fallback;
  if (e && typeof e === "object") {
    const o = e as { shortMessage?: unknown; message?: unknown; error?: unknown; reason?: unknown; details?: unknown; code?: unknown };
    for (const candidate of [o.shortMessage, o.message, o.reason, o.details]) {
      if (typeof candidate === "string" && candidate.trim()) return firstLine(candidate);
    }
    if (o.error !== undefined) return errorMessage(o.error, fallback);
    if (o.code === 4001) return "Request rejected in the wallet.";
    try {
      const json = JSON.stringify(e);
      if (json && json !== "{}") return json.slice(0, 200);
    } catch {
      // circular: fall through
    }
  }
  return fallback;
}

/** User declined in the wallet (EIP-1193 4001, or the usual wording). */
export function isRejection(e: unknown): boolean {
  const code = (e as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === 4001 || /reject|denied|cancel/i.test(errorMessage(e, ""));
}

function firstLine(s: string) {
  return s.split("\n")[0]!.trim();
}
