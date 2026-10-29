"use client";

import { useQuery } from "@tanstack/react-query";
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { useParams } from "next/navigation";
import { useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { celo } from "viem/chains";
import { useConnection, useReadContract, useSwitchChain, useWalletClient } from "wagmi";
import { InvoiceSheet, PaidStamp } from "@/components/InvoiceSheet";
import { Button, CopyButton, Notice } from "@/components/ui";
import { WalletButton } from "@/components/WalletButton";
import { api, ApiError } from "@/lib/api";
import { explorerTx, USAT } from "@/lib/chain";
import { longDate, shortHex, usdNumber } from "@/lib/format";
import type { PublicInvoice } from "@/lib/types";
import { useMounted } from "@/lib/useMounted";

type Phase = { kind: "idle" } | { kind: "signing" } | { kind: "settling" } | { kind: "done"; tx?: string } | { kind: "error"; message: string };

export function PayClient() {
  const { id } = useParams<{ id: string }>();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const inv = useQuery({
    queryKey: ["public-invoice", id],
    queryFn: () => api<PublicInvoice>(`/invoices/${id}`),
    refetchInterval: (q) => (phase.kind === "done" && q.state.data?.status !== "settled" ? 3_000 : false),
  });

  if (inv.isPending) return <div className="sheet mx-auto h-[540px] w-full max-w-[620px] animate-pulse rounded-[3px]" />;
  if (inv.isError) {
    const missing = inv.error instanceof ApiError && inv.error.status === 404;
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <p className="font-display text-4xl">{missing ? "Invoice not found" : "Couldn’t load this invoice"}</p>
        <p className="mt-3 text-ink-2">{missing ? "Check the link you were sent, or ask the sender for a new one." : inv.error.message}</p>
      </div>
    );
  }

  const data = inv.data;
  const paid = data.status === "paid" || data.status === "settled" || phase.kind === "done";
  const settlementTx = data.payment?.settlementTx ?? (phase.kind === "done" ? phase.tx : undefined);
  const amount = Number(data.amount);

  return (
    <div className="mx-auto max-w-[620px]">
      <InvoiceSheet
        data={{ number: data.number, from: data.from, to: data.to, description: data.description, total: usdNumber(amount), dueDate: data.dueDate, metaHash: data.metaHash }}
        stamp={paid ? <PaidStamp animate={phase.kind === "done"} /> : undefined}
        stub={
          data.status === "cancelled" ? (
            <Notice>This invoice was cancelled by the sender. Nothing is due.</Notice>
          ) : paid ? (
            <Receipt tx={settlementTx} paidAt={data.payment?.paidAt} payer={data.payment?.payer} amount={amount} />
          ) : (
            <PayStub id={id} amount={amount} x402Url={data.x402Url} phase={phase} setPhase={setPhase} onPaid={() => inv.refetch()} />
          )
        }
      />
      {!paid && data.status !== "cancelled" && <AgentPay url={data.x402Url} amount={amount} />}
    </div>
  );
}

function PayStub({
  id,
  amount,
  phase,
  setPhase,
  onPaid,
}: {
  id: string;
  amount: number;
  x402Url: string;
  phase: Phase;
  setPhase: (p: Phase) => void;
  onPaid: () => void;
}) {
  const { address, isConnected, chainId } = useConnection();
  const { data: walletClient } = useWalletClient();
  const { mutateAsync: switchChain, isPending: switching } = useSwitchChain();
  const balance = useReadContract({
    address: USAT.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: celo.id,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const mounted = useMounted();

  const balanceUsd = balance.data !== undefined ? Number(formatUnits(balance.data, USAT.decimals)) : undefined;
  const short = balanceUsd !== undefined && balanceUsd < amount;
  const wrongChain = isConnected && chainId !== celo.id;

  async function pay() {
    if (!walletClient || !address) return;
    setPhase({ kind: "signing" });
    try {
      // The wallet signs one EIP-3009 authorization for exactly this amount to exactly this payee.
      // Celo's facilitator submits it, so the payer needs no CELO for gas.
      const signer = {
        address,
        signTypedData: (m: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }) =>
          // x402 hands us generic EIP-712 data; viem's typed overloads can't infer it, so pass it through as-is.
          walletClient.signTypedData({ account: address, ...(m as unknown as Parameters<typeof walletClient.signTypedData>[0]) }),
      };
      const payFetch = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [{ network: "eip155:42220", client: new ExactEvmScheme(signer) }],
      });
      const res = await payFetch(`/backend/pay/${id}`, { headers: { accept: "application/json" } });
      setPhase({ kind: "settling" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `Payment was not accepted (HTTP ${res.status})`);
      }
      const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
      const receipt = header ? decodePaymentResponseHeader(header) : undefined;
      setPhase({ kind: "done", tx: receipt?.transaction });
      onPaid();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPhase({ kind: "error", message: /reject|denied|cancel/i.test(msg) ? "You declined the signature. Nothing was paid." : msg.split("\n")[0]! });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Pay with</p>
          <p className="mt-0.5 text-[15px]">
            USA₮ on Celo <span className="text-ink-3">· one signature, no gas</span>
          </p>
        </div>
        {mounted && isConnected && balanceUsd !== undefined && (
          <p className="figures text-sm text-ink-2">Balance {usdNumber(balanceUsd)}</p>
        )}
      </div>

      {phase.kind === "error" && <Notice tone="danger">{phase.message}</Notice>}
      {mounted && short && !wrongChain && (
        <Notice tone="warn">
          This wallet holds {usdNumber(balanceUsd!)} in USA₮. You need {usdNumber(amount)}. Add USA₮ on Celo from an exchange that
          supports it, or verified US users can claim their first USA₮ from Google Cloud&apos;s USA₮ faucet.
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!mounted || !isConnected ? (
          <WalletButton size="lg" />
        ) : wrongChain ? (
          <Button size="lg" busy={switching} onClick={() => switchChain({ chainId: celo.id }).catch(() => undefined)}>
            Switch to Celo
          </Button>
        ) : (
          <>
            <Button size="lg" onClick={pay} busy={phase.kind === "signing" || phase.kind === "settling"} disabled={short || !walletClient}>
              {phase.kind === "signing" ? "Confirm in your wallet" : phase.kind === "settling" ? "Settling on Celo" : `Pay ${usdNumber(amount)}`}
            </Button>
            <WalletButton size="sm" />
          </>
        )}
      </div>
    </div>
  );
}

function Receipt({ tx, paidAt, payer, amount }: { tx?: string; paidAt?: string; payer?: string; amount: number }) {
  return (
    <div className="rise">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Payment received</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="text-ink-3">Amount</dt>
          <dd className="figures mt-0.5 text-[15px]">{usdNumber(amount)} USA₮</dd>
        </div>
        <div>
          <dt className="text-ink-3">Date</dt>
          <dd className="figures mt-0.5 text-[15px]">{paidAt ? longDate(paidAt) : "Just now"}</dd>
        </div>
        {payer && (
          <div>
            <dt className="text-ink-3">From</dt>
            <dd className="figures mt-0.5 text-[15px]">{shortHex(payer)}</dd>
          </div>
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {tx ? (
          <a
            href={explorerTx(tx)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center rounded-md border border-rule-strong bg-sheet px-3 text-sm font-medium hover:border-ink"
          >
            Settlement {shortHex(tx)} ↗
          </a>
        ) : (
          <span className="text-sm text-ink-3">Waiting for the settlement record…</span>
        )}
        <Button variant="ghost" size="sm" onClick={() => window.print()}>
          Print receipt
        </Button>
      </div>
    </div>
  );
}

function AgentPay({ url, amount }: { url: string; amount: number }) {
  const cmd = `npx @celo/buy curl --token USAT --max-amount ${amount} ${url}`;
  return (
    <details className="mx-auto mt-6 max-w-[620px] rounded-md border border-rule bg-sheet/70 px-5 py-4 text-sm">
      <summary className="cursor-pointer select-none font-medium text-ink-2 hover:text-ink">Paying from an agent or the command line?</summary>
      <p className="mt-3 leading-relaxed text-ink-2">
        This invoice is an x402 resource. Any x402 client can pay it; with Celo&apos;s <span className="figures">buy</span> CLI:
      </p>
      <div className="mt-3 flex items-start gap-2">
        <pre className="figures flex-1 overflow-x-auto rounded bg-paper p-3 text-[12.5px] leading-relaxed">{cmd}</pre>
        <CopyButton value={cmd} label="Copy" />
      </div>
    </details>
  );
}
