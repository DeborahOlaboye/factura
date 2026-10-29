import { z } from "zod";

const hex = (len: number) => z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${len}}$`));
const address = hex(40);

const schema = z.object({
  PORT: z.coerce.number().default(8402),
  PUBLIC_URL: z.string().url().default("http://localhost:8402"),
  DATA_DIR: z.string().default("./data"),

  // Celo
  CHAIN: z.enum(["celo", "celo-sepolia"]).default("celo"),
  RPC_URL: z.string().url().optional(),
  AGENT_PRIVATE_KEY: hex(64),
  LEDGER_ADDRESS: address.optional(),

  // ERC-8021 code issued at hackathon enrollment. Every tx the agent sends carries it.
  ATTRIBUTION_CODE: z.string().min(1),
  // ERC-8004 identity, filled in after `npm run register:agent`.
  AGENT_ID: z.coerce.bigint().optional(),

  // x402 (Celo hosted facilitator)
  X402_FACILITATOR_URL: z.string().url().default("https://api.x402.celo.org"),
  X402_API_KEY: z.string().min(1),

  // Textile FX RFQ
  TEXTILE_API_URL: z.string().url().default("https://api.textilecredit.com/v2"),
  TEXTILE_API_KEY: z.string().optional(),
  // Reject a quote that is worse than the reference FX rate by more than this.
  MAX_FX_DEVIATION_BPS: z.coerce.number().default(150),

  // buy: paid services the agent consumes
  BUY_ACCOUNT: z.string().optional(),
  BUY_DAILY_BUDGET_USD: z.coerce.number().default(2),

  // Bearer token for the freelancer-facing REST API
  API_TOKEN: z.string().min(16),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
