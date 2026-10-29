# Factura

Cross-border invoicing for LatAm freelancers billing US clients, settled in USA₮ over x402 on Celo.

Built for the Celo **Agents on Open Rails** hackathon. Primary track: **Open Corridors: USA₮ with x402**. It also uses wFIAT payouts (LatAm), Textile FX conversions and paid services through buy.

## The problem

Ana is a backend developer in São Paulo. Her clients are US startups. Today each invoice means:

- an international wire that takes 3–5 days and costs a fixed fee plus a bad FX spread;
- no way to check whether a new client is real before she starts work;
- chasing late payers by hand.

## What Factura does

1. **Issues the invoice.** Ana types "bill Acme $1,200 for October backend work, due the 15th". The agent drafts the invoice (Cencori LLM through buy), she confirms it, and it is recorded on the `FacturaLedger` contract.
2. **Vets the client.** In the background the agent pays for:
   - an OFAC name screen (Agent402);
   - the client's LinkedIn company page and X profile;
   - a two-line risk brief (Cencori).
3. **Takes payment over x402.** The pay link `GET /pay/:invoiceId` answers `402` with the exact USA₮ amount. The client pays from any x402 client: a wallet, another agent, or `buy curl --token USAT`. Celo's hosted facilitator settles it. Before verification, the payer wallet is screened against the OFAC SDN list and refused if listed.
4. **Converts and pays out.** In *managed* mode, the agent splits the USA₮ by Ana's rules (for example 50% USA₮, 50% wBRL):
   - one Textile RFQ for USA₮ → USD₮;
   - one RFQ per local leg for USD₮ → wBRL / wCOP;
   - every result is forwarded through the ledger.

   Each quote is checked against the market USD₮ rate first. A leg that can't be filled fairly is paid in dollars instead, and the reason is written on the invoice. In *direct* mode the client's USA₮ goes straight to Ana's wallet and the agent never touches it.
5. **Chases late payers.** Overdue invoices get a reminder drafted every three days.

### Why USA₮

The client is a US company. USA₮ is the GENIUS-Act-compliant dollar issued by Anchorage Digital Bank. That makes it the stablecoin a US business can hold and pay with without offshore-issuer questions from its accountant. The freelancer receives dollars or local currency on her own terms.

## Architecture

```
contracts/   Foundry. FacturaLedger: invoices, x402 settlements, conversions, payouts.
agent/       TypeScript (Node 22). Express server, x402 resource server, buy client,
             Textile RFQ client, treasury, vetting, SIWE sessions, ERC-8004 registration.
frontend/    Next.js 16 + wagmi. Landing page, client pay page (x402 in the browser),
             freelancer dashboard. Talks to the agent through a /backend rewrite.
```

| Piece | What it uses |
|---|---|
| Pay links | `@x402/express` + `@x402/evm` exact scheme, Celo facilitator `api.x402.celo.org`, USA₮ `0xD2ab…F771` |
| Payer screen | `onBeforeVerify` hook → Agent402 `sanctions/wallet` via buy |
| Settlement hook | `onAfterSettle` → `markPaid` on the ledger → managed payout |
| FX | Textile RFQ v2 (`/rfq/request`, approve, swap, `/submit`, status). Celo corridors: USA₮↔USD₮, USD₮↔wBRL, USD₮↔wCOP |
| Paid services | `@celo/buy` CLI (`buy curl --max-amount`), daily budget cap, every call logged with its settlement tx |
| Attribution | Every agent tx goes through one viem wallet client extended with `withAttribution(ATTRIBUTION_CODE)` (ERC-8021) |
| Identity | ERC-8004 IdentityRegistry `0x8004A169…a432`, registration file served at `/agent.json` |

### What the ledger guarantees

`FacturaLedger.payout(id, token, amount)` pulls from the agent and always sends to the invoice's `freelancer`. The agent chooses the token and amount. The contract fixes the destination. Conversions are logged with their swap tx (`Converted` event), so the whole path from the client's USA₮ to the freelancer's wBRL can be audited onchain.

### Paid services (buy)

| Service | Route | Cap per call |
|---|---|---|
| Cencori inference | `gateway.usebuy.ai/cencori/v1/chat/completions` | $0.01 |
| LinkedIn company (Ploid) | `gateway.usebuy.ai/v1/social/linkedin/tools/ploid-linkedin-company` | $0.023 |
| X user profile (TikHub) | `gateway.usebuy.ai/v1/social/x/tools/tikhub-api-v1-twitter-web-fetch-user-profile` | $0.005 |
| OFAC name screen | `agent402.tools/api/sanctions/name` | $0.005 |
| OFAC wallet screen | `agent402.tools/api/sanctions/wallet` | $0.002 |

`GET /api/paid-calls` lists every call with its purpose, invoice and settlement tx. `buy receipts --account factura --resolve` gives the same from buy's side.

## Running it

```sh
# contracts
cd contracts && forge build && forge test

# agent
cd ../agent && npm install
cp .env.example .env            # fill in the key, attribution code, x402 key, API token
npm run deploy:ledger           # deploys FacturaLedger (tagged), sets the agent as operator
npm run register:agent          # ERC-8004 identity from the agent wallet
npm run buy:import              # same wallet as the buy payer
npm start

# frontend
cd ../frontend && npm install
cp .env.example .env.local      # FACTURA_AGENT_URL=http://localhost:8402
npm run dev                     # http://localhost:3000
```

Freelancers sign in with their wallet (Sign-In with Ethereum, EIP-4361). The wallet that signs in is the wallet invoices pay out to. Clients need nothing but the pay link and a wallet holding USA₮ on Celo.

Tests:

```sh
npm test                                   # allocation maths, buy output parsing, vetting helpers
anvil --chain-id 42220 --port 18545 &
npm run e2e                                # ledger + settlement hook + managed payout on a local chain
```

The local run deploys the ledger and issues an invoice. It then feeds the settlement hook as if the facilitator had just settled the client's USA₮, and checks:

- the payout reaches the freelancer through the ledger;
- the invoice is marked paid onchain with the right payer and settlement tx;
- the ERC-8021 tag is on the agent's transactions.

Operator CLI (talks to `/api/admin`):

```sh
npm run invoice -- freelancer "Ana Souza" BR 0xHerWallet
npm run invoice -- draft "bill Acme Inc \$1200 for October backend work, due Nov 15"
npm run invoice -- create <freelancerId> '{"clientName":"Acme Inc","amountUsd":1200,"description":"October backend work","dueDate":"2026-11-15"}'
```

Paying an invoice from the command line:

```sh
npx @celo/buy curl --token USAT --max-amount 1200 https://<host>/pay/<invoiceId>
```

## REST API

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/auth/nonce` | — | SIWE nonce |
| POST | `/auth/verify` | — | `{ message, signature }` → session token |
| GET / POST | `/api/me` | session | the signed-in freelancer / create the profile |
| PUT | `/api/me/payout-rules` | session | change mode and split |
| POST | `/api/me/invoices/draft` | session | `{ text }` → structured draft (paid LLM call) |
| GET / POST | `/api/me/invoices` | session | list / issue (returns `payLink` and `x402Url`) |
| GET | `/api/me/invoices/:id` | session | one invoice with timeline data |
| POST | `/api/me/invoices/:id/cancel` | session | cancel an open invoice |
| POST | `/api/me/invoices/:id/vet` | session | re-run client vetting |
| * | `/api/admin/*` | `API_TOKEN` | operator routes (freelancers, invoices, `paid-calls`) |
| GET | `/pay/:id` | — | x402 pay link; a browser is redirected to the frontend pay page |
| GET | `/invoices/:id` | — | public invoice view |
| GET | `/agent.json` | — | ERC-8004 registration file |

Session tokens are HMAC-signed with `SESSION_SECRET` and last 7 days. `GET /api/admin/paid-calls` lists every buy call with its settlement tx.

## Notes and limits

- **Managed mode is custodial for the duration of one payout.** The client pays the agent's wallet, and the agent converts and forwards in the same flow. The ledger fixes where funds can go. Freelancers who don't want that use direct mode.
- **Textile depth decides the default split.** USD₮→wARS depth on Celo is thin, so Argentine freelancers default to USA₮/USD₮. BRL is deep both ways.
- **ERC-8021 tags:** x402 settlements are submitted by the facilitator and carry no tag yet. For those, the PayTo address is the attribution.
