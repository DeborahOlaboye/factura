import type { Metadata } from "next";
import { Suspense } from "react";
import { Wordmark } from "@/components/Wordmark";
import { PayClient } from "./PayClient";

export const metadata: Metadata = {
  title: "Pay invoice",
  description: "Pay this Factura invoice in USA₮ on Celo.",
  robots: { index: false },
};

export default function PayPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark />
        <span className="text-[13px] text-ink-3">Secure payment · Celo</span>
      </header>
      <main className="flex-1 px-4 pb-16 sm:px-8">
        <Suspense fallback={<SheetSkeleton />}>
          <PayClient />
        </Suspense>
      </main>
    </div>
  );
}

function SheetSkeleton() {
  return (
    <div className="sheet mx-auto h-[540px] w-full max-w-[620px] animate-pulse rounded-[3px]" aria-busy="true" aria-label="Loading invoice" />
  );
}
