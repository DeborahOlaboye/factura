"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { Button, ButtonLink, CopyButton, Field, Input, Notice, Textarea } from "@/components/ui";
import { usdNumber } from "@/lib/format";
import { useDraft, useIssueInvoice } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Draft, Invoice } from "@/lib/types";

const inTwoWeeks = () => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

const EMPTY = (): Draft => ({ clientName: "", amountUsd: 0, description: "", dueDate: inTwoWeeks() });

export default function NewInvoice() {
  const { freelancer } = useSession();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [amountText, setAmountText] = useState("");
  const [issued, setIssued] = useState<Invoice | null>(null);
  const drafter = useDraft();
  const issue = useIssueInvoice();

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  // USA₮ carries 6 decimals: anything that rounds to at least $0.000001 can be invoiced.
  const atomic = Math.round(draft.amountUsd * 1e6);
  const tooSmall = draft.amountUsd > 0 && atomic < 1;
  const tooPrecise = draft.amountUsd > 0 && Math.abs(draft.amountUsd * 1e6 - atomic) > 1e-6;
  const valid = draft.clientName.trim() && draft.description.trim() && atomic >= 1 && draft.dueDate >= new Date().toISOString().slice(0, 10);

  const preview = useMemo(
    () => ({
      number: "FAC-····",
      from: freelancer?.name,
      to: draft.company || draft.clientName,
      description: draft.description,
      total: usdNumber(draft.amountUsd || 0),
      dueDate: draft.dueDate,
      issued: new Date().toISOString(),
    }),
    [draft, freelancer],
  );

  if (issued) return <Issued inv={issued} onAnother={() => { setIssued(null); setDraft(EMPTY()); setAmountText(""); setText(""); }} />;

  return (
    <div className="rise">
      <h1 className="font-display text-5xl tracking-tight">New invoice</h1>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_minmax(0,560px)]">
        <div className="space-y-8">
          <section className="sheet rounded-md p-5 sm:p-6">
            <Field
              label="Describe it in a sentence"
              hint="Factura’s agent drafts the invoice from this. You review every field before anything is sent."
            >
              <Textarea
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            {drafter.error && (
              <div className="mt-3">
                <Notice tone="danger">{drafter.error.message}</Notice>
              </div>
            )}
            <Button
              variant="secondary"
              className="mt-4"
              busy={drafter.isPending}
              disabled={text.trim().length < 8}
              onClick={() =>
                drafter.mutate(text, {
                  onSuccess: (d) => {
                    setDraft({ ...EMPTY(), ...d });
                    setAmountText(d.amountUsd ? String(d.amountUsd) : "");
                  },
                })
              }
            >
              {drafter.isPending ? "Drafting" : "Draft it for me"}
            </Button>
          </section>

          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              issue.mutate(clean(draft), { onSuccess: setIssued });
            }}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Client contact name">
                <Input required value={draft.clientName} onChange={(e) => set("clientName", e.target.value)} />
              </Field>
              <Field label="Company">
                <Input value={draft.company ?? ""} onChange={(e) => set("company", e.target.value)} />
              </Field>
              <Field
                label="Amount (USD)"
                error={tooSmall ? "The smallest invoice is $0.000001, one unit of USA₮." : undefined}
                hint={tooPrecise ? "USA₮ has 6 decimals, so this is rounded to the nearest $0.000001." : undefined}
              >
                <Input
                  required
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, "");
                    setAmountText(v);
                    set("amountUsd", Number(v) || 0);
                  }}
                  className="figures"
                />
              </Field>
              <Field label="Due date">
                <Input required type="date" value={draft.dueDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => set("dueDate", e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="What it’s for">
                  <Textarea required rows={2} value={draft.description} onChange={(e) => set("description", e.target.value)} />
                </Field>
              </div>
            </div>

            <details className="rounded-md border border-rule px-4 py-3">
              <summary className="cursor-pointer select-none text-sm font-medium text-ink-2">
                Help Factura check this client <span className="font-normal text-ink-3">(recommended for new clients)</span>
              </summary>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <Field label="Client email">
                  <Input type="email" value={draft.clientEmail ?? ""} onChange={(e) => set("clientEmail", e.target.value)} />
                </Field>
                <Field label="X handle">
                  <Input value={draft.xHandle ?? ""} onChange={(e) => set("xHandle", e.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Company LinkedIn URL" hint="Used for the footprint check alongside the OFAC screen.">
                    <Input type="url" value={draft.linkedinUrl ?? ""} onChange={(e) => set("linkedinUrl", e.target.value)} />
                  </Field>
                </div>
              </div>
            </details>

            {issue.error && <Notice tone="danger">{issue.error.message}</Notice>}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" busy={issue.isPending} disabled={!valid}>
                Issue invoice
              </Button>
              <span className="text-[13px] text-ink-3">Recorded on Celo and ready to share.</span>
            </div>
          </form>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Preview</p>
          <InvoiceSheet data={preview} />
        </aside>
      </div>
    </div>
  );
}

function Issued({ inv, onAnother }: { inv: Invoice; onAnother: () => void }) {
  return (
    <div className="mx-auto max-w-xl pt-4 text-center rise">
      <p className="text-[13px] font-medium uppercase tracking-[0.16em] text-accent">Invoice {inv.number} issued</p>
      <h1 className="mt-3 font-display text-5xl tracking-tight">Send this link to your client</h1>
      <p className="mt-3 text-ink-2">They open it, connect a wallet with USA₮ and pay with one signature. You’ll see it here the moment it settles.</p>
      <div className="sheet mt-8 flex items-center gap-2 rounded-md p-2 pl-4 text-left">
        <span className="figures flex-1 truncate text-sm">{inv.payLink}</span>
        <CopyButton value={inv.payLink} />
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <ButtonLink href={`/app/invoices/${inv.id}`}>View invoice</ButtonLink>
        <Button variant="secondary" onClick={onAnother}>
          Write another
        </Button>
      </div>
      <p className="mt-8 text-[13px] text-ink-3">
        Factura is checking {inv.client.company ?? inv.client.name} in the background.{" "}
        <Link href={`/app/invoices/${inv.id}`} className="underline underline-offset-2">
          See the result
        </Link>
        .
      </p>
    </div>
  );
}

function clean(d: Draft): Draft {
  const out: Draft = { clientName: d.clientName.trim(), amountUsd: Math.round(d.amountUsd * 1e6) / 1e6, description: d.description.trim(), dueDate: d.dueDate };
  if (d.company?.trim()) out.company = d.company.trim();
  if (d.clientEmail?.trim()) out.clientEmail = d.clientEmail.trim();
  if (d.linkedinUrl?.trim()) out.linkedinUrl = d.linkedinUrl.trim();
  if (d.xHandle?.trim()) out.xHandle = d.xHandle.trim();
  return out;
}
