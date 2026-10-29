import { BudgetExceeded } from "./buy.ts";
import { PRICES, type Services } from "./services.ts";
import type { ClientInfo, VettingReport } from "./store.ts";

/**
 * Before a freelancer starts work for a new client, the agent checks that the client is
 * who they say they are and isn't sanctioned. A US company paying in USA₮ is a regulated
 * payment, so the OFAC screens are not optional; the footprint checks catch the classic
 * "new client, no history, wants work started today" scam that freelancers get hit by.
 */
export async function vetClient(client: ClientInfo, services: Services, invoiceId?: string): Promise<VettingReport> {
  const signals: Record<string, unknown> = {};
  let cost = 0;
  const company = client.company ?? client.name;

  const attempt = async <T>(
    key: string,
    price: number,
    fn: () => Promise<{ ok: boolean; data?: T; error?: string; settlementTx?: string }>,
  ) => {
    try {
      const res = await fn();
      if (res.settlementTx) cost += price;
      signals[key] = res.ok ? res.data : { error: res.error };
      return res.ok ? res.data : undefined;
    } catch (err) {
      if (err instanceof BudgetExceeded) signals[key] = { skipped: "daily budget reached" };
      else signals[key] = { error: String(err) };
      return undefined;
    }
  };

  const sanctions = await attempt("ofacName", PRICES.ofacName, () => services.sanctionsName(company, invoiceId));
  if (client.linkedinUrl || client.company) {
    await attempt("linkedin", PRICES.linkedinCompany, () =>
      services.linkedinCompany(client.linkedinUrl ? { url: client.linkedinUrl } : { search: company }, invoiceId),
    );
  }
  if (client.xHandle) {
    await attempt("x", PRICES.xProfile, () => services.xProfile(client.xHandle!, invoiceId));
  }

  const sanctionHit = hasSanctionMatch(sanctions);
  let verdict: VettingReport["verdict"] = sanctionHit ? "block" : "clear";
  let summary = sanctionHit
    ? `${company} matches an entry on the OFAC SDN list. Do not take this engagement.`
    : "";

  if (!sanctionHit) {
    try {
      const brief = await services.complete(
        [
          {
            role: "system",
            content:
              "You vet new clients for a freelancer. Given raw lookups, reply with JSON only: " +
              '{"verdict":"clear"|"review","summary":"<two sentences, plain language>"}. ' +
              'Use "review" when the company has no verifiable footprint, the footprint contradicts the name given, ' +
              "or anything looks like a scam. Never invent facts that aren't in the data.",
          },
          {
            role: "user",
            content: JSON.stringify({ client, lookups: truncate(signals) }),
          },
        ],
        "client vetting: risk brief",
        invoiceId,
      );
      cost += PRICES.cencori;
      const parsed = parseJsonObject(brief) as { verdict?: string; summary?: string } | undefined;
      verdict = parsed?.verdict === "review" ? "review" : "clear";
      summary = parsed?.summary ?? brief.slice(0, 400);
    } catch (err) {
      verdict = "review";
      summary = "The automatic check couldn’t finish just now. Look the client up yourself before starting work, or run the check again.";
      signals.briefError = String(err).slice(0, 200);
    }
  }

  return { at: new Date().toISOString(), verdict, summary, signals, costUsd: Number(cost.toFixed(4)) };
}

export function hasSanctionMatch(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as { matches?: unknown[]; verdict?: string; count?: number };
  if (r.verdict === "match") return true;
  return Array.isArray(r.matches) && r.matches.length > 0;
}

export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Keep the LLM prompt under Cencori's 32 KiB body limit. */
function truncate(signals: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(signals)) {
    const s = JSON.stringify(v) ?? "";
    out[k] = s.length > 6_000 ? `${s.slice(0, 6_000)}…` : v;
  }
  return out;
}
