"use client";

import { useEffect, useRef, useState } from "react";
import { useMounted } from "@/lib/useMounted";
import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";
import { errorMessage } from "@/lib/errors";
import { shortHex } from "@/lib/format";
import { Button } from "./ui";

/** Connect / show the connected wallet. Renders nothing interactive until mounted to avoid hydration drift. */
export function WalletButton({ size = "md", onDisconnect }: { size?: "sm" | "md" | "lg"; onDisconnect?: () => void }) {
  const mounted = useMounted();
  const { address, isConnected } = useConnection();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!mounted) return <Button size={size} variant="secondary" disabled aria-hidden className="invisible">Connect wallet</Button>;

  if (isConnected && address) {
    return (
      <div className="relative" ref={menu}>
        <Button size={size} variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
          <span className="figures text-sm">{shortHex(address)}</span>
        </Button>
        {open && (
          <div className="sheet absolute right-0 z-20 mt-2 w-48 rounded-md p-1 text-sm">
            <button
              className="w-full rounded px-3 py-2 text-left hover:bg-paper"
              onClick={() => {
                navigator.clipboard?.writeText(address);
                setOpen(false);
              }}
            >
              Copy address
            </button>
            <button
              className="w-full rounded px-3 py-2 text-left text-danger hover:bg-paper"
              onClick={() => {
                onDisconnect?.();
                disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  const injected = connectors[0];
  const hasWallet = typeof window !== "undefined" && "ethereum" in window;
  return (
    <div className="flex flex-col items-start gap-1">
      {hasWallet && injected ? (
        <Button size={size} busy={isPending} onClick={() => connect({ connector: injected })}>
          Connect wallet
        </Button>
      ) : (
        <a
          href="https://metamask.io/download/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center rounded-md border border-rule-strong bg-sheet px-4 text-[15px] font-medium hover:border-ink"
        >
          Get a wallet
        </a>
      )}
      {error && <span className="text-xs text-danger">{errorMessage(error)}</span>}
    </div>
  );
}
