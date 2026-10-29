/**
 * Register Factura's ERC-8004 identity from the agent wallet (required for every
 * hackathon track), or point an existing identity at the current registration file.
 *
 *   npm run register:agent            # first time: register(agentURI)
 *   AGENT_ID=123 npm run register:agent  # later: setAgentURI(agentId, agentURI)
 *
 * The agentURI is the agent's own /agent.json, so PUBLIC_URL must be reachable.
 */
import { decodeEventLog, parseAbi } from "viem";
import { makeClients } from "../src/chain.ts";
import { loadConfig } from "../src/config.ts";
import { IDENTITY_REGISTRY } from "../src/identity.ts";

const abi = parseAbi([
  "function register(string agentURI) returns (uint256)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

const cfg = loadConfig();
const { wallet, publicClient, chain, account } = makeClients(cfg);
const registry = IDENTITY_REGISTRY[chain.id];
if (!registry) throw new Error(`no ERC-8004 registry known for chain ${chain.id}`);
const agentURI = `${cfg.PUBLIC_URL}/agent.json`;

if (cfg.AGENT_ID !== undefined) {
  const hash = await wallet.writeContract({
    address: registry,
    abi,
    functionName: "setAgentURI",
    args: [cfg.AGENT_ID, agentURI],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`agent ${cfg.AGENT_ID} now points at ${agentURI} (tx ${hash})`);
} else {
  const hash = await wallet.writeContract({ address: registry, abi, functionName: "register", args: [agentURI] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const log = receipt.logs
    .filter((l) => l.address.toLowerCase() === registry.toLowerCase())
    .map((l) => {
      try {
        return decodeEventLog({ abi, data: l.data, topics: l.topics });
      } catch {
        return undefined;
      }
    })
    .find((e) => e?.eventName === "Registered");
  if (!log || log.eventName !== "Registered") throw new Error(`no Registered event in ${hash}`);
  console.log(`registered agent ${log.args.agentId} owned by ${account.address} (tx ${hash})`);
  console.log(`\nAdd to .env:\nAGENT_ID=${log.args.agentId}`);
  console.log(`Check it on https://8004scan.io once indexed.`);
}
