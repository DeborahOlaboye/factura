/**
 * Deploy FacturaLedger from the agent wallet and make the agent its operator.
 *
 * Deployed with viem instead of `forge script` so the deployment carries the ERC-8021
 * attribution suffix like every other agent transaction (the constructor only takes a
 * static address, so trailing suffix bytes after the init code are ignored).
 *
 *   cd ../contracts && forge build && cd ../agent && npm run deploy:ledger
 */
import { readFileSync } from "node:fs";
import { encodeDeployData, type Hex } from "viem";
import { makeClients } from "../src/chain.ts";
import { loadConfig } from "../src/config.ts";
import { ledgerAbi } from "../src/ledger.ts";

const cfg = loadConfig();
const { wallet, publicClient, account, chain } = makeClients(cfg);

const artifact = JSON.parse(
  readFileSync(new URL("../../contracts/out/FacturaLedger.sol/FacturaLedger.json", import.meta.url), "utf8"),
) as { abi: unknown[]; bytecode: { object: Hex } };

const data = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [account.address],
});

console.log(`deploying FacturaLedger on ${chain.name} from ${account.address}…`);
const hash = await wallet.sendTransaction({ data, to: null });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress) throw new Error(`deployment failed: ${hash}`);
console.log(`FacturaLedger: ${receipt.contractAddress} (tx ${hash})`);

const opHash = await wallet.writeContract({
  address: receipt.contractAddress,
  abi: ledgerAbi,
  functionName: "setOperator",
  args: [account.address, true],
});
await publicClient.waitForTransactionReceipt({ hash: opHash });
console.log(`agent set as operator (tx ${opHash})`);
console.log(`\nAdd to .env:\nLEDGER_ADDRESS=${receipt.contractAddress}`);
