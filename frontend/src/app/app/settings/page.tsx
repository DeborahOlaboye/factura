"use client";

import { useState } from "react";
import { allocationsFromSplit, defaultSplit, PayoutModePicker, splitFromAllocations, SplitEditor, type Split } from "@/components/AllocationEditor";
import { Button, Notice } from "@/components/ui";
import { explorerAddress } from "@/lib/chain";
import { shortHex } from "@/lib/format";
import { useSavePayoutRules } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Freelancer, PayoutMode } from "@/lib/types";

const COUNTRY: Record<string, string> = { BR: "Brazil", AR: "Argentina", CO: "Colombia", OTHER: "Elsewhere" };

export default function Settings() {
  const { freelancer } = useSession();
  if (!freelancer) return null;
  // The form starts from the saved rules; keyed per profile so a different wallet gets a fresh form.
  return <SettingsForm key={freelancer.id} freelancer={freelancer} />;
}

function SettingsForm({ freelancer }: { freelancer: Freelancer }) {
  const save = useSavePayoutRules();
  const [mode, setMode] = useState<PayoutMode>(freelancer.payoutMode);
  const [split, setSplit] = useState<Split>(() =>
    freelancer.payoutMode === "managed" ? splitFromAllocations(freelancer.country, freelancer.allocations) : defaultSplit(freelancer.country),
  );
  const [saved, setSaved] = useState(false);

  return (
    <div className="mx-auto max-w-2xl rise">
      <h1 className="font-display text-5xl tracking-tight">Payouts</h1>
      <p className="mt-3 text-ink-2">Applies to invoices paid from now on. Invoices already paid keep the split they were paid with.</p>

      <dl className="sheet mt-8 grid grid-cols-2 gap-4 rounded-md p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink-3">Name</dt>
          <dd className="mt-0.5">{freelancer.name}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Country</dt>
          <dd className="mt-0.5">{COUNTRY[freelancer.country]}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-ink-3">Payout wallet</dt>
          <dd className="mt-0.5">
            <a href={explorerAddress(freelancer.wallet)} target="_blank" rel="noreferrer" className="figures text-accent hover:underline">
              {shortHex(freelancer.wallet)} ↗
            </a>
          </dd>
        </div>
      </dl>

      <form
        className="mt-10 space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          save.mutate({ payoutMode: mode, allocations: allocationsFromSplit(freelancer.country, mode, split) }, { onSuccess: () => setSaved(true) });
        }}
      >
        <PayoutModePicker mode={mode} onChange={setMode} />
        {mode === "managed" && (
          <section className="sheet rounded-md p-5 sm:p-6">
            <h2 className="mb-5 text-lg font-semibold">Split each payment</h2>
            <SplitEditor country={freelancer.country} split={split} onChange={setSplit} />
            <p className="mt-5 text-[13px] leading-relaxed text-ink-3">
              Each conversion is quoted on Textile FX and checked against the market rate first. If a quote is more than 1.5% off, that share
              is paid in dollars instead and the invoice says why.
            </p>
          </section>
        )}
        {save.error && <Notice tone="danger">{save.error.message}</Notice>}
        {saved && <Notice tone="ok">Saved. New payments follow this split.</Notice>}
        <Button type="submit" size="lg" busy={save.isPending}>
          Save
        </Button>
      </form>
    </div>
  );
}
