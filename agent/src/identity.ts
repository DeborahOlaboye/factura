import type { Address } from "viem";

export const IDENTITY_REGISTRY: Record<number, Address> = {
  42220: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  11142220: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};

/** ERC-8004 registration file, served at /agent.json and used as the agentURI. */
export function registrationFile(opts: { publicUrl: string; chainId: number; agentId?: bigint }) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Factura",
    description:
      "Invoicing agent for LatAm freelancers billing US clients. Issues x402 pay links settled in USA₮ on Celo, " +
      "vets new clients (OFAC + public footprint), screens payer wallets, and converts proceeds to wBRL/wCOP/USD₮ " +
      "on Textile FX per the freelancer's rules.",
    image: `${opts.publicUrl}/logo.png`,
    services: [
      { name: "web", endpoint: opts.publicUrl },
      { name: "x402-pay-links", endpoint: `${opts.publicUrl}/pay/{invoiceId}` },
    ],
    x402Support: true,
    active: true,
    supportedTrust: ["reputation"],
    registrations:
      opts.agentId !== undefined
        ? [{ agentId: Number(opts.agentId), agentRegistry: `eip155:${opts.chainId}:${IDENTITY_REGISTRY[opts.chainId]}` }]
        : [],
  };
}
