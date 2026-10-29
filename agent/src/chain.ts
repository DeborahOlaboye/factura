import { withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";
import type { Config } from "./config.ts";

export function makeClients(cfg: Config) {
  const chain = cfg.CHAIN === "celo" ? celo : celoSepolia;
  const transport = http(cfg.RPC_URL);
  const account = privateKeyToAccount(cfg.AGENT_PRIVATE_KEY as Hex);

  const publicClient = createPublicClient({ chain, transport });

  // Every transaction the agent signs goes through this client, so every one of them
  // carries the ERC-8021 attribution suffix. Untagged transactions can't be credited
  // later, so nothing in the agent should build its own wallet client.
  const wallet = createWalletClient({ chain, transport, account }).extend(
    withAttribution(cfg.ATTRIBUTION_CODE),
  );

  return { chain, account, publicClient, wallet };
}

export type Clients = ReturnType<typeof makeClients>;
