"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { api, ApiError, loadSession, saveSession, type Session } from "./api";
import type { Freelancer } from "./types";
import { useMounted } from "./useMounted";

interface SessionState {
  ready: boolean;
  session: Session | null;
  /** undefined while loading, null when the wallet has no profile yet */
  freelancer: Freelancer | null | undefined;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => void;
  setFreelancer: (f: Freelancer) => void;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const { address } = useConnection();
  const { mutateAsync: signMessage } = useSignMessage();
  // Read once on the client. Nothing renders from it before `mounted`, so SSR and hydration agree.
  const [stored, setStored] = useState<Session | null>(() => (typeof window === "undefined" ? null : loadSession()));
  const [profile, setProfile] = useState<{ wallet: string; value: Freelancer | null } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A session belongs to one wallet: switching accounts in the wallet ends it.
  const session = stored && (!address || stored.wallet.toLowerCase() === address.toLowerCase()) ? stored : null;
  const freelancer = session && profile && profile.wallet.toLowerCase() === session.wallet.toLowerCase() ? profile.value : undefined;

  useEffect(() => {
    if (stored && !session) saveSession(null);
  }, [stored, session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api<Freelancer>("/api/me", { token: session.token })
      .then((f) => !cancelled && setProfile({ wallet: session.wallet, value: f }))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setProfile({ wallet: session.wallet, value: null });
        else if (e instanceof ApiError && e.status === 401) {
          saveSession(null);
          setStored(null);
        } else setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setSigningIn(true);
    setError(null);
    try {
      const { nonce } = await api<{ nonce: string }>("/auth/nonce");
      const message = createSiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to Factura. This proves you own this wallet; it costs nothing and moves no funds.",
        uri: window.location.origin,
        version: "1",
        chainId: 42220,
        nonce,
      });
      const signature = await signMessage({ message });
      const res = await api<Session & { freelancer: Freelancer | null }>("/auth/verify", {
        method: "POST",
        body: JSON.stringify({ message, signature }),
      });
      const s = { token: res.token, wallet: res.wallet, expiresAt: res.expiresAt };
      saveSession(s);
      setProfile({ wallet: s.wallet, value: res.freelancer });
      setStored(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in failed";
      setError(/reject|denied/i.test(msg) ? "Signature request was declined." : msg.split("\n")[0]!);
    } finally {
      setSigningIn(false);
    }
  }, [address, signMessage]);

  const signOut = useCallback(() => {
    saveSession(null);
    setStored(null);
    setProfile(null);
  }, []);

  const setFreelancer = useCallback((f: Freelancer) => setProfile({ wallet: f.wallet, value: f }), []);

  const value = useMemo(
    () => ({ ready: mounted, session, freelancer, signingIn, error, signIn, signOut, setFreelancer }),
    [mounted, session, freelancer, signingIn, error, signIn, signOut, setFreelancer],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
