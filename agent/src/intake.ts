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
  amountUsd: z.number().positive().max(1_000_000),
  description: z.string().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type InvoiceDraft = z.infer<typeof draftSchema>;

export async function draftFromText(text: string, services: Services, today = new Date()): Promise<InvoiceDraft> {
  const reply = await services.complete(
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
  const parsed = draftSchema.safeParse(stripNulls(parseJsonObject(reply)));
  if (!parsed.success) {
    throw new Error(`could not read an invoice from that message: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return parsed.data;
}

function stripNulls(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== ""));
}
