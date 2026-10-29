import type { Address } from "viem";

export type Symbol = "USAT" | "USDT" | "USDC" | "wBRL" | "wARS" | "wCOP";

export interface Token {
  symbol: Symbol;
  address: Address;
  decimals: number;
  /** ISO currency the token tracks, used for reference FX rates. */
  currency: "USD" | "BRL" | "ARS" | "COP";
  /** EIP-712 domain for EIP-3009 transfers (only the dollar stables support it). */
  eip712?: { name: string; version: string };
}

// Celo mainnet. USD₮/USDC/USA₮ domains match the Celo x402 facilitator's asset table;
// wFIAT addresses are Ripio's published deployments.
export const TOKENS: Record<Symbol, Token> = {
  USAT: {
    symbol: "USAT",
    address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771",
    decimals: 6,
    currency: "USD",
    eip712: { name: "Tether America USD", version: "1" },
  },
  USDT: {
    symbol: "USDT",
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    decimals: 6,
    currency: "USD",
    eip712: { name: "Tether USD", version: "1" },
  },
  USDC: {
    symbol: "USDC",
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6,
    currency: "USD",
    eip712: { name: "USDC", version: "2" },
  },
  wBRL: {
    symbol: "wBRL",
    address: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0",
    decimals: 18,
    currency: "BRL",
  },
  wARS: {
    symbol: "wARS",
    address: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D",
    decimals: 18,
    currency: "ARS",
  },
  wCOP: {
    symbol: "wCOP",
    address: "0x8a1d45e102e886510e891d2ec656a708991e2d76",
    decimals: 18,
    currency: "COP",
  },
};

/** Clients pay invoices in USA₮. */
export const INVOICE_ASSET = TOKENS.USAT;

export function tokenBySymbol(symbol: string): Token {
  const token = TOKENS[symbol as Symbol];
  if (!token) throw new Error(`Unknown token ${symbol}`);
  return token;
}
