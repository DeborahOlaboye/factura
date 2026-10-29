import Link from "next/link";
import { InvoiceSheet, PaidStamp } from "@/components/InvoiceSheet";
import { ButtonLink } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";

const STEPS = [
  {
    n: "01",
    title: "Write it like a message",
    body: "“Bill Acme $1,200 for October backend work, due the 15th.” Factura drafts the invoice; you check it and send the link.",
  },
  {
    n: "02",
    title: "We check the client for you",
    body: "Before you start, the agent screens the company against the OFAC list and looks for a real footprint on LinkedIn and X.",
  },
  {
    n: "03",
    title: "They pay in USA₮",
    body: "Your client pays from a wallet or from their own agent. It settles on Celo in seconds. Sanctioned wallets are refused before money moves.",
  },
  {
    n: "04",
    title: "You choose the currency",
    body: "Keep dollars, or have part converted to reais or pesos on Textile FX, checked against the market rate. Every step is on-chain.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark />
        <nav className="flex items-center gap-1 text-sm sm:gap-4">
          <a href="#how" className="hidden px-2 py-1 text-ink-2 hover:text-ink sm:inline">
            How it works
          </a>
          <a href="#clients" className="hidden px-2 py-1 text-ink-2 hover:text-ink sm:inline">
            For clients
          </a>
          <ButtonLink href="/app" size="sm">
            Open dashboard
          </ButtonLink>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-24 lg:pt-14">
          <div className="rise">
            <p className="mb-5 text-[13px] font-medium uppercase tracking-[0.16em] text-accent">For freelancers in Brazil, Argentina &amp; Colombia</p>
            <h1 className="font-display text-[44px] leading-[1.02] tracking-tight sm:text-6xl lg:text-[76px]">
              Your US clients pay in seconds.
              <span className="italic text-ink-2"> Not in five business days.</span>
            </h1>
            <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-ink-2">
              Factura sends an invoice your client pays in USA₮, the regulated US dollar on Celo. The money lands in your wallet,
              in dollars or reais or pesos, split the way you choose.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/app" size="lg">
                Send your first invoice
              </ButtonLink>
              <a href="#clients" className="px-2 text-[15px] text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink">
                I&apos;m paying an invoice
              </a>
            </div>
          </div>

          <div className="relative rise [animation-delay:120ms]">
            <div aria-hidden className="absolute -inset-x-4 top-6 bottom-0 -rotate-2 rounded bg-rule/60" />
            <div className="relative">
              <InvoiceSheet
                data={{
                  number: "FAC-0042",
                  from: "Ana Souza · Backend engineering",
                  to: "Northwind Labs, Inc.",
                  description: "October: payments API, webhook retries and on-call cover",
                  total: "$4,800.00",
                  dueDate: "2026-11-15",
                  issued: "2026-11-01T12:00:00Z",
                }}
                stamp={<PaidStamp />}
                stub={
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
                    <StubFact label="Settled" value="in 4 seconds" />
                    <StubFact label="Kept in USA₮" value="$2,400.00" />
                    <StubFact label="Converted" value="R$ 12,009.60" />
                  </div>
                }
              />
            </div>
          </div>
        </section>

        <section id="how" className="border-y border-rule bg-sheet/60">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
            <h2 className="font-display text-4xl tracking-tight sm:text-5xl">How it works</h2>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="bg-sheet p-6">
                  <p className="figures text-sm text-accent">{s.n}</p>
                  <h3 className="mt-3 text-lg font-semibold leading-snug">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr] lg:gap-16">
            <div>
              <h2 className="font-display text-4xl tracking-tight sm:text-5xl">An international wire, line by line</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-ink-2">What a typical cross-border payment looks like next to Factura.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-[15px]">
                <thead>
                  <tr className="border-b-2 border-ink text-left text-[11px] uppercase tracking-[0.14em] text-ink-3">
                    <th className="py-2 font-semibold" />
                    <th className="py-2 font-semibold">Bank wire</th>
                    <th className="py-2 font-semibold text-accent">Factura</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:border-b [&_td]:border-rule [&_td]:py-3.5 [&_td]:pr-4">
                  <tr>
                    <td className="text-ink-2">Arrives</td>
                    <td>3–5 business days</td>
                    <td className="font-medium">Seconds, any day</td>
                  </tr>
                  <tr>
                    <td className="text-ink-2">Fees</td>
                    <td>Fixed fee per wire, often both sides</td>
                    <td className="font-medium">Client pays no gas · 0.01% FX fee when you convert</td>
                  </tr>
                  <tr>
                    <td className="text-ink-2">Exchange rate</td>
                    <td>Set by the bank, rarely shown</td>
                    <td className="font-medium">Market quote, rejected if it&apos;s off</td>
                  </tr>
                  <tr>
                    <td className="text-ink-2">Proof</td>
                    <td>A PDF from the bank</td>
                    <td className="font-medium">Every step on Celo, linkable</td>
                  </tr>
                  <tr>
                    <td className="text-ink-2">Client check</td>
                    <td>You find out when it bounces</td>
                    <td className="font-medium">Screened before you start</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="clients" className="bg-inverse text-inverse-ink">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:py-20">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.16em] text-inverse-accent">For US clients</p>
              <h2 className="mt-4 font-display text-4xl tracking-tight sm:text-5xl">Paying an invoice from Factura</h2>
              <p className="mt-5 max-w-[32rem] text-[15px] leading-relaxed text-inverse-ink/75">
                Open the link you were sent, connect a wallet holding USA₮ on Celo and approve one signature. You don&apos;t pay gas.
                USA₮ is issued by Anchorage Digital Bank under the GENIUS Act: a dollar your finance team can hold and account for.
              </p>
            </div>
            <div className="rounded-md border border-inverse-ink/15 bg-inverse-ink/5 p-6">
              <p className="text-sm font-medium">Paying from an agent or script</p>
              <p className="mt-2 text-sm text-inverse-ink/70">Every pay link is also an x402 endpoint. Any x402 client can settle it:</p>
              <pre className="figures mt-4 overflow-x-auto rounded bg-black/40 p-4 text-[13px] leading-relaxed text-[#cfe9db]">
                {`npx @celo/buy curl --token USAT \\
  --max-amount 4800 \\
  https://<factura-agent>/pay/<invoice-id>`}
              </pre>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-sm text-ink-3 sm:px-8">
          <p>Factura runs on Celo. Payments settle through Celo&apos;s x402 facilitator; conversions on Textile FX.</p>
          <div className="flex gap-4">
            <Link href="/backend/agent.json" className="hover:text-ink">
              Agent identity (ERC-8004)
            </Link>
            <Link href="/app" className="hover:text-ink">
              Dashboard
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function StubFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{label}</p>
      <p className="figures mt-0.5">{value}</p>
    </div>
  );
}
