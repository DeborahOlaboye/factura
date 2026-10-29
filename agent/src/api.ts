import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Config } from "./config.ts";
import { FacturaError, type Factura } from "./factura.ts";
import { registrationFile } from "./identity.ts";
import { draftFromText, draftSchema } from "./intake.ts";
import type { Services } from "./services.ts";
import type { Store } from "./store.ts";
import { payableGuard, publicInvoice, x402Payments } from "./x402.ts";

const allocation = z.object({ symbol: z.enum(["USAT", "USDT", "wBRL", "wARS", "wCOP"]), bps: z.number().int() });

const freelancerBody = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  country: z.enum(["BR", "AR", "CO", "OTHER"]),
  wallet: z.string(),
  payoutMode: z.enum(["direct", "managed"]).optional(),
  allocations: z.array(allocation).optional(),
});

const payoutRulesBody = z.object({
  payoutMode: z.enum(["direct", "managed"]),
  allocations: z.array(allocation),
});

const invoiceBody = z.object({ freelancerId: z.string(), draft: draftSchema });

export function buildApp(deps: {
  cfg: Config;
  store: Store;
  factura: Factura;
  services: Services;
  chainId: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}) {
  const { cfg, store, factura, services, chainId, log } = deps;
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get(["/agent.json", "/.well-known/agent-registration.json"], (_req, res) =>
    res.json(registrationFile({ publicUrl: cfg.PUBLIC_URL, chainId, agentId: cfg.AGENT_ID })),
  );

  // Public pay links (x402). The guard answers 404/409 for invoices that can't be paid.
  app.use(payableGuard(store));
  app.use(x402Payments(cfg, store, factura, log));
  app.get("/pay/:id", (req, res) => {
    const inv = store.invoice(String(req.params.id));
    res.json({ accepted: true, invoice: inv ? publicInvoice(inv, store) : undefined });
  });
  app.get("/invoices/:id", (req, res) => {
    const inv = store.invoice(String(req.params.id));
    if (!inv) return res.status(404).json({ error: "unknown invoice" });
    res.json(publicInvoice(inv, store));
  });

  // Freelancer API. One operator token for now; per-freelancer auth arrives with the frontend.
  const api = express.Router();
  api.use((req, res, next) => {
    if (req.header("authorization") !== `Bearer ${cfg.API_TOKEN}`) return res.status(401).json({ error: "unauthorized" });
    next();
  });

  api.post("/freelancers", (req, res) => {
    res.status(201).json(factura.registerFreelancer(freelancerBody.parse(req.body)));
  });
  api.get("/freelancers/:id", (req, res) => res.json(factura.requireFreelancer(req.params.id)));
  api.put("/freelancers/:id/payout-rules", (req, res) => {
    const body = payoutRulesBody.parse(req.body);
    factura.updatePayoutRules(req.params.id, body.payoutMode, body.allocations);
    res.json(factura.requireFreelancer(req.params.id));
  });

  api.post("/invoices/draft", async (req, res) => {
    const { text } = z.object({ text: z.string().min(3).max(4_000) }).parse(req.body);
    res.json(await draftFromText(text, services));
  });
  api.post("/invoices", async (req, res) => {
    const { freelancerId, draft } = invoiceBody.parse(req.body);
    const inv = await factura.createInvoice(freelancerId, draft);
    res.status(201).json({ ...inv, payLink: factura.payLink(inv) });
  });
  api.get("/invoices", (req, res) => {
    const fid = typeof req.query.freelancerId === "string" ? req.query.freelancerId : undefined;
    res.json(store.invoices((i) => !fid || i.freelancerId === fid));
  });
  api.get("/invoices/:id", (req, res) => {
    const inv = factura.requireInvoice(req.params.id);
    res.json({ ...inv, payLink: factura.payLink(inv) });
  });
  api.post("/invoices/:id/cancel", async (req, res) => {
    await factura.cancelInvoice(req.params.id);
    res.json(factura.requireInvoice(req.params.id));
  });
  api.post("/invoices/:id/vet", async (req, res) => {
    await factura.vet(req.params.id);
    res.json(factura.requireInvoice(req.params.id).vetting);
  });

  // Proof of payment for every buy call: service, cap, settlement tx and why it was made.
  api.get("/paid-calls", (_req, res) => {
    const calls = store.paidCalls();
    res.json({ count: calls.length, totalCapUsd: calls.reduce((s, c) => s + c.maxUsd, 0), calls });
  });

  app.use("/api", api);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "invalid request", issues: err.issues });
    if (err instanceof FacturaError) return res.status(err.status).json({ error: err.message });
    log("request failed", { error: String(err) });
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
