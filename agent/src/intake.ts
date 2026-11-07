import { z } from "zod";
import type { Services } from "./services.ts";
import { parseJsonObject } from "./vetting.ts";

/**
 * Turn a freelancer's one-line request ("bill Acme $1,200 for October backend work, due
 * the 15th, their LinkedIn is linkedin.com/company/acme") into a structured draft.
 * The draft is returned for confirmation, never auto-issued: amounts come from a model
 * and a freelancer should see them before a client does.
 */

export const draftSchema = z.object({
  clientName: z.string().min(1),
  company: z.string().optional(),
  clientEmail: z.string().email().optional(),
  linkedinUrl: z.string().url().optional(),
  xHandle: z.string().optional(),
  // USA₮ has 6 decimals, so the smallest invoice is one atomic unit: $0.000001.
  amountUsd: z.number().min(0.000001, "amount must be at least $0.000001").max(1_000_000, "amount must be at most $1,000,000"),
  description: z.string().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type InvoiceDraft = z.infer<typeof draftSchema>;

/** What the model may return: an amount of 0 means "not stated", for the freelancer to fill in. */
const parsedDraftSchema = draftSchema.extend({ amountUsd: z.number().min(0).max(1_000_000) });

export async function draftFromText(text: string, services: Services, today = new Date()): Promise<InvoiceDraft> {
  let reply: string;
  try {
    reply = await services.complete(
      [
        {
          role: "system",
          content:
            "Extract an invoice from the freelancer's message. Reply with JSON only, keys: " +
            "clientName, company?, clientEmail?, linkedinUrl?, xHandle?, amountUsd (number), description, dueDate (YYYY-MM-DD). " +
            `Today is ${today.toISOString().slice(0, 10)}. If no due date is given use 14 days from today. ` +
            "Omit optional keys you can't find. Never guess an amount: if none is stated, set amountUsd to 0.",
        },
        { role: "user", content: text.slice(0, 4_000) },
      ],
      "invoice intake: parse request",
    );
  } catch {
    // The model is a convenience, not a dependency: the freelancer reviews every field anyway.
    return draftLocally(text, today);
  }
  const parsed = parsedDraftSchema.safeParse(stripNulls(parseJsonObject(reply)));
  return parsed.success ? parsed.data : draftLocally(text, today);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A plain reading of the request for when the model is unavailable: whatever is clearly stated. */
export function draftLocally(text: string, today = new Date()): InvoiceDraft {
  const t = text.trim();
  const amount = t.match(/(?:\$|usd\s*|us\$)\s*([\d,]*\.?\d+)\s*(k)?|([\d,]*\.?\d+)\s*(k)?\s*(?:usd|dollars|usdt|usd₮)/i);
  const num = amount ? Number((amount[1] ?? amount[3] ?? "0").replace(/,/g, "")) * (amount[2] || amount[4] ? 1_000 : 1) : 0;
  const email = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  const linkedin = t.match(/(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/[^\s,;)]+/i)?.[0];
  const handle = t.replace(email ?? "", "").match(/(?:^|\s)@(\w{1,15})\b/)?.[1];
  const client =
    t.match(/\b(?:[Bb]ill|[Ii]nvoice|[Cc]harge)\s+@?([A-Z0-9][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)/)?.[1] ??
    t.match(/\b(?:bill|invoice|charge)\s+@?(\S+)/i)?.[1] ??
    "Client";
  const description = t.match(/\bfor\s+(.+?)(?:,|\.\s|\s+due\b|\s+in\s+\d+\s+days?\b|$)/i)?.[1]?.trim() ?? t.slice(0, 200);

  return {
    clientName: client.replace(/[.,;:]+$/, ""),
    ...(email ? { clientEmail: email } : {}),
    ...(linkedin ? { linkedinUrl: linkedin.startsWith("http") ? linkedin : `https://${linkedin}` } : {}),
    ...(handle ? { xHandle: `@${handle}` } : {}),
    amountUsd: Number.isFinite(num) && num <= 1_000_000 ? num : 0,
    description: description.slice(0, 200),
    dueDate: dueDateFrom(t, today),
  };
}

function dueDateFrom(text: string, today: Date): string {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (days: number) => iso(new Date(today.getTime() + days * 86_400_000));
  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (explicit) return explicit;
  const inDays = text.match(/\bin\s+(\d{1,3})\s+days?\b/i)?.[1];
  if (inDays) return plus(Number(inDays));
  const named = text.match(/\bdue\s+(?:on\s+)?(?:the\s+)?(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:of\s+)?([a-z]{3})[a-z]*)?)\b/i);
  if (named) {
    const month = MONTHS.indexOf((named[1] ?? named[4] ?? "").toLowerCase());
    const dayOfMonth = Number(named[2] ?? named[3]);
    if (dayOfMonth >= 1 && dayOfMonth <= 31 && (month >= 0 || !(named[1] ?? named[4]))) {
      const y = today.getUTCFullYear();
      const m = month >= 0 ? month : today.getUTCMonth();
      let d = new Date(Date.UTC(y, m, dayOfMonth));
      if (d.getTime() < today.getTime() - 86_400_000) d = new Date(Date.UTC(month >= 0 ? y + 1 : y, month >= 0 ? m : m + 1, dayOfMonth));
      return iso(d);
    }
  }
  return plus(14);
}

function stripNulls(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== ""));
}
