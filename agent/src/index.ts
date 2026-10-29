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

const cfg = loadConfig();
const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));

const clients = makeClients(cfg);
const store = new Store(cfg.DATA_DIR);
const buy = new Buy(store, {
  account: cfg.BUY_ACCOUNT,
  dailyBudgetUsd: cfg.BUY_DAILY_BUDGET_USD,
  sandbox: cfg.CHAIN !== "celo",
});
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
app.listen(cfg.PORT, () => {
  log("factura agent listening", { port: cfg.PORT, agent: clients.account.address, chain: clients.chain.name });
});

// Overdue reminders, hourly.
setInterval(() => void factura.draftReminders(), 60 * 60 * 1000).unref();
