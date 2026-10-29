/**
 * Import the agent wallet into buy, so paid service calls come from the same wallet
 * that holds the ERC-8004 identity and signs every other agent transaction.
 *
 * The key goes to buy over BUY_IMPORT_KEY (never argv), and buy stores it in the OS
 * keychain under the account name given by BUY_ACCOUNT (default "factura").
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/config.ts";

const cfg = loadConfig();
const name = cfg.BUY_ACCOUNT ?? "factura";
const require = createRequire(import.meta.url);
const main = join(dirname(require.resolve("@celo/buy/package.json")), "dist/main.js");

const result = spawnSync(process.execPath, [main, "setup", "--import", "--name", name], {
  stdio: "inherit",
  env: { ...process.env, BUY_IMPORT_KEY: cfg.AGENT_PRIVATE_KEY.replace(/^0x/, "") },
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`\nbuy account "${name}" ready. Set BUY_ACCOUNT=${name} in .env and fund it with a few USDC on Celo.`);
