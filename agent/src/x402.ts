import { HTTPFacilitatorClient, x402ResourceServer, type RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/express";
import type { RequestHandler } from "express";
import type { Address, Hex } from "viem";
import type { Config } from "./config.ts";
import type { Factura, Log } from "./factura.ts";
import type { Store } from "./store.ts";
import { INVOICE_ASSET } from "./tokens.ts";

const PAY_ROUTE = /^\/pay\/(0x[0-9a-fA-F]{64})$/;

function invoiceIdFromPath(path: string | undefined): string | undefined {
  return path ? PAY_ROUTE.exec(path)?.[1]?.toLowerCase() : undefined;
}

function idFromTransport(ctx: unknown): string | undefined {
  const req = (ctx as { request?: { path?: string } } | undefined)?.request;
  return invoiceIdFromPath(req?.path);
}

/**
 * Pay links are x402 resources. `GET /pay/:id` answers 402 with the invoice's exact
 * USA₮ amount and payee, any x402 client (a wallet, `buy curl --token USAT`, another
 * agent) signs an EIP-3009 authorization, and Celo's hosted facilitator settles it.
 */
export function x402Payments(cfg: Config, store: Store, factura: Factura, log: Log): RequestHandler {
  const network = cfg.CHAIN === "celo" ? "eip155:42220" : "eip155:11142220";

  const facilitator = new HTTPFacilitatorClient({
    url: cfg.X402_FACILITATOR_URL,
    createAuthHeaders: async () => {
      const h = { "X-API-Key": cfg.X402_API_KEY };
      return { verify: h, settle: h, supported: h };
    },
  });

  const server = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());

  server.onBeforeVerify(async (ctx) => {
    const id = idFromTransport(ctx.transportContext);
    const payer = (ctx.paymentPayload.payload as { authorization?: { from?: string } }).authorization?.from;
    if (!id || !payer) return;
    const screen = await factura.screenPayer(id, payer);
    if (!screen.ok) return { abort: true as const, reason: "payer_refused", message: screen.reason };
  });

  server.onAfterSettle(async (ctx) => {
    const id = idFromTransport(ctx.transportContext);
    if (!id || !ctx.result.success) return;
    const payer = (ctx.result.payer ??
      (ctx.paymentPayload.payload as { authorization?: { from?: string } }).authorization?.from) as Address;
    // Settlement is done; the payout pipeline runs after the response so the payer isn't kept waiting.
    setImmediate(() => {
      factura.onSettled(id, payer, ctx.result.transaction as Hex).catch((err) => {
        log("post-settlement processing failed", { invoice: id, error: String(err) });
        store.updateInvoice(id, (i) => i.notes.push(`post-settlement error: ${String(err).slice(0, 200)}`));
      });
    });
  });

  const routes: RoutesConfig = {
    "GET /pay/:id": {
      accepts: {
        scheme: "exact",
        network,
        maxTimeoutSeconds: 300,
        payTo: (ctx) => {
          const inv = store.invoice(invoiceIdFromPath(ctx.path) ?? "");
          if (!inv) throw new Error("unknown invoice");
          return inv.payTo;
        },
        price: (ctx) => {
          const inv = store.invoice(invoiceIdFromPath(ctx.path) ?? "");
          if (!inv) throw new Error("unknown invoice");
          return {
            asset: INVOICE_ASSET.address,
            amount: inv.amount,
            extra: { ...INVOICE_ASSET.eip712!, invoice: inv.number },
          };
        },
      },
      description: "Factura invoice, payable in USA₮ on Celo",
      mimeType: "application/json",
      serviceName: "Factura",
      unpaidResponseBody: async (ctx) => {
        const inv = store.invoice(invoiceIdFromPath(ctx.path) ?? "");
        return {
          contentType: "application/json",
          body: inv ? publicInvoice(inv, store) : { error: "unknown invoice" },
        };
      },
    },
  };

  return paymentMiddleware(routes, server);
}

/** Reject pay-link requests for invoices that can't be paid, before x402 quotes a price. */
export function payableGuard(store: Store): RequestHandler {
  return (req, res, next) => {
    const id = invoiceIdFromPath(req.path);
    if (!id) return next();
    const inv = store.invoice(id);
    if (!inv) return res.status(404).json({ error: "unknown invoice" });
    if (inv.status !== "open" && !req.header("payment-signature") && !req.header("x-payment")) {
      return res.status(409).json({ status: inv.status, invoice: publicInvoice(inv, store) });
    }
    next();
  };
}

export function publicInvoice(inv: ReturnType<Store["invoice"]> & {}, store: Store) {
  const f = store.freelancer(inv.freelancerId);
  return {
    number: inv.number,
    from: f?.name,
    to: inv.client.company ?? inv.client.name,
    description: inv.description,
    amount: (Number(inv.amount) / 10 ** INVOICE_ASSET.decimals).toFixed(2),
    currency: "USD",
    settlementAsset: { symbol: "USA₮", address: INVOICE_ASSET.address, chainId: 42220 },
    dueDate: inv.dueAt.slice(0, 10),
    status: inv.status,
    payment: inv.payment,
    metaHash: inv.metaHash,
  };
}
