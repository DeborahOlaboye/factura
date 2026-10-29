"use client";

import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover border border-transparent",
  secondary: "bg-sheet text-ink border border-rule-strong hover:border-ink",
  ghost: "bg-transparent text-ink-2 hover:text-ink border border-transparent",
  danger: "bg-transparent text-danger border border-danger/40 hover:bg-danger-soft",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none";
const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-[15px]", lg: "h-12 px-6 text-base" };

export function Button({
  variant = "primary",
  size = "md",
  busy,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes; busy?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || busy} className={`${base} ${sizes[size]} ${VARIANTS[variant]} ${className}`}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  size?: keyof typeof sizes;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${base} ${sizes[size]} ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Spinner() {
  return <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-[13px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[13px] text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-rule-strong bg-sheet px-3 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} h-10 ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} py-2.5 leading-relaxed ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} h-10 ${props.className ?? ""}`} />;
}

const PILL: Record<string, string> = {
  open: "bg-warn-soft text-warn",
  paid: "bg-accent-soft text-accent",
  settled: "bg-accent-soft text-accent",
  cancelled: "bg-rule text-ink-2",
  clear: "bg-accent-soft text-accent",
  review: "bg-warn-soft text-warn",
  block: "bg-danger-soft text-danger",
};

const PILL_LABEL: Record<string, string> = {
  open: "Awaiting payment",
  paid: "Paid · paying out",
  settled: "Paid",
  cancelled: "Cancelled",
  clear: "Client checks out",
  review: "Needs a look",
  block: "Blocked",
};

export function Pill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL[status] ?? "bg-rule text-ink-2"}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? PILL_LABEL[status] ?? status}
    </span>
  );
}

export function CopyButton({ value, label = "Copy link", className = "" }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          window.prompt("Copy this link", value);
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const cls = {
    info: "border-rule bg-sheet text-ink-2",
    warn: "border-warn/30 bg-warn-soft text-warn",
    danger: "border-danger/30 bg-danger-soft text-danger",
    ok: "border-accent/30 bg-accent-soft text-accent",
  }[tone];
  return <div className={`rounded-md border px-4 py-3 text-sm leading-relaxed ${cls}`}>{children}</div>;
}
