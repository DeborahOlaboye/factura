"use client";

import type { Allocation, Country, PayoutMode, Symbol } from "@/lib/types";

const LOCAL: Record<Country, { symbol: Symbol; label: string; currency: string } | null> = {
  BR: { symbol: "wBRL", label: "Brazilian reais", currency: "wBRL" },
  CO: { symbol: "wCOP", label: "Colombian pesos", currency: "wCOP" },
  AR: { symbol: "wARS", label: "Argentine pesos", currency: "wARS" },
  OTHER: null,
};

export interface Split {
  local: number; // percent
  usdt: number; // percent
}

export function splitFromAllocations(country: Country, allocations: Allocation[]): Split {
  const local = LOCAL[country];
  const pct = (s: Symbol) => (allocations.find((a) => a.symbol === s)?.bps ?? 0) / 100;
  return { local: local ? pct(local.symbol) : 0, usdt: pct("USDT") };
}

export function allocationsFromSplit(country: Country, mode: PayoutMode, split: Split): Allocation[] {
  if (mode === "direct") return [{ symbol: "USAT", bps: 10_000 }];
  const local = LOCAL[country];
  const out: Allocation[] = [];
  const localBps = local ? Math.round(split.local * 100) : 0;
  const usdtBps = Math.round(split.usdt * 100);
  if (local && localBps > 0) out.push({ symbol: local.symbol, bps: localBps });
  if (usdtBps > 0) out.push({ symbol: "USDT", bps: usdtBps });
  const rest = 10_000 - localBps - usdtBps;
  if (rest > 0) out.push({ symbol: "USAT", bps: rest });
  return out;
}

export function defaultSplit(country: Country): Split {
  return country === "BR" ? { local: 50, usdt: 0 } : country === "CO" ? { local: 30, usdt: 0 } : country === "AR" ? { local: 0, usdt: 50 } : { local: 0, usdt: 0 };
}

export function PayoutModePicker({ mode, onChange }: { mode: PayoutMode; onChange: (m: PayoutMode) => void }) {
  const options: { value: PayoutMode; title: string; body: string }[] = [
    {
      value: "managed",
      title: "Convert for me",
      body: "Clients pay Factura’s agent, which converts part to your currency and forwards everything to your wallet in the same flow.",
    },
    {
      value: "direct",
      title: "Straight to my wallet",
      body: "Clients pay your wallet directly in USA₮. Factura never touches the money. You convert yourself, if at all.",
    },
  ];
  return (
    <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={mode === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md border p-4 text-left transition-colors ${mode === o.value ? "border-accent bg-accent-soft/60" : "border-rule-strong bg-sheet hover:border-ink"}`}
        >
          <span className="flex items-center gap-2 font-medium">
            <span aria-hidden className={`h-3.5 w-3.5 rounded-full border-2 ${mode === o.value ? "border-accent bg-accent" : "border-rule-strong"}`} />
            {o.title}
          </span>
          <span className="mt-1.5 block text-[13px] leading-relaxed text-ink-2">{o.body}</span>
        </button>
      ))}
    </div>
  );
}

export function SplitEditor({ country, split, onChange }: { country: Country; split: Split; onChange: (s: Split) => void }) {
  const local = LOCAL[country];
  const usat = Math.max(0, 100 - split.local - split.usdt);
  const set = (k: keyof Split, v: number) => {
    const other = k === "local" ? split.usdt : split.local;
    onChange({ ...split, [k]: Math.min(v, 100 - other) });
  };

  return (
    <div className="space-y-5">
      <div className="flex h-3 overflow-hidden rounded-full bg-rule" aria-hidden>
        {local && <div className="bg-accent transition-all" style={{ width: `${split.local}%` }} />}
        <div className="bg-ink-2 transition-all" style={{ width: `${split.usdt}%` }} />
        <div className="bg-[#c9b98f] transition-all" style={{ width: `${usat}%` }} />
      </div>

      {local && (
        <SliderRow
          label={`Convert to ${local.label}`}
          sub={local.currency}
          swatch="bg-accent"
          value={split.local}
          onChange={(v) => set("local", v)}
          warn={
            country === "AR" && split.local > 0
              ? "USD₮→wARS liquidity on Textile is thin right now. Anything that can’t be filled at a fair rate is paid in USD₮ instead."
              : undefined
          }
        />
      )}
      <SliderRow label="Convert to USD₮" sub="Tether, widely accepted on exchanges" swatch="bg-ink-2" value={split.usdt} onChange={(v) => set("usdt", v)} />
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#c9b98f]" />
          Keep in USA₮
        </span>
        <span className="figures">{usat}%</span>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  sub,
  swatch,
  value,
  onChange,
  warn,
}: {
  label: string;
  sub: string;
  swatch: string;
  value: number;
  onChange: (v: number) => void;
  warn?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${swatch}`} />
          {label} <span className="text-ink-3">· {sub}</span>
        </span>
        <span className="figures">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--accent)]"
        aria-label={label}
      />
      {warn && <p className="mt-1 text-[13px] text-warn">{warn}</p>}
    </div>
  );
}
