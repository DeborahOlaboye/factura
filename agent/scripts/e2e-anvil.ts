/**
 * Local end-to-end run of Factura's onchain path against anvil (`anvil --chain-id 42220 --port 18545`):
 * deploy FacturaLedger, register a freelancer, issue an invoice (recorded on the ledger), then feed the
 * settlement hook as if Celo's facilitator had just settled the client's USA₮, and check the managed payout
 * arrives at the freelancer through the ledger with the ERC-8021 tag on every agent tx.
 *
 * USA₮ doesn't exist on a bare anvil, so a mock token's runtime code is placed at the USA₮ address. Textile
 * isn't reachable either, so the freelancer's split here is 100% USA₮ (conversion legs are covered by unit
 * tests and need mainnet liquidity).
 *
 *   npm run e2e
 */
import { readFileSync, rmSync } from "node:fs";
import { verifyTx } from "@celo/attribution-tags";
import { createPublicClient, createTestClient, encodeDeployData, encodeFunctionData, http, parseAbi, type Abi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const RPC = process.env.E2E_RPC ?? "http://127.0.0.1:18545";
const DATA = process.env.E2E_DATA ?? "./e2e-data";
rmSync(DATA, { recursive: true, force: true });

Object.assign(process.env, {
  RPC_URL: RPC,
  AGENT_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  ATTRIBUTION_CODE: "celo_e2e",
  X402_API_KEY: "dummy",
  API_TOKEN: "0123456789abcdef0123",
  BUY_DAILY_BUDGET_USD: "0", // vetting runs but buys nothing
  DATA_DIR: DATA,
});

const { loadConfig } = await import("../src/config.ts");
const { makeClients } = await import("../src/chain.ts");
const { Ledger, ledgerAbi } = await import("../src/ledger.ts");
const { Store } = await import("../src/store.ts");
const { Buy } = await import("../src/buy.ts");
const { Services } = await import("../src/services.ts");
const { Textile } = await import("../src/textile.ts");
const { Factura } = await import("../src/factura.ts");
const { INVOICE_ASSET } = await import("../src/tokens.ts");

const cfg = loadConfig();
const clients = makeClients(cfg);
const { wallet, publicClient, account } = clients;
const test = createTestClient({ chain: celo, mode: "anvil", transport: http(RPC) });
const reader = createPublicClient({ chain: celo, transport: http(RPC) });
const artifact = (p: string) =>
  JSON.parse(readFileSync(new URL(`../../contracts/out/${p}`, import.meta.url), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
const token = parseAbi(["function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"]);

// 1. Ledger, deployed and operated by the agent (same path as scripts/deploy-ledger.ts)
const ledgerArt = artifact("FacturaLedger.sol/FacturaLedger.json");
const dep = await wallet.sendTransaction({ to: null, data: encodeDeployData({ abi: ledgerArt.abi, bytecode: ledgerArt.bytecode.object, args: [account.address] }) });
const ledgerAddress = (await publicClient.waitForTransactionReceipt({ hash: dep })).contractAddress!;
await publicClient.waitForTransactionReceipt({
  hash: await wallet.writeContract({ address: ledgerAddress, abi: ledgerAbi, functionName: "setOperator", args: [account.address, true] }),
});

// 2. A mock 6-decimal token living at the real USA₮ address
const mockArt = artifact("FacturaLedger.t.sol/MockToken.json");
const mockDep = await wallet.sendTransaction({ to: null, data: encodeDeployData({ abi: mockArt.abi, bytecode: mockArt.bytecode.object, args: ["USAT", 6] }) });
const mockAt = (await publicClient.waitForTransactionReceipt({ hash: mockDep })).contractAddress!;
await test.setCode({ address: INVOICE_ASSET.address, bytecode: (await reader.getCode({ address: mockAt }))! });

// 3. Domain flow
const store = new Store(DATA);
const services = new Services(new Buy(store, { dailyBudgetUsd: 0 }));
const factura = new Factura({
  store,
  services,
  textile: new Textile(clients, cfg.TEXTILE_API_URL),
  ledger: new Ledger(clients, ledgerAddress),
  agentAddress: account.address,
  publicUrl: "http://localhost",
  frontendUrl: "http://localhost:3000",
  salt: "e2e",
  maxDeviationBps: 150,
  log: (m, d) => console.log("  agent:", m, JSON.stringify(d ?? {})),
});

const freelancerWallet = privateKeyToAccount(generatePrivateKey()).address;
const client = privateKeyToAccount(generatePrivateKey()).address;
const ana = factura.registerFreelancer({
  name: "Ana Souza",
  country: "OTHER",
  wallet: freelancerWallet,
  payoutMode: "managed",
  allocations: [{ symbol: "USAT", bps: 10_000 }],
});
const inv = await factura.createInvoice(ana.id, {
  clientName: "Acme Inc",
  amountUsd: 1200,
  description: "October backend work",
  dueDate: "2026-11-15",
});
console.log("invoice", inv.number, "on ledger:", inv.ledgerTx !== undefined || store.invoice(inv.id)?.ledgerTx !== undefined);

// 4. "Facilitator settled": the client's USA₮ lands with the agent (payTo), then the hook runs.
await publicClient.waitForTransactionReceipt({
  hash: await wallet.sendTransaction({
    to: INVOICE_ASSET.address,
    data: encodeFunctionData({ abi: token, functionName: "mint", args: [account.address, BigInt(inv.amount)] }),
  }),
});
const fakeSettlement = `0x${"5e".repeat(32)}` as Hex;
await factura.onSettled(inv.id, client, fakeSettlement);

// 5. Checks
const after = store.invoice(inv.id)!;
const got = await reader.readContract({ address: INVOICE_ASSET.address, abi: token, functionName: "balanceOf", args: [freelancerWallet] });
const onchain = await reader.readContract({
  address: ledgerAddress,
  abi: parseAbi(["function getInvoice(bytes32) view returns ((address,address,uint256,uint64,uint64,uint8,address,bytes32,bytes32))"]),
  functionName: "getInvoice",
  args: [inv.id],
});
console.log("status:", after.status, "(expect settled)");
console.log("freelancer received:", Number(got) / 1e6, "USA₮ (expect 1200)");
console.log("ledger status:", onchain[5], "(expect 2 = Paid)", "payer:", onchain[6] === client, "settlementTx:", onchain[7] === fakeSettlement);
console.log("payout tx attribution:", await verifyTx({ client: reader, hash: after.payouts[0]!.txHash as Hex }));
console.log("vetting:", after.vetting?.verdict, "-", after.vetting?.summary.slice(0, 80));
rmSync(DATA, { recursive: true, force: true });
