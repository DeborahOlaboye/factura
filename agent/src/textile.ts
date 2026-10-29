import { randomBytes } from "node:crypto";
import { erc20Abi, toHex, type Address, type Hex } from "viem";
import type { Clients } from "./chain.ts";

/**
 * Textile FX RFQ (v2) taker client. Textile solicits its makers for a firm,
 * all-or-nothing quote, returns ready-to-broadcast calldata, and we sign and send it
 * from the agent wallet (which tags it with our ERC-8021 code).
 *
 * Flow: request → approve spender (if needed) → broadcast swap → submit tx hash → poll.
 */

export interface UnsignedTx {
  to: Address;
  data: Hex;
  value: string;
  chainId: number;
}

export interface FirmQuote {
  rfqId: string;
  claimToken: string;
  sellAmount: string;
  buyAmount: string;
  takerPays: string;
  rateRay: string;
  spender: Address;
  expiresAt: string;
  transactions: { approval: UnsignedTx; swap: UnsignedTx };
}

export type QuoteOutcome =
  | { status: "quoted"; quote: FirmQuote }
  | { status: "no_quote"; reason: string; retryAfterMs?: number; availableSellAmount?: string };

export interface Preview {
  status: "preview" | "no_quote";
  sellAmount?: string;
  buyAmount?: string;
  rateRay?: string;
  reason?: string;
  availableSellAmount?: string;
}

export interface FillResult {
  rfqId: string;
  txHash: Hex;
  status: string;
  sellAmount: string;
  buyAmount: string;
}

export class TextileError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

export class Textile {
  constructor(
    private readonly clients: Clients,
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  private get chainId() {
    return this.clients.chain.id;
  }

  private async http<T>(path: string, init: RequestInit & { claim?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (init.claim) headers["x-rfq-claim"] = init.claim;
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      // Firm requests can block ~70s server-side while makers are solicited.
      signal: AbortSignal.timeout(75_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: T;
      error?: { code?: string; message?: string; details?: { reason?: string } };
    };
    if (!res.ok || body.error) {
      const e = body.error;
      throw new TextileError(
        `textile ${path}: ${res.status} ${e?.message ?? ""}`.trim(),
        e?.code,
        e?.details?.reason,
      );
    }
    return body.data as T;
  }

  /** Indicative price from published levels. Free, no slot, no signature. */
  preview(sellToken: Address, buyToken: Address, sellAmount: bigint): Promise<Preview> {
    return this.http<Preview>("/rfq/preview", {
      method: "POST",
      body: JSON.stringify({ chainId: this.chainId, sellToken, buyToken, sellAmount: sellAmount.toString() }),
    });
  }

  /** EIP-712 proof that the agent controls the taker wallet (keyless callers only). */
  private async takerProof() {
    const nonce = toHex(randomBytes(32));
    const issuedAt = Date.now();
    const signature = await this.clients.account.signTypedData({
      domain: { name: "Textile Taker Control", version: "1", chainId: this.chainId },
      types: {
        TakerControl: [
          { name: "taker", type: "address" },
          { name: "chainId", type: "uint256" },
          { name: "nonce", type: "bytes32" },
          { name: "issuedAt", type: "uint256" },
        ],
      },
      primaryType: "TakerControl",
      message: {
        taker: this.clients.account.address,
        chainId: BigInt(this.chainId),
        nonce,
        issuedAt: BigInt(issuedAt),
      },
    });
    return { nonce, issuedAt, signature };
  }

  async requestQuote(sellToken: Address, buyToken: Address, sellAmount: bigint): Promise<QuoteOutcome> {
    const body: Record<string, unknown> = {
      chainId: this.chainId,
      sellToken,
      buyToken,
      sellAmount: sellAmount.toString(),
      taker: this.clients.account.address,
    };
    if (!this.apiKey) body.takerProof = await this.takerProof();

    const data = await this.http<{
      rfqId: string;
      claimToken: string;
      status: "quoted" | "no_quote";
      reason?: string;
      retryAfterMs?: number;
      availableSellAmount?: string;
      quote?: Omit<FirmQuote, "rfqId" | "claimToken" | "transactions">;
      transactions?: FirmQuote["transactions"];
    }>("/rfq/request", { method: "POST", body: JSON.stringify(body) });

    if (data.status !== "quoted" || !data.quote || !data.transactions) {
      return {
        status: "no_quote",
        reason: data.reason ?? "unknown",
        retryAfterMs: data.retryAfterMs,
        availableSellAmount: data.availableSellAmount,
      };
    }
    return {
      status: "quoted",
      quote: { ...data.quote, rfqId: data.rfqId, claimToken: data.claimToken, transactions: data.transactions },
    };
  }

  /** Approve (only if the standing allowance is short), swap, report, and wait for the fill. */
  async execute(quote: FirmQuote, sellToken: Address): Promise<FillResult> {
    const { publicClient, wallet, account } = this.clients;

    const allowance = await publicClient.readContract({
      address: sellToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, quote.spender],
    });
    if (allowance < BigInt(quote.takerPays)) {
      const approval = quote.transactions.approval;
      const hash = await wallet.sendTransaction({ to: approval.to, data: approval.data, value: 0n });
      await publicClient.waitForTransactionReceipt({ hash });
    }

    if (Date.parse(quote.expiresAt) < Date.now()) {
      await this.cancel(quote).catch(() => undefined);
      throw new TextileError("quote expired before broadcast", "expired");
    }

    const swap = quote.transactions.swap;
    const txHash = await wallet.sendTransaction({ to: swap.to, data: swap.data, value: 0n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new TextileError(`swap reverted: ${txHash}`, "reverted");

    // From here the swap is final on-chain. Reporting and status are bookkeeping, so a
    // Textile API hiccup must not make the caller think the funds were never swapped.
    let status: { status: string; sellAmount?: string; buyAmount?: string } = { status: "submitted" };
    try {
      await this.http(`/rfq/${quote.rfqId}/submit`, {
        method: "POST",
        claim: quote.claimToken,
        body: JSON.stringify({ txHash }),
      });
      status = await this.waitForTerminal(quote);
    } catch {
      // keep the quote's amounts; the all-or-nothing order filled exactly as quoted
    }
    return {
      rfqId: quote.rfqId,
      txHash,
      status: status.status,
      sellAmount: status.sellAmount ?? quote.takerPays,
      buyAmount: status.buyAmount ?? quote.buyAmount,
    };
  }

  async cancel(quote: FirmQuote) {
    await this.http(`/rfq/${quote.rfqId}/cancel`, { method: "POST", claim: quote.claimToken, body: "{}" });
  }

  private async waitForTerminal(quote: FirmQuote) {
    type Status = { status: string; sellAmount?: string | null; buyAmount?: string | null };
    for (let i = 0; i < 30; i++) {
      const s = await this.http<Status>(`/rfq/${quote.rfqId}`, { claim: quote.claimToken });
      if (["filled", "failed", "expired"].includes(s.status)) {
        return { status: s.status, sellAmount: s.sellAmount ?? undefined, buyAmount: s.buyAmount ?? undefined };
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    // The tx confirmed on-chain; Textile's indexer is just behind.
    return { status: "submitted", sellAmount: undefined, buyAmount: undefined };
  }
}

/** Human rate (buy per 1 sell) from atomic amounts. */
export function effectiveRate(sellAmount: bigint, sellDecimals: number, buyAmount: bigint, buyDecimals: number): number {
  return Number(buyAmount) / 10 ** buyDecimals / (Number(sellAmount) / 10 ** sellDecimals);
}
