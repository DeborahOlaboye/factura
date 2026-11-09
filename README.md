<p align="center"><img src="frontend/public/brand/logo-light.png" alt="Factura" width="360"></p>

# Factura

**Invoicing agent for freelancers who bill US clients.** The client pays in USA₮ over x402 on Celo: one signature, no gas, settled in seconds. The agent vets new clients, refuses sanctioned payers, and converts the proceeds into the currency the freelancer wants on Textile FX.

Built for the Celo **Agents on Open Rails** hackathon. Primary track: **Open Corridors: USA₮ with x402**. Also entered in **Build with buy**.

| | |
|---|---|
| Web app | https://factura-teal.vercel.app |
| Demo video | https://youtu.be/z3wsOswJxQk |
| Agent | https://factura-agent.onrender.com (`/health`, `/agent.json`) |
| Agent wallet (x402 PayTo) | [`0xa3C1bDd50A36BbC008a9B49034C93dA6DC3b9e68`](https://celoscan.io/address/0xa3C1bDd50A36BbC008a9B49034C93dA6DC3b9e68) |
| ERC-8004 identity | agent [**#10004**](https://erc-8004.quicknode.com/agents/celo-mainnet/10004) on the Celo IdentityRegistry [`0x8004A169…a432`](https://celoscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) |
| FacturaLedger | [`0xb0ecc1e95455598d5bace76e3d4e0c0aa565835a`](https://celoscan.io/address/0xb0ecc1e95455598d5bace76e3d4e0c0aa565835a#code): source verified on Celoscan and an exact match on [Sourcify](https://repo.sourcify.dev/42220/0xb0ecc1e95455598d5bace76e3d4e0c0aa565835a) |
| ERC-8021 attribution code | `celo_5d8268ac8bc0`, on every transaction the agent sends |

## The problem

A freelancer outside the US who bills a US company today:

- waits 3–5 business days for an international wire, and loses money on fees and on an exchange rate the bank doesn't show;
- has no way to check a new client before starting work, which is how "new client, wants work started today" scams land;
- chases late payers by hand.

## What Factura does

1. **Drafts the invoice from one sentence.** "Bill Acme $1,200 for October backend work, due the 15th." An LLM (Agent402's nano chat tier, paid per call) turns it into a draft, with a plain local reading as the fallback if the model is down; the freelancer reviews every field and issues it. The invoice is recorded on the FacturaLedger contract.
2. **Vets the client.** The agent pays for an OFAC name screen (Agent402), the client's LinkedIn company page and X profile, and a two-line risk brief. Only an exact or full-name match against a sanctioned person or organisation blocks; partial overlaps are flagged for review.
3. **Takes payment over x402.** The pay link (`/pay/:invoiceId`) answers `402 Payment Required` with the exact USA₮ amount. The client signs one EIP-3009 authorization from any wallet or any x402 client (`buy curl --token USAT …` works too). Before verification the payer's wallet is screened against the OFAC SDN list; a sanctioned wallet is refused before any money moves.
4. **Pays out by the freelancer's rules.** By default the client pays the agent wallet, and the agent splits the proceeds as the freelancer chose: keep USA₮, convert to USD₮, or convert part to a local-currency stablecoin (wBRL, wCOP) on Textile FX, with every quote checked against the market rate. Each payout goes through the ledger, which can only pay the invoice's freelancer.
5. **Chases late payers.** Overdue invoices get a reminder drafted every three days.

### Why USA₮

The payer is a US company. USA₮ is the GENIUS-Act-compliant dollar issued by Anchorage Digital Bank: the stablecoin a US business can hold and pay with without offshore-issuer questions from its accountant. The freelancer receives dollars or local currency on their own terms.

## Evidence for the judges

| Criterion | Where to check |
|---|---|
| Real USA₮ settlement over x402 | Payments settle through Celo's facilitator (`api.x402.celo.org`) to the PayTo wallet above; each one is recorded on the ledger as `InvoicePaid` with the settlement tx. Example, invoice FAC-0006: client's USA₮ settlement [`0x1584f640…8505`](https://celoscan.io/tx/0x1584f640eb1faee6f90796ec02eaf9e24e3712b8731ae590a0cc5aba763e8505) → `InvoicePaid` [`0xf4203cb2…eb70`](https://celoscan.io/tx/0xf4203cb21700be5cdd38a0223b61df18d8b7d2ea7997caf56e401de9611eeb70) → payout to the freelancer `PayoutSent` [`0x5a28ca11…b073`](https://celoscan.io/tx/0x5a28ca11d3fa99a1072468743faf26192e34a0b98e09a390006da3c64a10b073) |
| ERC-8004 identity from the agent wallet | registration tx [`0x9d87f21b…4d4f`](https://celoscan.io/tx/0x9d87f21b1ab3a3346019f1d214dba26f34bcd16b763dc43f0b812e7756df4d4f); registration file at https://factura-agent.onrender.com/agent.json |
| Attribution tag on every agent transaction | ledger deploy [`0x0399a590…4d74`](https://celoscan.io/tx/0x0399a590af504e84707755d3c464a8601e52886c6c933112b9cb163de0244d74), operator [`0xe7c5cc78…24f2`](https://celoscan.io/tx/0xe7c5cc781baf9067790b26890a77ed7460730cf1f72bd91cfbf556087cb924f2), registration, swaps and payouts all end in the `celo_5d8268ac8bc0` ERC-8021 suffix |
| Paid calls into services we don't control (buy) | see the table below |

### Paid services (Build with buy)

| Service | Route | Price | Example settlement |
|---|---|---|---|
| LLM chat completions (Agent402 nano tier) | `agent402.tools/v1/nano/chat/completions` | $0.003 | [`0xab930744…af6b`](https://celoscan.io/tx/0xab930744a466a03a21c1f9ceefede6992ec1e8c3b8f24206cb88f00551acaf6b) |
| Cencori LLM (via buy), until Cencori retired the only model buy serves | `gateway.usebuy.ai/cencori/v1/chat/completions` | $0.01 | [`0xf7ede2f9…d493`](https://celoscan.io/tx/0xf7ede2f959bea04180f1aebb2844bfbe7ed171a6af2b859a4790c61d2b7bd493), [`0x6ba3b25f…c6d3`](https://celoscan.io/tx/0x6ba3b25fafe9cdf416b0a1e199ed303003d6a765c515adc3c83df448e3a5c6d3), [`0x118fecae…e130`](https://celoscan.io/tx/0x118fecae154ad1510986bdb6009f15766fd23bfa9f02d955391433ab2f53e130) |
| OFAC name screen (Agent402) | `agent402.tools/api/sanctions/name` | $0.005 | [`0xa4f3759a…5cd8`](https://celoscan.io/tx/0xa4f3759a67564ad16fc6ccf1e7cc6e2a418e676c07c2680edbe44dd7ebfa5cd8) |
| OFAC wallet screen (Agent402) | `agent402.tools/api/sanctions/wallet` | $0.002 | on each payment |
| LinkedIn company (Ploid, via buy) | `gateway.usebuy.ai/v1/social/linkedin/tools/ploid-linkedin-company` | $0.023 | when the client gives a company |
| X profile (TikHub, via buy) | `gateway.usebuy.ai/v1/social/x/tools/tikhub-api-v1-twitter-web-fetch-user-profile` | $0.005 | when the client gives a handle |

The agent pays these 402s itself with an x402 client signing from its wallet (x402 v1 for buy's gateway, v2 for Agent402), choosing a stablecoin it holds enough of. Every call has a hard price cap, the agent has a daily budget, and every payment is logged with its settlement tx: `GET /api/admin/paid-calls`.

### Gas and relayers

- **Client payments:** the client only signs an EIP-3009 authorization. Celo's x402 facilitator submits it and pays the gas. The PayTo is the agent wallet above.
- **Paid service calls:** settled the same way by the service's facilitator; the agent wallet signs.
- **Everything else** (ledger writes, payouts, Textile swaps, ERC-8004 registration) is sent and paid for by the agent wallet in CELO, and tagged.

## Architecture

```
contracts/   Foundry. FacturaLedger: invoices, x402 settlements, conversions, payouts.
agent/       TypeScript (Node 22, Express). x402 resource server, x402 client for paid
             services, Textile RFQ client, treasury, client vetting, SIWE sessions,
             Postgres-backed store, ERC-8004 registration.
frontend/    Next.js 16 + wagmi. Landing page, client pay page (x402 from the browser
             wallet), freelancer dashboard.
```

**What the ledger guarantees.** `FacturaLedger.payout(id, token, amount)` pulls from the agent and always sends to the invoice's `freelancer`. The agent chooses the token and amount; the contract fixes the destination. Conversions are logged with their swap tx (`Converted`), so the path from the client's USA₮ to the freelancer's payout is auditable onchain.

| Piece | Implementation |
|---|---|
| Pay links | `@x402/express` + `@x402/evm` exact scheme, USA₮ `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771`, dynamic price and PayTo per invoice |
| Payer screen | `onBeforeVerify` hook → Agent402 wallet screen |
| Settlement | `onAfterSettle` → `markPaid` on the ledger → payout |
| FX | Textile RFQ v2: request (EIP-712 TakerControl proof), approve, swap, submit, status |
| Attribution | one viem wallet client extended with `withAttribution(ATTRIBUTION_CODE)` |
| Freelancer sign-in | Sign-In with Ethereum (EIP-4361); the wallet that signs in is the wallet that gets paid |
| Storage | in-memory store persisted to Postgres (`DATABASE_URL`) or a JSON file |

## Running it

You need Node.js 22.13 or later and [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, and `anvil` for the end-to-end test). Without keys you can build, run every test and start the web app; the agent itself needs a funded Celo key and an x402 facilitator key to start.

```sh
# contracts
cd contracts && forge build && forge test

# agent
cd ../agent && npm install
cp .env.example .env      # agent key, attribution code, x402 key, API token, SESSION_SECRET
npm run deploy:ledger     # FacturaLedger from the agent wallet (tagged), agent set as operator
npm run register:agent    # ERC-8004 identity from the agent wallet
npm start

# web app
cd ../frontend && npm install
cp .env.example .env.local   # FACTURA_AGENT_URL=http://localhost:8402
npm run dev
```

Tests:

```sh
cd contracts && forge test     # 15 ledger tests
cd agent && npm test           # allocation maths, x402 receipts, token choice, vetting rules
anvil --chain-id 42220 --port 18545 &
npm run e2e                    # ledger + settlement hook + payout on a local chain
```

### Deployment

- **Agent:** Render (free plan) from `agent/Dockerfile`, described by `render.yaml`. State lives in Postgres via `DATABASE_URL`. The agent pings its own public `/health` every 10 minutes so the free instance doesn't sleep; `.github/workflows/keepalive.yml` wakes it as a backup (GitHub runs it every few hours).
- **Web app:** Vercel with root directory `frontend` and `FACTURA_AGENT_URL` set to the agent's URL. The production build fails if it's missing.

## API

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/pay/:id` | — | x402 pay link; a browser is redirected to the web app's pay page |
| GET | `/invoices/:id` | — | public invoice view |
| GET | `/agent.json`, `/logo.png` | — | ERC-8004 registration file and image |
| GET/POST | `/auth/nonce`, `/auth/verify` | — | Sign-In with Ethereum |
| * | `/api/me/*` | session | profile, payout rules, invoices, drafting, cancel, re-run vetting |
| * | `/api/admin/*` | `API_TOKEN` | operator routes, including `paid-calls` |

## What the contract enforces, and what it trusts

- **Enforced:** a payout can only go to the invoice's freelancer, and only once the invoice is marked paid (`paidOut` records every token sent); only the freelancer or an operator can create or cancel an open invoice for that freelancer; only an operator can mark it paid or record a conversion. The ledger holds no funds: `payout` pulls from the operator's own balance.
- **Attested:** `markPaid` is called by the operator after the facilitator settles; the contract can't see the x402 settlement itself. Each `InvoicePaid` carries the settlement tx hash, so anyone can check the matching USA₮ transfer to the PayTo wallet.
- **Self-issued invoices are allowed:** a freelancer can record their own invoice on the ledger without Factura. The agent only acts on invoices it issued.
- **Separate owner and operator keys:** the agent wallet signs every agent transaction, is the x402 PayTo and is the ledger's operator. The ledger's owner (the only role that can add or remove operators) is a separate team wallet, [`0x9CB49e92…4237`](https://celoscan.io/address/0x9CB49e92D3E6EDfC4F8DCA3e5a20C5b142FC4237), handed over through `Ownable2Step`: offered by the agent in [`0xb7d641e7…15e5`](https://celoscan.io/tx/0xb7d641e779574ec6b2dcbfb142405ab4017056625167fe7b30d15286327115e5), accepted in [`0x041aeb5a…7111`](https://celoscan.io/tx/0x041aeb5a63901d7c22988ce3afe513d8335162b08c1f01fdf61f48d231737111). A leaked agent key can't appoint new operators.

## Limits

- **Managed payouts hold the client's USA₮ for one payout.** The ledger fixes where it can go. Freelancers who prefer can switch to "straight to my wallet"; those payments go to their own wallet and aren't credited to Factura's PayTo.
- **Textile's minimum is about $1 per conversion.** Smaller shares stay in USA₮.
- **Amounts go down to $0.000001**, one unit of USA₮.
