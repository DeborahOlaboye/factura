# Factura frontend

Next.js 16 (App Router), Tailwind 4, wagmi 3 and viem, with the x402 browser client.

| Route | Who | What |
|---|---|---|
| `/` | everyone | landing page |
| `/pay/[id]` | clients | the invoice as a document, wallet connect, USA₮ balance check, one-signature x402 payment, PAID stamp and receipt |
| `/app` | freelancers | connect → sign in with Ethereum → profile and payout split → invoices |
| `/app/new` | freelancers | draft an invoice from one sentence (paid LLM call through buy), edit, issue, copy the pay link |
| `/app/invoices/[id]` | freelancers | document, onchain timeline (ledger, settlement, conversions, payouts), client check, drafted reminders |
| `/app/settings` | freelancers | payout mode and currency split |

The agent runs separately. `next.config.ts` rewrites `/backend/*` to `FACTURA_AGENT_URL`, so sign-in, the API and the x402 payment headers all stay same-origin.

## Paying from the browser

The pay page wraps `fetch` with `@x402/fetch` and `ExactEvmScheme` from `@x402/evm`, using the connected wallet as the signer:

1. The request answers `402` with the exact USA₮ amount and payee.
2. The wallet signs one EIP-3009 authorization for that amount.
3. The retry settles through Celo's facilitator.
4. The `PAYMENT-RESPONSE` header carries the settlement tx.

The payer needs no CELO for gas.

## Run

```sh
cp .env.example .env.local
npm install
npm run dev        # http://localhost:3000, with the agent on FACTURA_AGENT_URL
npm run build && npm start
```

Set the agent's `FRONTEND_URL` to this app's public URL. Its host is the Sign-In with Ethereum domain, and it's where pay links point.
