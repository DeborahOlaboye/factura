/**
 * Operator CLI against a running agent, until the frontend exists.
 *
 *   npm run invoice -- freelancer "Ana Souza" BR 0xWallet
 *   npm run invoice -- draft "bill Acme Inc $1200 for October backend work, due Nov 15"
 *   npm run invoice -- create <freelancerId> '<draft json>'
 *   npm run invoice -- list
 *   npm run invoice -- paid-calls
 */
import { loadConfig } from "../src/config.ts";

const cfg = loadConfig();
const base = `http://localhost:${cfg.PORT}/api`;

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${cfg.API_TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
  if (!res.ok) process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "freelancer": {
    const [name, country, wallet] = args;
    await call("POST", "/freelancers", { name, country, wallet });
    break;
  }
  case "draft":
    await call("POST", "/invoices/draft", { text: args.join(" ") });
    break;
  case "create":
    await call("POST", "/invoices", { freelancerId: args[0], draft: JSON.parse(args[1] ?? "{}") });
    break;
  case "list":
    await call("GET", "/invoices");
    break;
  case "paid-calls":
    await call("GET", "/paid-calls");
    break;
  default:
    console.error("usage: invoice freelancer|draft|create|list|paid-calls …");
    process.exit(1);
}
