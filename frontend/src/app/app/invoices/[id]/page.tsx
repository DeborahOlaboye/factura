import { Suspense } from "react";
import { InvoiceDetail } from "./InvoiceDetail";

export default function InvoicePage() {
  return (
    <Suspense fallback={<div className="h-[600px] animate-pulse rounded-md bg-rule/60" />}>
      <InvoiceDetail />
    </Suspense>
  );
}
