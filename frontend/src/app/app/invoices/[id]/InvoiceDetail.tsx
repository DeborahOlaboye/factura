"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { InvoiceSheet, PaidStamp } from "@/components/InvoiceSheet";
import { Button, CopyButton, Notice, Pill, Spinner } from "@/components/ui";
import { explorerTx, TOKEN_LABEL } from "@/lib/chain";
import { longDate, shortHex, tokenAmount, usd } from "@/lib/format";
import { useCancelInvoice, useInvoice, useRevet } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Invoice } from "@/lib/types";

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { freelancer } = useSession();
  const { data: inv, isPending, error } = useInvoice(id);
  const cancel = useCancelInvoice(id);
  const revet = useRevet(id);

  if (isPending) return <div className="h-[600px] animate-pulse rounded-md bg-rule/60" />;
  if (error || !inv) {
    return (
      <div className="pt-10">
        <p className="font-display text-4xl">Invoice not found</p>
        <Link href="/app" className="mt-4 inline-block text-accent underline underline-offset-4">
          Back to invoices
        </Link>
      </div>
    );
  }

  const paid = inv.status === "paid" || inv.status === "settled";
  const reminders = inv.notes.filter((n) => n.startsWith("reminder:")).map((n) => ({ at: n.slice(9, 33), text: n.slice(34) }));
  const otherNotes = inv.notes.filter((n) => !n.startsWith("reminder:"));

  return (
    <div className="rise">
      <Link href="/app" className="text-sm text-ink-3 hover:text-ink">
        ← Invoices
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="figures text-3xl">{inv.number}</h1>
          <Pill status={inv.status} />
        </div>
        {inv.status === "open" && (
          <div className="flex flex-wrap gap-2">
            <CopyButton value={inv.payLink} label="Copy pay link" />
            <a href={inv.payLink} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-md border border-rule-strong bg-sheet px-3 text-sm font-medium hover:border-ink">
              Open pay page ↗
            </a>
            <Button
              variant="danger"
              size="sm"
              busy={cancel.isPending}
              onClick={() => window.confirm(`Cancel ${inv.number}? The pay link will stop working.`) && cancel.mutate()}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      {cancel.error && (
        <div className="mt-4">
          <Notice tone="danger">{cancel.error.message}</Notice>
        </div>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,560px)_1fr]">
        <InvoiceSheet
          data={{
            number: inv.number,
            from: freelancer?.name,
            to: inv.client.company ?? inv.client.name,
            description: inv.description,
            total: usd(inv.amount),
            dueDate: inv.dueAt.slice(0, 10),
            issued: inv.createdAt,
            metaHash: inv.metaHash,
          }}
          stamp={paid ? <PaidStamp /> : undefined}
        />

        <div className="space-y-6">
          <Card title="What happened">
            <Timeline inv={inv} />
          </Card>

          <Card title="Client check">
            {inv.vetting ? (
              <div>
                <Pill status={inv.vetting.verdict} />
                <p className="mt-3 text-[15px] leading-relaxed">{inv.vetting.summary}</p>
                {inv.vetting.verdict === "review" && inv.status === "open" && (
                  <Button variant="secondary" size="sm" className="mt-3" busy={revet.isPending} onClick={() => revet.mutate()}>
                    Run the check again
                  </Button>
                )}
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer select-none text-ink-3 hover:text-ink">
                    Raw lookups · {inv.vetting.costUsd > 0 ? `$${inv.vetting.costUsd.toFixed(3)} paid via buy` : "no paid calls"}
                  </summary>
                  <pre className="figures mt-2 max-h-64 overflow-auto rounded bg-paper p-3 text-[11.5px] leading-relaxed">
                    {JSON.stringify(inv.vetting.signals, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-ink-2">
                <Spinner /> Screening {inv.client.company ?? inv.client.name}…
              </p>
            )}
          </Card>

          {reminders.length > 0 && (
            <Card title="Reminder drafted">
              <p className="text-[13px] text-ink-3">{longDate(reminders.at(-1)!.at)}</p>
              <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">{reminders.at(-1)!.text}</p>
              <CopyButton value={reminders.at(-1)!.text} label="Copy text" className="mt-3" />
            </Card>
          )}

          {otherNotes.length > 0 && (
            <Card title="Notes from the agent">
              <ul className="space-y-2 text-sm text-ink-2">
                {otherNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sheet rounded-md p-5">
      <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{title}</h2>
      {children}
    </section>
  );
}

function Timeline({ inv }: { inv: Invoice }) {
  const items: { title: ReactNode; meta?: ReactNode; tx?: string; pending?: boolean }[] = [
    { title: `Issued for ${usd(inv.amount)}`, meta: longDate(inv.createdAt), tx: inv.ledgerTx },
  ];
  if (inv.status === "cancelled") items.push({ title: "Cancelled" });
  if (inv.payment) {
    items.push({ title: `Paid by ${shortHex(inv.payment.payer)}`, meta: `${longDate(inv.payment.paidAt)} · USA₮`, tx: inv.payment.settlementTx });
  } else if (inv.status === "open") {
    items.push({ title: "Waiting for the client to pay", pending: true });
  }
  for (const c of inv.conversions) {
    items.push({ title: `Converted ${tokenAmount(c.sell, c.sellAmount)} → ${tokenAmount(c.buy, c.buyAmount)}`, meta: "Textile FX", tx: c.txHash });
  }
  for (const p of inv.payouts) {
    items.push({ title: `${tokenAmount(p.symbol, p.amount)} sent to your wallet`, meta: TOKEN_LABEL[p.symbol], tx: p.txHash });
  }
  if (inv.status === "paid") items.push({ title: "Converting and paying out", pending: true });

  return (
    <ol className="relative space-y-5 border-l border-rule pl-5">
      {items.map((it, i) => (
        <li key={i} className="relative">
          <span
            aria-hidden
            className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 ${it.pending ? "border-warn bg-sheet" : "border-accent bg-accent"}`}
          />
          <p className="flex items-center gap-2 text-[15px]">
            {it.pending && <Spinner />}
            {it.title}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-ink-3">
            {it.meta && <span>{it.meta}</span>}
            {it.tx && (
              <a href={explorerTx(it.tx)} target="_blank" rel="noreferrer" className="figures text-accent hover:underline">
                {shortHex(it.tx)} ↗
              </a>
            )}
          </p>
        </li>
      ))}
    </ol>
  );
}
