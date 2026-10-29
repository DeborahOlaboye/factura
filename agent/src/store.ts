import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
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

/** Where the store's snapshot lives between restarts. */
interface Persistence {
  load(): Promise<Partial<Data> | undefined>;
  save(snapshot: string): void;
  flush(): Promise<void>;
}

/** A JSON file, rewritten atomically on every change. For hosts with a persistent disk. */
class FilePersistence implements Persistence {
  private readonly file: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "factura.json");
  }

  async load() {
    return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Partial<Data>) : undefined;
  }

  save(snapshot: string) {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, snapshot);
    renameSync(tmp, this.file);
  }

  async flush() {}
}

/**
 * One row in Postgres holding the same JSON snapshot. For hosts without a disk (Render's
 * free tier wipes it on every restart). Writes are queued and coalesced: only the latest
 * snapshot is ever written, and one write runs at a time.
 */
class PostgresPersistence implements Persistence {
  private readonly pool: pg.Pool;
  private pending: string | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 2 });
  }

  async load() {
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS factura_state (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())",
    );
    const res = await this.pool.query<{ data: Partial<Data> }>("SELECT data FROM factura_state WHERE id = 'main'");
    return res.rows[0]?.data;
  }

  save(snapshot: string) {
    this.pending = snapshot;
    this.writing = this.writing.then(() => this.drain());
  }

  private async drain() {
    const snapshot = this.pending;
    if (snapshot === undefined) return;
    this.pending = undefined;
    try {
      await this.pool.query(
        "INSERT INTO factura_state (id, data) VALUES ('main', $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
        [snapshot],
      );
    } catch (err) {
      // Keep the newest snapshot for the next write instead of dropping it.
      this.pending ??= snapshot;
      console.error(JSON.stringify({ at: new Date().toISOString(), msg: "store write failed", error: String(err) }));
    }
  }

  async flush() {
    await this.writing;
    if (this.pending !== undefined) await this.drain();
    await this.pool.end();
  }
}

/**
 * The agent's state, held in memory and persisted on every change: to a JSON file by
 * default, or to Postgres when DATABASE_URL is set. The agent runs as one process and the
 * volumes are small, so a single snapshot is all the storage it needs.
 */
export class Store {
  private constructor(
    private data: Data,
    private readonly persistence: Persistence,
  ) {}

  static async open(opts: { dataDir: string; databaseUrl?: string }): Promise<Store> {
    const persistence = opts.databaseUrl ? new PostgresPersistence(opts.databaseUrl) : new FilePersistence(opts.dataDir);
    const loaded = await persistence.load();
    return new Store({ ...structuredClone(EMPTY), ...loaded }, persistence);
  }

  /** Wait for pending writes (call before the process exits). */
  flush() {
    return this.persistence.flush();
  }

  private save() {
    this.persistence.save(JSON.stringify(this.data));
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
