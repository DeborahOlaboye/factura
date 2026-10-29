import Link from "next/link";

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-baseline gap-2 text-ink" aria-label="Factura home">
      <span aria-hidden className="relative top-[3px] inline-block h-5 w-4 border border-ink bg-sheet">
        <span className="absolute inset-x-[3px] top-[4px] h-px bg-ink" />
        <span className="absolute inset-x-[3px] top-[8px] h-px bg-ink" />
        <span className="absolute left-[3px] right-[6px] top-[12px] h-px bg-ink" />
      </span>
      <span className="font-display text-[26px] leading-none tracking-tight">Factura</span>
    </Link>
  );
}
