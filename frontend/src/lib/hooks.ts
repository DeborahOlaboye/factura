"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useSession } from "./session";
import type { Allocation, Draft, Freelancer, Invoice, PayoutMode } from "./types";

export function useInvoices() {
  const { session } = useSession();
  return useQuery({
    queryKey: ["invoices", session?.wallet],
    queryFn: () => api<Invoice[]>("/api/me/invoices", { token: session!.token }),
    enabled: !!session,
    refetchInterval: 15_000,
  });
}

export function useInvoice(id: string) {
  const { session } = useSession();
  return useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api<Invoice>(`/api/me/invoices/${id}`, { token: session!.token }),
    enabled: !!session,
    // Fast while money is moving (payment pending, payout in progress), slow otherwise.
    refetchInterval: (q) => (q.state.data?.status === "paid" ? 3_000 : q.state.data?.status === "open" ? 8_000 : false),
  });
}

export function useDraft() {
  const { session } = useSession();
  return useMutation({
    mutationFn: (text: string) => api<Draft>("/api/me/invoices/draft", { method: "POST", token: session!.token, body: JSON.stringify({ text }) }),
  });
}

export function useIssueInvoice() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: Draft) => api<Invoice>("/api/me/invoices", { method: "POST", token: session!.token, body: JSON.stringify(draft) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
}

export function useCancelInvoice(id: string) {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Invoice>(`/api/me/invoices/${id}/cancel`, { method: "POST", token: session!.token }),
    onSuccess: (inv) => {
      qc.setQueryData(["invoice", id], inv);
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useRevet(id: string) {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/me/invoices/${id}/vet`, { method: "POST", token: session!.token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice", id] }),
  });
}

export function useSaveProfile() {
  const { session, setFreelancer } = useSession();
  return useMutation({
    mutationFn: (body: { name: string; email?: string; country: Freelancer["country"]; payoutMode: PayoutMode; allocations: Allocation[] }) =>
      api<Freelancer>("/api/me", { method: "POST", token: session!.token, body: JSON.stringify(body) }),
    onSuccess: setFreelancer,
  });
}

export function useSavePayoutRules() {
  const { session, setFreelancer } = useSession();
  return useMutation({
    mutationFn: (body: { payoutMode: PayoutMode; allocations: Allocation[] }) =>
      api<Freelancer>("/api/me/payout-rules", { method: "PUT", token: session!.token, body: JSON.stringify(body) }),
    onSuccess: setFreelancer,
  });
}
