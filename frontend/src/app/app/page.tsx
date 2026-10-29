"use client";

import Link from "next/link";
import { useState } from "react";
import { ButtonLink, Pill } from "@/components/ui";
import { daysUntil, longDate, usd, usdNumber } from "@/lib/format";
import { useInvoices } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Invoice } from "@/lib/types";

export default function Dashboard() {
  const { freelancer } = useSession();
  const { data, isPending, error } = useInvoices();
  const invoices = data ?? [];

  const outstanding = sum(invoices.filter((i) => i.status === "open"));
  const [now] = useState(Date.now);
  const thirtyDays = now - 30 * 86_400_000;
  const received = sum(invoices.filter((i) => i.payment && Date.parse(i.payment.paidAt) > thirtyDays));
  const overdue = invoices.filter((i) => i.status === "open" && daysUntil(i.dueAt) < 0).length;

  return (
    <div className="rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-3">{freelancer?.name}</p>
          <h1 className="font-display text-5xl tracking-tight">Invoices</h1>
        </div>
        <ButtonLink href="/app/new">New invoice</ButtonLink>
      </div>

      <dl className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-rule bg-rule">
        <Stat label="Waiting to be paid" value={usdNumber(outstanding)} />
        <Stat label="Received, last 30 days" value={usdNumber(received)} />
        <Stat label="Overdue" value={String(overdue)} tone={overdue > 0 ? "warn" : undefined} />
      </dl>

      <section className="mt-10">
        {error ? (
          <p className="text-danger">{error.message}</p>
        ) : isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded bg-rule/70" />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <Empty />
        ) : (
          <>
            <ul className="sheet divide-y divide-rule overflow-hidden rounded-md sm:hidden">
              {invoices.map((inv) => (
                <MobileRow key={inv.id} inv={inv} />
              ))}
            </ul>
            <div className="sheet hidden overflow-hidden rounded-md sm:block">
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="border-b border-rule text-left text-[11px] uppercase tracking-[0.14em] text-ink-3">
                    <th className="px-5 py-3 font-semibold">Invoice</th>
                    <th className="px-5 py-3 font-semibold">Client</th>
                    <th className="px-5 py-3 font-semibold">Due</th>
                    <th className="px-5 py-3 text-right font-semibold">Amount</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <Row key={inv.id} inv={inv} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function dueLabel(inv: Invoice) {
  const days = daysUntil(inv.dueAt);
  return { days, text: inv.status !== "open" ? longDate(inv.dueAt) : days < 0 ? `${-days}d overdue` : days === 0 ? "Due today" : `Due in ${days}d` };
}

function MobileRow({ inv }: { inv: Invoice }) {
  const { days, text } = dueLabel(inv);
  return (
    <li>
      <Link href={`/app/invoices/${inv.id}`} className="block px-4 py-4 active:bg-paper/60">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[15px]">{inv.client.company ?? inv.client.name}</span>
          <span className="figures shrink-0">{usd(inv.amount)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
          <span className="figures text-ink-3">{inv.number}</span>
          <span className="flex items-center gap-2">
            <span className={inv.status === "open" && days < 0 ? "text-warn" : "text-ink-3"}>{inv.status === "open" ? text : ""}</span>
            <Pill status={inv.status} />
          </span>
        </div>
      </Link>
    </li>
  );
}

function Row({ inv }: { inv: Invoice }) {
  const { days, text: due } = dueLabel(inv);
  const href = `/app/invoices/${inv.id}`;
  return (
    <tr className="group relative border-b border-rule last:border-0 hover:bg-paper/60">
      <td className="px-5 py-4 align-top">
        <Link href={href} className="figures text-sm after:absolute after:inset-0">
          {inv.number}
        </Link>
      </td>
      <td className="px-5 py-4 align-top">
        <p>{inv.client.company ?? inv.client.name}</p>
        <p className="line-clamp-1 text-sm text-ink-3">{inv.description}</p>
      </td>
      <td className={`px-5 py-4 align-top text-sm ${inv.status === "open" && days < 0 ? "text-warn" : "text-ink-2"}`}>{due}</td>
      <td className="figures px-5 py-4 text-right align-top">{usd(inv.amount)}</td>
      <td className="px-5 py-4 align-top">
        <div className="flex flex-col items-start gap-1.5">
          <Pill status={inv.status} />
          {inv.vetting && inv.vetting.verdict !== "clear" && inv.status === "open" && (
            <Pill status={inv.vetting.verdict} />
          )}
        </div>
      </td>
    </tr>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="bg-sheet px-3 py-4 sm:px-5 sm:py-5">
      <dt className="text-[12px] leading-tight text-ink-3 sm:text-[13px]">{label}</dt>
      <dd className={`figures mt-1 text-lg sm:text-3xl ${tone === "warn" ? "text-warn" : ""}`}>{value}</dd>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center rounded-md border border-dashed border-rule-strong px-6 py-16 text-center">
      <div aria-hidden className="sheet relative h-24 w-20 -rotate-3 rounded-[2px]">
        <span className="absolute left-3 right-3 top-4 h-px bg-rule-strong" />
        <span className="absolute left-3 right-6 top-7 h-px bg-rule-strong" />
        <span className="absolute left-3 right-4 top-10 h-px bg-rule-strong" />
        <span className="absolute bottom-4 right-3 h-1.5 w-8 bg-ink" />
      </div>
      <h2 className="mt-6 font-display text-3xl">No invoices yet</h2>
      <p className="mt-2 max-w-sm text-ink-2">Describe the work in a sentence and Factura drafts the rest. Your client gets a link they can pay in seconds.</p>
      <ButtonLink href="/app/new" className="mt-6">
        Write your first invoice
      </ButtonLink>
    </div>
  );
}

function sum(list: Invoice[]) {
  return list.reduce((s, i) => s + Number(i.amount) / 1e6, 0);
}
