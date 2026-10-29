"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { useConnection } from "wagmi";
import { useSaveProfile } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useMounted } from "@/lib/useMounted";
import type { Country, PayoutMode } from "@/lib/types";
import { allocationsFromSplit, defaultSplit, PayoutModePicker, SplitEditor, type Split } from "./AllocationEditor";
import { Button, Field, Input, Notice, Select } from "./ui";
import { WalletButton } from "./WalletButton";
import { Wordmark } from "./Wordmark";

const NAV = [
  { href: "/app", label: "Invoices" },
  { href: "/app/new", label: "New invoice" },
  { href: "/app/settings", label: "Payouts" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { signOut, freelancer } = useSession();
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-8">
            <Wordmark href="/app" />
            {freelancer && (
              <Suspense fallback={null}>
                <AppNav variant="desktop" />
              </Suspense>
            )}
          </div>
          <WalletButton size="sm" onDisconnect={signOut} />
        </div>
        {freelancer && (
          <Suspense fallback={null}>
            <AppNav variant="mobile" />
          </Suspense>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 sm:py-10">
        <Gate>{children}</Gate>
      </main>
    </div>
  );
}

/** Reads the URL, so it sits behind Suspense: dynamic routes don't know it at prerender time. */
function AppNav({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/app" ? pathname === "/app" || pathname.startsWith("/app/invoices") : pathname.startsWith(href));
  if (variant === "mobile") {
    return (
      <nav className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`whitespace-nowrap rounded px-3 py-1.5 text-sm ${isActive(n.href) ? "bg-sheet text-ink" : "text-ink-2"}`}>
            {n.label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="hidden gap-1 md:flex">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`rounded px-3 py-1.5 text-sm ${isActive(n.href) ? "bg-sheet text-ink shadow-[inset_0_0_0_1px_var(--rule)]" : "text-ink-2 hover:text-ink"}`}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

/** Connect → sign in → create a profile → the app. */
function Gate({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const { isConnected, address } = useConnection();
  const { ready, session, freelancer, signIn, signingIn, error } = useSession();

  if (!mounted || !ready) return <PanelSkeleton />;

  if (!isConnected) {
    return (
      <Panel title="Connect the wallet you get paid to" step="1 of 2">
        <p>
          Factura uses your wallet as your account. Invoices are paid to it, and you sign in by signing a message. There&apos;s no
          password and no seed phrase leaves your wallet.
        </p>
        <div className="mt-6">
          <WalletButton size="lg" />
        </div>
        <p className="mt-5 text-[13px] text-ink-3">MetaMask, Rabby, Valora and MiniPay all work. You&apos;ll want Celo mainnet.</p>
      </Panel>
    );
  }

  if (!session) {
    return (
      <Panel title="Sign in with your wallet" step="2 of 2">
        <p>
          Signing proves you own <span className="figures text-ink">{address?.slice(0, 6)}…{address?.slice(-4)}</span>. It&apos;s free and
          moves no funds.
        </p>
        {error && (
          <div className="mt-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <Button size="lg" className="mt-6" busy={signingIn} onClick={signIn}>
          {signingIn ? "Check your wallet" : "Sign in"}
        </Button>
      </Panel>
    );
  }

  if (freelancer === undefined) return <PanelSkeleton />;
  if (freelancer === null) return <Onboarding />;
  return <>{children}</>;
}

function Onboarding() {
  const save = useSaveProfile();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState<Country>("BR");
  const [mode, setMode] = useState<PayoutMode>("managed");
  const [split, setSplit] = useState<Split>(defaultSplit("BR"));

  return (
    <div className="mx-auto max-w-2xl rise">
      <p className="text-[13px] font-medium uppercase tracking-[0.16em] text-accent">Welcome</p>
      <h1 className="mt-2 font-display text-5xl tracking-tight">Set up how you get paid</h1>
      <p className="mt-3 text-ink-2">This goes on your invoices and decides what lands in your wallet. You can change it any time.</p>

      <form
        className="mt-10 space-y-10"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ name: name.trim(), email: email.trim() || undefined, country, payoutMode: mode, allocations: allocationsFromSplit(country, mode, split) });
        }}
      >
        <section className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Name on your invoices" hint="Your name or your studio’s.">
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana Souza" maxLength={80} />
            </Field>
          </div>
          <Field label="Email (optional)" hint="Shown to clients on the invoice.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ana@studio.dev" />
          </Field>
          <Field label="Where you live">
            <Select
              value={country}
              onChange={(e) => {
                const c = e.target.value as Country;
                setCountry(c);
                setSplit(defaultSplit(c));
              }}
            >
              <option value="BR">Brazil</option>
              <option value="AR">Argentina</option>
              <option value="CO">Colombia</option>
              <option value="OTHER">Somewhere else</option>
            </Select>
          </Field>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold">When a client pays</h2>
          <PayoutModePicker mode={mode} onChange={setMode} />
        </section>

        {mode === "managed" && (
          <section className="sheet rounded-md p-5 sm:p-6">
            <h2 className="mb-5 text-lg font-semibold">Split each payment</h2>
            <SplitEditor country={country} split={split} onChange={setSplit} />
          </section>
        )}

        {save.error && <Notice tone="danger">{save.error.message}</Notice>}
        <Button size="lg" type="submit" busy={save.isPending} disabled={!name.trim()}>
          Save and continue
        </Button>
      </form>
    </div>
  );
}

function Panel({ title, step, children }: { title: string; step: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-lg pt-6 rise">
      <p className="figures text-[13px] text-ink-3">Step {step}</p>
      <h1 className="mt-2 font-display text-[44px] leading-[1.05] tracking-tight">{title}</h1>
      <div className="mt-4 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="mx-auto max-w-lg space-y-4 pt-6" aria-busy="true">
      <div className="h-4 w-20 animate-pulse rounded bg-rule" />
      <div className="h-12 w-4/5 animate-pulse rounded bg-rule" />
      <div className="h-20 animate-pulse rounded bg-rule" />
    </div>
  );
}
