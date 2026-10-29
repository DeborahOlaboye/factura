import { erc20Abi, keccak256, maxUint256, parseAbi, toBytes, type Address, type Hex } from "viem";
import type { Clients } from "./chain.ts";

export const ledgerAbi = parseAbi([
  "function createInvoice(bytes32 id, address freelancer, address asset, uint256 amount, uint64 dueAt, bytes32 metaHash)",
  "function cancelInvoice(bytes32 id)",
  "function markPaid(bytes32 id, address payer, bytes32 settlementTx)",
  "function recordConversion(bytes32 id, address sellToken, uint256 sellAmount, address buyToken, uint256 buyAmount, bytes32 swapTx)",
  "function payout(bytes32 id, address token, uint256 amount)",
  "function operators(address) view returns (bool)",
  "function setOperator(address operator, bool allowed)",
  "event InvoicePaid(bytes32 indexed id, address indexed payer, bytes32 settlementTx)",
  "event PayoutSent(bytes32 indexed id, address indexed freelancer, address token, uint256 amount)",
]);

/** Thin wrapper over FacturaLedger. All writes go through the attributed wallet client. */
export class Ledger {
  private approved = new Set<string>();

  constructor(
    private readonly clients: Clients,
    readonly address: Address,
  ) {}

  private async write(functionName: string, args: readonly unknown[]): Promise<Hex> {
    const { wallet, publicClient } = this.clients;
    const hash = await wallet.writeContract({
      address: this.address,
      abi: ledgerAbi,
      functionName: functionName as never,
      args: args as never,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`ledger.${functionName} reverted: ${hash}`);
    return hash;
  }

  createInvoice(id: Hex, freelancer: Address, asset: Address, amount: bigint, dueAt: Date, metaHash: Hex) {
    return this.write("createInvoice", [id, freelancer, asset, amount, BigInt(Math.floor(dueAt.getTime() / 1000)), metaHash]);
  }

  cancelInvoice(id: Hex) {
    return this.write("cancelInvoice", [id]);
  }

  markPaid(id: Hex, payer: Address, settlementTx: Hex) {
    return this.write("markPaid", [id, payer, settlementTx]);
  }

  recordConversion(id: Hex, sell: Address, sellAmount: bigint, buy: Address, buyAmount: bigint, swapTx: Hex) {
    return this.write("recordConversion", [id, sell, sellAmount, buy, buyAmount, swapTx]);
  }

  /** Forward `amount` of `token` from the agent to the invoice's freelancer. */
  async payout(id: Hex, token: Address, amount: bigint) {
    await this.ensureApproval(token);
    return this.write("payout", [id, token, amount]);
  }

  private async ensureApproval(token: Address) {
    if (this.approved.has(token)) return;
    const { publicClient, wallet, account } = this.clients;
    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, this.address],
    });
    if (allowance < maxUint256 / 2n) {
      const hash = await wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [this.address, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    this.approved.add(token);
  }
}

/** Invoice ids are bytes32 derived from the human number plus a salt, so they don't collide across deployments. */
export function invoiceId(number: string, salt: string): Hex {
  return keccak256(toBytes(`factura:${salt}:${number}`));
}
