import type { ReactNode } from "react";
import { longDate, shortHex } from "@/lib/format";

export interface SheetData {
  number: string;
  from?: string;
  to: string;
  description: string;
  /** "$1,200.00" */
  total: string;
  dueDate: string;
  issued?: string;
  metaHash?: string;
}

/**
 * The invoice as a document. Used on the pay page, the dashboard detail and the live
 * preview while drafting. `stub` renders below a perforated tear line.
 */
export function InvoiceSheet({ data, stamp, stub }: { data: SheetData; stamp?: ReactNode; stub?: ReactNode }) {
  return (
    <article className="sheet relative mx-auto w-full max-w-[620px] rounded-[3px]">
      <div className="relative px-6 pb-7 pt-6 sm:px-10 sm:pb-9 sm:pt-9">
        {stamp && <div className="pointer-events-none absolute bottom-24 left-[30%] sm:bottom-20 sm:left-[34%]">{stamp}</div>}

        <header className="flex items-start justify-between gap-4 border-b border-ink pb-4">
          <div>
            <p className="font-display text-4xl leading-none sm:text-5xl">Invoice</p>
            <p className="figures mt-2 text-sm text-ink-2">{data.number}</p>
          </div>
          <div className="text-right text-[13px] leading-6 text-ink-2">
            {data.issued && (
              <p>
                Issued <span className="figures text-ink">{longDate(data.issued)}</span>
              </p>
            )}
            <p>
              Due <span className="figures text-ink">{longDate(`${data.dueDate}T12:00:00Z`)}</span>
            </p>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-6 py-6 text-sm">
          <div>
            <dt className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">From</dt>
            <dd className="text-[15px]">{data.from ?? "—"}</dd>
          </div>
          <div>
            <dt className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Bill to</dt>
            <dd className="text-[15px]">{data.to || "—"}</dd>
          </div>
        </dl>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-rule text-[11px] uppercase tracking-[0.14em] text-ink-3">
              <th className="py-2 text-left font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="align-top">
              <td className="py-4 pr-6 text-[15px] leading-relaxed">{data.description || "—"}</td>
              <td className="figures whitespace-nowrap py-4 text-right">{data.total}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-2 flex items-end justify-between border-t-2 border-ink pt-4">
          <div className="text-[12px] leading-5 text-ink-3">
            Settles in USA₮ on Celo
            {data.metaHash && (
              <>
                <br />
                <span className="figures">doc {shortHex(data.metaHash, 8, 6)}</span>
              </>
            )}
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Total due</p>
            <p className="figures text-3xl leading-tight sm:text-4xl">{data.total}</p>
          </div>
        </div>
      </div>

      {stub && (
        <>
          <div className="perforation" />
          <div className="px-6 py-6 sm:px-10 sm:py-7">{stub}</div>
        </>
      )}
    </article>
  );
}

export function PaidStamp({ animate }: { animate?: boolean }) {
  return (
    <div className={`stamp px-4 py-1.5 font-display text-4xl uppercase tracking-[0.12em] sm:text-5xl ${animate ? "stamp-in" : "opacity-90"}`}>
      Paid
    </div>
  );
}
