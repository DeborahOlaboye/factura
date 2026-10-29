import { createConfig, http } from "wagmi";
import { celo } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * Celo mainnet only. Injected wallets cover MetaMask, Rabby, Coinbase Wallet's extension,
 * Valora and MiniPay (which injects its own provider into the in-app browser).
 */
export const wagmiConfig = createConfig({
  chains: [celo],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [celo.id]: http(process.env.NEXT_PUBLIC_CELO_RPC ?? "https://forno.celo.org") },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export const USAT = {
  address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771",
  decimals: 6,
  symbol: "USA₮",
} as const;

export const TOKEN_LABEL: Record<string, string> = {
  USAT: "USA₮",
  USDT: "USD₮",
  USDC: "USDC",
  wBRL: "wBRL",
  wARS: "wARS",
  wCOP: "wCOP",
};

export const TOKEN_DECIMALS: Record<string, number> = { USAT: 6, USDT: 6, USDC: 6, wBRL: 18, wARS: 18, wCOP: 18 };

export const explorerTx = (hash: string) => `https://celoscan.io/tx/${hash}`;
export const explorerAddress = (address: string) => `https://celoscan.io/address/${address}`;
