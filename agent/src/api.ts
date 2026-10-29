import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Auth, AuthedRequest } from "./auth.ts";
import type { Config } from "./config.ts";
import { FacturaError, type Factura } from "./factura.ts";
import { registrationFile } from "./identity.ts";
import { draftFromText, draftSchema } from "./intake.ts";
import type { Services } from "./services.ts";
import type { Invoice, Store } from "./store.ts";
import { payableGuard, publicInvoice, x402Payments } from "./x402.ts";

const allocation = z.object({ symbol: z.enum(["USAT", "USDT", "wBRL", "wARS", "wCOP"]), bps: z.number().int() });

const profileBody = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().optional(),
  country: z.enum(["BR", "AR", "CO", "OTHER"]),
  payoutMode: z.enum(["direct", "managed"]).optional(),
  allocations: z.array(allocation).optional(),
});

const freelancerBody = profileBody.extend({ wallet: z.string() });

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
  auth: Auth;
  chainId: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}) {
  const { cfg, store, factura, services, auth, chainId, log } = deps;
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "64kb" }));

  const withLinks = (inv: Invoice) => ({ ...inv, payLink: factura.payLink(inv), x402Url: factura.x402Url(inv) });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get(["/agent.json", "/.well-known/agent-registration.json"], (_req, res) =>
    res.json(registrationFile({ publicUrl: cfg.PUBLIC_URL, chainId, agentId: cfg.AGENT_ID })),
  );

  // ---- public pay links (x402) ----
  // A person who opens the agent's pay URL in a browser is sent to the pay page.
  app.get("/pay/:id", (req, res, next) => {
    const browser = req.accepts(["json", "html"]) === "html";
    const paying = req.header("payment-signature") || req.header("x-payment");
    if (browser && !paying) return res.redirect(302, `${cfg.FRONTEND_URL}/pay/${req.params.id}`);
    next();
  });
  app.use(payableGuard(store));
  app.use(x402Payments(cfg, store, factura, log));
  app.get("/pay/:id", (req, res) => {
    const inv = store.invoice(String(req.params.id));
    res.json({ accepted: true, invoice: inv ? publicInvoice(inv, store) : undefined });
  });
  app.get("/invoices/:id", (req, res) => {
    const inv = store.invoice(String(req.params.id));
    if (!inv) return res.status(404).json({ error: "unknown invoice" });
    res.json({ ...publicInvoice(inv, store), x402Url: factura.x402Url(inv) });
  });

  // ---- sign-in with Ethereum ----
  app.get("/auth/nonce", (_req, res) => res.json({ nonce: auth.nonce() }));
  app.post("/auth/verify", async (req, res) => {
    const { message, signature } = z
      .object({ message: z.string().max(4_000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) })
      .parse(req.body);
    try {
      const session = await auth.verify(message, signature as `0x${string}`);
      res.json({ ...session, freelancer: store.freelancerByWallet(session.wallet) ?? null });
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : "sign-in failed" });
    }
  });

  // ---- the signed-in freelancer ----
  const me = express.Router();
  me.use(auth.require);
  const current = (req: AuthedRequest) => {
    const f = store.freelancerByWallet(req.wallet!);
    if (!f) throw new FacturaError("no Factura profile for this wallet yet", 404);
    return f;
  };
  const ownInvoice = (req: AuthedRequest) => {
    const inv = factura.requireInvoice(String(req.params.id));
    if (inv.freelancerId !== current(req).id) throw new FacturaError("unknown invoice", 404);
    return inv;
  };

  me.get("/", (req: AuthedRequest, res) => res.json(current(req)));
  me.post("/", (req: AuthedRequest, res) => {
    res.status(201).json(factura.registerFreelancer({ ...profileBody.parse(req.body), wallet: req.wallet! }));
  });
  me.put("/payout-rules", (req: AuthedRequest, res) => {
    const f = current(req);
    const body = payoutRulesBody.parse(req.body);
    factura.updatePayoutRules(f.id, body.payoutMode, body.allocations);
    res.json(factura.requireFreelancer(f.id));
  });
  me.get("/invoices", (req: AuthedRequest, res) => {
    const f = current(req);
    const list = store.invoices((i) => i.freelancerId === f.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(list.map(withLinks));
  });
  me.get("/invoices/:id", (req: AuthedRequest, res) => res.json(withLinks(ownInvoice(req))));
  me.post("/invoices/draft", async (req: AuthedRequest, res) => {
    current(req);
    const { text } = z.object({ text: z.string().min(3).max(4_000) }).parse(req.body);
    res.json(await draftFromText(text, services));
  });
  me.post("/invoices", async (req: AuthedRequest, res) => {
    const f = current(req);
    const inv = await factura.createInvoice(f.id, draftSchema.parse(req.body));
    res.status(201).json(withLinks(inv));
  });
  me.post("/invoices/:id/cancel", async (req: AuthedRequest, res) => {
    const inv = ownInvoice(req);
    await factura.cancelInvoice(inv.id);
    res.json(withLinks(factura.requireInvoice(inv.id)));
  });
  me.post("/invoices/:id/vet", async (req: AuthedRequest, res) => {
    const inv = ownInvoice(req);
    await factura.vet(inv.id);
    res.json(factura.requireInvoice(inv.id).vetting);
  });
  app.use("/api/me", me);

  // ---- operator API ----
  const admin = express.Router();
  admin.use((req, res, next) => {
    if (req.header("authorization") !== `Bearer ${cfg.API_TOKEN}`) return res.status(401).json({ error: "unauthorized" });
    next();
  });
  admin.post("/freelancers", (req, res) => {
    res.status(201).json(factura.registerFreelancer(freelancerBody.parse(req.body)));
  });
  admin.get("/freelancers/:id", (req, res) => res.json(factura.requireFreelancer(req.params.id)));
  admin.put("/freelancers/:id/payout-rules", (req, res) => {
    const body = payoutRulesBody.parse(req.body);
    factura.updatePayoutRules(req.params.id, body.payoutMode, body.allocations);
    res.json(factura.requireFreelancer(req.params.id));
  });
  admin.post("/invoices/draft", async (req, res) => {
    const { text } = z.object({ text: z.string().min(3).max(4_000) }).parse(req.body);
    res.json(await draftFromText(text, services));
  });
  admin.post("/invoices", async (req, res) => {
    const { freelancerId, draft } = invoiceBody.parse(req.body);
    res.status(201).json(withLinks(await factura.createInvoice(freelancerId, draft)));
  });
  admin.get("/invoices", (req, res) => {
    const fid = typeof req.query.freelancerId === "string" ? req.query.freelancerId : undefined;
    res.json(store.invoices((i) => !fid || i.freelancerId === fid).map(withLinks));
  });
  admin.get("/invoices/:id", (req, res) => res.json(withLinks(factura.requireInvoice(req.params.id))));
  admin.post("/invoices/:id/cancel", async (req, res) => {
    await factura.cancelInvoice(req.params.id);
    res.json(factura.requireInvoice(req.params.id));
  });
  admin.post("/invoices/:id/vet", async (req, res) => {
    await factura.vet(req.params.id);
    res.json(factura.requireInvoice(req.params.id).vetting);
  });
  // Proof of payment for every buy call: service, cap, settlement tx and why it was made.
  admin.get("/paid-calls", (_req, res) => {
    const calls = store.paidCalls();
    res.json({ count: calls.length, totalCapUsd: calls.reduce((s, c) => s + c.maxUsd, 0), calls });
  });
  app.use("/api/admin", admin);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      const where = first?.path.length ? `${first.path.join(".")}: ` : "";
      return res.status(400).json({ error: `${where}${first?.message ?? "invalid request"}`, issues: err.issues });
    }
    if (err instanceof FacturaError) return res.status(err.status).json({ error: err.message });
    log("request failed", { error: String(err) });
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
