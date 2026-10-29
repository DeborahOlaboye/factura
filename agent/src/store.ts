import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Symbol } from "./tokens.ts";

export interface Allocation {
  symbol: Symbol;
  /** Share of each invoice paid out in this token, in basis points. */
  bps: number;
}

export interface Freelancer {
  id: string;
  name: string;
  email?: string;
  country: "BR" | "AR" | "CO" | "OTHER";
  wallet: `0x${string}`;
  /**
   * direct:  the client's USA₮ goes straight to the freelancer's wallet.
   * managed: it lands with the agent, which converts per `allocations` and forwards
   *          everything to the freelancer through the ledger in the same flow.
   */
  payoutMode: "direct" | "managed";
  allocations: Allocation[];
  createdAt: string;
}

export interface ClientInfo {
  name: string;
  email?: string;
  company?: string;
  linkedinUrl?: string;
  xHandle?: string;
}

export interface PaidCall {
  at: string;
  service: string;
  url: string;
  maxUsd: number;
  settlementTx?: string;
  purpose: string;
  invoiceId?: string;
}

export interface VettingReport {
  at: string;
  verdict: "clear" | "review" | "block";
  summary: string;
  signals: Record<string, unknown>;
  costUsd: number;
}

export interface Payout {
  symbol: Symbol;
  amount: string;
  txHash: string;
}

export interface Conversion {
  sell: Symbol;
  buy: Symbol;
  sellAmount: string;
  buyAmount: string;
  rfqId: string;
  txHash: string;
}

export interface Invoice {
  id: `0x${string}`;
  number: string;
  freelancerId: string;
  client: ClientInfo;
  description: string;
  /** USA₮ atomic units (6 decimals). */
  amount: string;
  dueAt: string;
  status: "open" | "paid" | "settled" | "cancelled";
  metaHash: `0x${string}`;
  ledgerTx?: string;
  payTo: `0x${string}`;
  payment?: { payer: string; settlementTx: string; paidAt: string };
  conversions: Conversion[];
  payouts: Payout[];
  notes: string[];
  vetting?: VettingReport;
  createdAt: string;
}

interface Data {
  seq: number;
  freelancers: Record<string, Freelancer>;
  invoices: Record<string, Invoice>;
  paidCalls: PaidCall[];
}

const EMPTY: Data = { seq: 0, freelancers: {}, invoices: {}, paidCalls: [] };

/**
 * A single JSON file, rewritten atomically on every change. The agent runs as one
 * process and the volumes are small, so this keeps the deployment to "copy the folder".
 */
export class Store {
  private data: Data;
  private readonly file: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "factura.json");
    this.data = existsSync(this.file)
      ? { ...EMPTY, ...JSON.parse(readFileSync(this.file, "utf8")) }
      : structuredClone(EMPTY);
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  nextInvoiceNumber(): string {
    this.data.seq += 1;
    this.save();
    return `FAC-${String(this.data.seq).padStart(4, "0")}`;
  }

  putFreelancer(f: Freelancer) {
    this.data.freelancers[f.id] = f;
    this.save();
  }

  freelancer(id: string): Freelancer | undefined {
    return this.data.freelancers[id];
  }

  freelancerByWallet(wallet: string): Freelancer | undefined {
    return Object.values(this.data.freelancers).find((f) => f.wallet.toLowerCase() === wallet.toLowerCase());
  }

  freelancers(): Freelancer[] {
    return Object.values(this.data.freelancers);
  }

  putInvoice(inv: Invoice) {
    this.data.invoices[inv.id] = inv;
    this.save();
  }

  invoice(id: string): Invoice | undefined {
    return this.data.invoices[id.toLowerCase()] ?? this.data.invoices[id];
  }

  invoices(filter?: (i: Invoice) => boolean): Invoice[] {
    const all = Object.values(this.data.invoices);
    return filter ? all.filter(filter) : all;
  }

  updateInvoice(id: string, patch: (inv: Invoice) => void): Invoice {
    const inv = this.invoice(id);
    if (!inv) throw new Error(`Unknown invoice ${id}`);
    patch(inv);
    this.save();
    return inv;
  }

  addPaidCall(call: PaidCall) {
    this.data.paidCalls.push(call);
    this.save();
  }

  paidCalls(): PaidCall[] {
    return this.data.paidCalls;
  }

  spentTodayUsd(now = new Date()): number {
    const day = now.toISOString().slice(0, 10);
    return this.data.paidCalls
      .filter((c) => c.at.startsWith(day))
      .reduce((sum, c) => sum + c.maxUsd, 0);
  }
}
