import { buildApp } from "./api.ts";
import { Auth } from "./auth.ts";
import { Buy } from "./buy.ts";
import { makeClients } from "./chain.ts";
import { loadConfig } from "./config.ts";
import { Factura } from "./factura.ts";
import { Ledger } from "./ledger.ts";
import { Services } from "./services.ts";
import { Store } from "./store.ts";
import { Textile } from "./textile.ts";

const cfg = (() => {
  try {
    return loadConfig();
  } catch (err) {
    // Missing keys are the usual first run: say what's missing, not a stack trace.
    console.error(`factura: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Copy .env.example to .env and fill it in. The live agent runs at https://factura-agent.onrender.com");
    process.exit(1);
  }
})();
const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));

const clients = makeClients(cfg);
const store = await Store.open({ dataDir: cfg.DATA_DIR, databaseUrl: cfg.DATABASE_URL });
log("store ready", { backend: cfg.DATABASE_URL ? "postgres" : "file" });
const buy = new Buy(store, { signer: clients.account, reader: clients.publicClient, dailyBudgetUsd: cfg.BUY_DAILY_BUDGET_USD });
const services = new Services(buy);
const textile = new Textile(clients, cfg.TEXTILE_API_URL, cfg.TEXTILE_API_KEY);
const ledger = cfg.LEDGER_ADDRESS ? new Ledger(clients, cfg.LEDGER_ADDRESS as `0x${string}`) : undefined;

if (!ledger) log("LEDGER_ADDRESS not set: running without the onchain ledger (direct payouts only)");
if (cfg.AGENT_ID === undefined) log("AGENT_ID not set: register the ERC-8004 identity with `npm run register:agent`");

const factura = new Factura({
  store,
  services,
  textile,
  ledger,
  agentAddress: clients.account.address,
  publicUrl: cfg.PUBLIC_URL,
  frontendUrl: cfg.FRONTEND_URL,
  salt: `${clients.chain.id}:${cfg.LEDGER_ADDRESS ?? "none"}`,
  maxDeviationBps: cfg.MAX_FX_DEVIATION_BPS,
  log,
});

const auth = new Auth(clients, cfg.SESSION_SECRET, new URL(cfg.FRONTEND_URL).host);
if (!cfg.SESSION_SECRET) log("SESSION_SECRET not set: freelancer sessions end when the agent restarts");

const app = buildApp({ cfg, store, factura, services, auth, chainId: clients.chain.id, log });
const server = app.listen(cfg.PORT, () => {
  log("factura agent listening", { port: cfg.PORT, agent: clients.account.address, chain: clients.chain.name });
});

// Overdue reminders, hourly.
setInterval(() => void factura.draftReminders(), 60 * 60 * 1000).unref();

// Render's free plan sleeps after 15 idle minutes and wakes in about a minute. A request to
// our own public URL goes through Render's edge, so it counts as traffic and keeps us up.
if (process.env.RENDER) {
  setInterval(() => void fetch(`${cfg.PUBLIC_URL}/health`, { signal: AbortSignal.timeout(30_000) }).catch(() => {}), 10 * 60 * 1000).unref();
}

// Hosts send SIGTERM before replacing the instance: finish the last store write first.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    log("shutting down", { signal });
    server.close();
    store.flush().finally(() => process.exit(0));
  });
}
