import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Store } from "./store.ts";

/**
 * Paid calls into services Factura doesn't own, through the buy marketplace on Celo.
 *
 * We drive the official `buy` CLI rather than re-implementing x402 signing: it pays
 * the 402 from the agent's keychain wallet, enforces `--max-amount` before signing,
 * keeps buy's own receipt store (`buy receipts`) and reports the settlement tx. Each
 * call is also written to Factura's store so the agent can show what it bought, why,
 * and for which invoice.
 */

const require = createRequire(import.meta.url);
const BUY_MAIN = join(dirname(require.resolve("@celo/buy/package.json")), "dist/main.js");

export interface BuyRequest {
  service: string;
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  /** Hard cap in USD for this call; buy refuses to sign above it. */
  maxUsd: number;
  purpose: string;
  invoiceId?: string;
}

export interface BuyResult<T = unknown> {
  ok: boolean;
  data?: T;
  raw: string;
  settlementTx?: string;
  error?: string;
}

export class BudgetExceeded extends Error {}

export interface BuyOptions {
  account?: string;
  dailyBudgetUsd: number;
  sandbox?: boolean;
}

export class Buy {
  constructor(
    private readonly store: Store,
    private readonly opts: BuyOptions,
  ) {}

  async call<T = unknown>(req: BuyRequest): Promise<BuyResult<T>> {
    const spent = this.store.spentTodayUsd();
    if (spent + req.maxUsd > this.opts.dailyBudgetUsd) {
      throw new BudgetExceeded(
        `daily buy budget reached (${spent.toFixed(3)} of ${this.opts.dailyBudgetUsd} USD spent)`,
      );
    }

    const globals = ["--verbose", "--json"];
    if (this.opts.sandbox) globals.push("--sandbox");
    if (this.opts.account) globals.push("--account", this.opts.account);

    const method = req.method ?? "POST";
    const curlArgs = ["--max-amount", String(req.maxUsd), "-sS", "-X", method];
    if (req.body !== undefined) {
      curlArgs.push("-H", "content-type: application/json", "--data", JSON.stringify(req.body));
    }
    curlArgs.push(req.url);

    const { code, stdout, stderr } = await run(process.execPath, [BUY_MAIN, ...globals, "curl", ...curlArgs]);
    const settlementTx = parseSettlementTx(stderr);

    // Record anything that may have been paid for, even when the request then failed:
    // a settled payment with a bad response is still money spent.
    if (settlementTx || code === 0) {
      this.store.addPaidCall({
        at: new Date().toISOString(),
        service: req.service,
        url: req.url,
        maxUsd: req.maxUsd,
        settlementTx,
        purpose: req.purpose,
        invoiceId: req.invoiceId,
      });
    }

    if (code !== 0) {
      return { ok: false, raw: stdout, settlementTx, error: parseError(stderr) ?? `buy exited ${code}` };
    }

    let data: T | undefined;
    try {
      data = JSON.parse(stdout) as T;
    } catch {
      // Non-JSON bodies are returned raw.
    }
    return { ok: true, data, raw: stdout, settlementTx };
  }
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** buy logs one JSON object per stderr line when not on a TTY: {"log":"paid → 0x…"}. */
export function parseSettlementTx(stderr: string): string | undefined {
  for (const line of stderr.split("\n")) {
    const text = jsonField(line, "log") ?? line;
    const m = /paid →.*?(0x[0-9a-fA-F]{64})/.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

export function parseError(stderr: string): string | undefined {
  for (const line of stderr.split("\n")) {
    try {
      const obj = JSON.parse(line) as { error?: { code?: string; message?: string } };
      if (obj.error) return [obj.error.code, obj.error.message].filter(Boolean).join(": ");
    } catch {
      // not a JSON line
    }
  }
  return undefined;
}

function jsonField(line: string, key: string): string | undefined {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    return typeof obj[key] === "string" ? (obj[key] as string) : undefined;
  } catch {
    return undefined;
  }
}
