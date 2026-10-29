// Shapes returned by the Factura agent API.

export type Symbol = "USAT" | "USDT" | "USDC" | "wBRL" | "wARS" | "wCOP";
export type Country = "BR" | "AR" | "CO" | "OTHER";
export type PayoutMode = "direct" | "managed";

export interface Allocation {
  symbol: Symbol;
  bps: number;
}

export interface Freelancer {
  id: string;
  name: string;
  email?: string;
  country: Country;
  wallet: `0x${string}`;
  payoutMode: PayoutMode;
  allocations: Allocation[];
  createdAt: string;
}

export interface VettingReport {
  at: string;
  verdict: "clear" | "review" | "block";
  summary: string;
  signals: Record<string, unknown>;
  costUsd: number;
}

export interface Invoice {
  id: `0x${string}`;
  number: string;
  freelancerId: string;
  client: { name: string; email?: string; company?: string; linkedinUrl?: string; xHandle?: string };
  description: string;
  amount: string;
  dueAt: string;
  status: "open" | "paid" | "settled" | "cancelled";
  metaHash: string;
  ledgerTx?: string;
  payTo: string;
  payment?: { payer: string; settlementTx: string; paidAt: string };
  conversions: { sell: Symbol; buy: Symbol; sellAmount: string; buyAmount: string; rfqId: string; txHash: string }[];
  payouts: { symbol: Symbol; amount: string; txHash: string }[];
  notes: string[];
  vetting?: VettingReport;
  createdAt: string;
  payLink: string;
  x402Url: string;
}

export interface PublicInvoice {
  number: string;
  from?: string;
  to: string;
  description: string;
  amount: string;
  currency: "USD";
  settlementAsset: { symbol: string; address: string; chainId: number };
  dueDate: string;
  status: Invoice["status"];
  payment?: Invoice["payment"];
  metaHash: string;
  x402Url: string;
}

export interface Draft {
  clientName: string;
  company?: string;
  clientEmail?: string;
  linkedinUrl?: string;
  xHandle?: string;
  amountUsd: number;
  description: string;
  dueDate: string;
}
