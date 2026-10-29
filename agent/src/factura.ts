import { randomUUID } from "node:crypto";
import { isAddress, keccak256, parseUnits, toBytes, type Address, type Hex } from "viem";
import { BudgetExceeded } from "./buy.ts";
import type { InvoiceDraft } from "./intake.ts";
import { invoiceId, type Ledger } from "./ledger.ts";
import type { Services } from "./services.ts";
import type { Allocation, Freelancer, Invoice, Store } from "./store.ts";
import { INVOICE_ASSET } from "./tokens.ts";
import { settleManaged, validateAllocations } from "./treasury.ts";
import type { Textile } from "./textile.ts";
import { hasSanctionMatch, vetClient } from "./vetting.ts";

export type Log = (msg: string, extra?: Record<string, unknown>) => void;

interface Deps {
  store: Store;
  services: Services;
  textile: Textile;
  ledger?: Ledger;
  agentAddress: Address;
  publicUrl: string;
  salt: string;
  maxDeviationBps: number;
  log: Log;
}

export class FacturaError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** The agent's domain logic: freelancers, invoices, payer screening and settlement. */
export class Factura {
  constructor(private readonly d: Deps) {}

  registerFreelancer(input: {
    name: string;
    email?: string;
    country: Freelancer["country"];
    wallet: string;
    payoutMode?: Freelancer["payoutMode"];
    allocations?: Allocation[];
  }): Freelancer {
    if (!isAddress(input.wallet)) throw new FacturaError("wallet is not a valid address");
    const allocations = input.allocations ?? defaultAllocations(input.country);
    const problem = validateAllocations(allocations);
    if (problem) throw new FacturaError(problem);
    const freelancer: Freelancer = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      country: input.country,
      wallet: input.wallet,
      payoutMode: input.payoutMode ?? "managed",
      allocations,
      createdAt: new Date().toISOString(),
    };
    this.d.store.putFreelancer(freelancer);
    return freelancer;
  }

  updatePayoutRules(freelancerId: string, payoutMode: Freelancer["payoutMode"], allocations: Allocation[]) {
    const f = this.requireFreelancer(freelancerId);
    const problem = validateAllocations(allocations);
    if (problem) throw new FacturaError(problem);
    this.d.store.putFreelancer({ ...f, payoutMode, allocations });
  }

  async createInvoice(freelancerId: string, draft: InvoiceDraft): Promise<Invoice> {
    const f = this.requireFreelancer(freelancerId);
    const number = this.d.store.nextInvoiceNumber();
    const id = invoiceId(number, this.d.salt).toLowerCase() as Hex;
    const amount = parseUnits(draft.amountUsd.toFixed(2), INVOICE_ASSET.decimals);
    const dueAt = new Date(`${draft.dueDate}T23:59:59Z`);

    const document = {
      number,
      issuer: { name: f.name, wallet: f.wallet, country: f.country },
      client: { name: draft.clientName, company: draft.company, email: draft.clientEmail },
      description: draft.description,
      amount: { value: draft.amountUsd.toFixed(2), currency: "USD", settlementAsset: "USA₮ on Celo" },
      dueDate: draft.dueDate,
    };
    const metaHash = keccak256(toBytes(JSON.stringify(document)));

    const invoice: Invoice = {
      id,
      number,
      freelancerId,
      client: {
        name: draft.clientName,
        company: draft.company,
        email: draft.clientEmail,
        linkedinUrl: draft.linkedinUrl,
        xHandle: draft.xHandle,
      },
      description: draft.description,
      amount: amount.toString(),
      dueAt: dueAt.toISOString(),
      status: "open",
      metaHash,
      // Direct mode never touches the agent: the client pays the freelancer's wallet.
      payTo: f.payoutMode === "direct" ? f.wallet : this.d.agentAddress,
      conversions: [],
      payouts: [],
      notes: [],
      createdAt: new Date().toISOString(),
    };
    this.d.store.putInvoice(invoice);

    if (this.d.ledger) {
      const ledgerTx = await this.d.ledger.createInvoice(id, f.wallet, INVOICE_ASSET.address, amount, dueAt, metaHash);
      this.d.store.updateInvoice(id, (inv) => (inv.ledgerTx = ledgerTx));
    }

    // Vet the client in the background; the pay link works immediately.
    void this.vet(id);
    return this.d.store.invoice(id)!;
  }

  async vet(id: string) {
    const inv = this.requireInvoice(id);
    try {
      const report = await vetClient(inv.client, this.d.services, inv.id);
      this.d.store.updateInvoice(id, (i) => (i.vetting = report));
      this.d.log("client vetted", { invoice: inv.number, verdict: report.verdict, costUsd: report.costUsd });
    } catch (err) {
      this.d.log("vetting failed", { invoice: inv.number, error: String(err) });
    }
  }

  async cancelInvoice(id: string) {
    const inv = this.requireInvoice(id);
    if (inv.status !== "open") throw new FacturaError(`invoice is ${inv.status}`, 409);
    if (this.d.ledger) await this.d.ledger.cancelInvoice(inv.id);
    this.d.store.updateInvoice(id, (i) => (i.status = "cancelled"));
  }

  payLink(inv: Invoice) {
    return `${this.d.publicUrl}/pay/${inv.id}`;
  }

  /**
   * Called before the facilitator verifies a payment. A wallet on the OFAC SDN list is
   * refused before any money moves. If screening is unavailable we fail open for small
   * invoices (the facilitator and USA₮ issuer screen too) and log it.
   */
  async screenPayer(id: string, payer: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const res = await this.d.services.sanctionsWallet(payer, id);
      if (res.ok && hasSanctionMatch(res.data)) {
        this.d.store.updateInvoice(id, (i) => i.notes.push(`refused payment from sanctioned wallet ${payer}`));
        return { ok: false, reason: "payer wallet is on the OFAC SDN list" };
      }
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) this.d.log("payer screen unavailable", { error: String(err) });
    }
    return { ok: true };
  }

  /** x402 settled: record it, then run the managed payout if the freelancer chose one. */
  async onSettled(id: string, payer: Address, settlementTx: Hex) {
    const inv = this.requireInvoice(id);
    if (inv.status !== "open") {
      this.d.log("settlement for non-open invoice", { invoice: inv.number, status: inv.status, settlementTx });
      return;
    }
    this.d.store.updateInvoice(id, (i) => {
      i.status = "paid";
      i.payment = { payer, settlementTx, paidAt: new Date().toISOString() };
    });
    this.d.log("invoice paid", { invoice: inv.number, payer, settlementTx });

    if (this.d.ledger) await this.d.ledger.markPaid(inv.id, payer, settlementTx);

    const f = this.requireFreelancer(inv.freelancerId);
    if (inv.payTo.toLowerCase() !== this.d.agentAddress.toLowerCase()) {
      this.d.store.updateInvoice(id, (i) => (i.status = "settled"));
      return;
    }
    if (!this.d.ledger) throw new Error("managed payouts need LEDGER_ADDRESS");
    await settleManaged(this.d.store.invoice(id)!, f.allocations, {
      textile: this.d.textile,
      ledger: this.d.ledger,
      store: this.d.store,
      maxDeviationBps: this.d.maxDeviationBps,
      log: this.d.log,
    });
  }

  /** Overdue invoices get one polite, specific reminder drafted every three days. */
  async draftReminders(now = new Date()) {
    const overdue = this.d.store.invoices((i) => i.status === "open" && Date.parse(i.dueAt) < now.getTime());
    for (const inv of overdue) {
      const last = inv.notes.findLast((n) => n.startsWith("reminder:"));
      const lastAt = last ? Date.parse(last.slice(9, 33)) : 0;
      if (now.getTime() - lastAt < 3 * 86_400_000) continue;
      const f = this.requireFreelancer(inv.freelancerId);
      try {
        const text = await this.d.services.complete(
          [
            {
              role: "system",
              content:
                "Write a short, courteous payment reminder email (under 90 words) from a freelancer to a client. " +
                "Include the invoice number, amount, original due date and the pay link verbatim. No placeholders.",
            },
            {
              role: "user",
              content: JSON.stringify({
                freelancer: f.name,
                client: inv.client.name,
                invoice: inv.number,
                amountUsd: (Number(inv.amount) / 1e6).toFixed(2),
                dueDate: inv.dueAt.slice(0, 10),
                payLink: this.payLink(inv),
              }),
            },
          ],
          "overdue reminder",
          inv.id,
        );
        this.d.store.updateInvoice(inv.id, (i) => i.notes.push(`reminder:${now.toISOString()} ${text}`));
      } catch (err) {
        this.d.log("reminder draft failed", { invoice: inv.number, error: String(err) });
      }
    }
  }

  requireFreelancer(id: string): Freelancer {
    const f = this.d.store.freelancer(id);
    if (!f) throw new FacturaError("unknown freelancer", 404);
    return f;
  }

  requireInvoice(id: string): Invoice {
    const inv = this.d.store.invoice(id);
    if (!inv) throw new FacturaError("unknown invoice", 404);
    return inv;
  }
}

/**
 * Sensible starting split per country, based on where Textile has depth on Celo today:
 * BRL is deep both ways, COP has a few thousand dollars of USD₮→wCOP depth, and USD₮→wARS
 * is thin, so Argentine freelancers default to dollars and convert later when depth returns.
 */
export function defaultAllocations(country: Freelancer["country"]): Allocation[] {
  switch (country) {
    case "BR":
      return [
        { symbol: "USAT", bps: 5_000 },
        { symbol: "wBRL", bps: 5_000 },
      ];
    case "CO":
      return [
        { symbol: "USAT", bps: 7_000 },
        { symbol: "wCOP", bps: 3_000 },
      ];
    case "AR":
      return [
        { symbol: "USAT", bps: 5_000 },
        { symbol: "USDT", bps: 5_000 },
      ];
    default:
      return [{ symbol: "USAT", bps: 10_000 }];
  }
}
