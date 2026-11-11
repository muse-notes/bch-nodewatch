# BCH NodeWatch — Design (port of Portaldot NodeWatch to BCH, BCH BLAZE 2026 Mainnet Track)

Prepared 2026-11-07 by the port coordinator. Research sources: CashScript docs
(cashscript.org), mainnet-js, Chaingraph, Fulcrum, WizardConnect docs (Riften Labs).
Stack versions verified on npm 2026-11-07: `cashscript` 0.14.0, `cashc` 0.14.0,
`mainnet-js` **3.1.7** (pin exactly — npm `latest` tag is 4.0.0-next.13 prerelease,
do NOT install unpinned), `@wizardconnect/dapp` 0.2.2, `@wizardconnect/core` 0.2.5.

## Concept (unchanged from Portaldot version)

Node-health monitoring dashboard + on-chain registry of watched nodes.
Portaldot version: Solidity registry + dashboard polling EVM RPC every 6s.
BCH version: same concept, rebuilt on BCH primitives. Do NOT copy Solidity code.

## Hard fact that shapes the whole design

BCH script has **no persistent/global storage**. There is no `mapping`, no contract
state, no on-chain "list all nodes" query. State survives only as UTXOs:
a contract is a locking script on one UTXO; spending it must recreate an output
with the same (or evolved) locking script — a **covenant** using introspection
opcodes. Token commitments (max 40 bytes) can carry state.

## Registry design (CashTokens — the registry mechanism)

- **One CashToken category = the registry.** Genesis mints a single
  `minting`-capability NFT. Category ID = genesis txid. The minting NFT is
  locked in the CashScript covenant contract below (not in a plain wallet).
- **One node = one mutable NFT** in that category, minted from the minting NFT.
  Holdership of the NFT *is* the write permission for that node.
  - `register` = mint a mutable NFT with a commitment (anyone, via the contract).
  - `update` = spend the mutable NFT, recreate it with a new commitment (holder only).
  - `remove` = burn the mutable NFT (holder only).
- **NFT commitment (max 40 bytes), layout:**
  - bytes 0–19: nodeId = first 20 bytes of sha256(name + "|" + endpoint)
  - byte 20: status (1 = active, 2 = degraded)
  - bytes 21–24: lastSeenHeight, uint32 big-endian
  - bytes 25–26: latencyMs, uint16 big-endian
  - bytes 27–39: reserved, zero
- **OP_RETURN attestation** (no contract needed, from the node operator's address):
  prefix `NWATCH` + 1-byte version + 1-byte type (`R` register / `H` health /
  `U` update) + nodeId (20B) + payload. Register payload = name + endpoint as
  UTF-8 (total OP_RETURN payload ≤ 220 bytes). Health payload = height (4B) +
  latencyMs (2B) + timestamp (4B). Attestation tx can be pure OP_RETURN + fee.
- **The dashboard is the index, the chain is the audit trail.** Frontend queries
  Chaingraph (GraphQL) / Electrum for all UTXOs of the registry category +
  OP_RETURN attestations matching the `NWATCH` prefix, and renders the list.

## CashScript contract: `contracts/NodeWatchRegistry.cash`

`pragma cashscript ^0.14.0;` — locks the minting NFT. Single entry point with an
`action` parameter (register). Covenant rules, enforced by introspection:
1. The minting NFT must be recreated in an output with the **same locking
   script** (same contract address) and same category — the minting capability
   never leaves the contract.
2. The same tx must mint exactly one new mutable NFT of the same category,
   with a commitment of exactly 40 bytes whose status byte is 1 or 2.
3. The same tx must include an OP_RETURN output starting with `NWATCH` (the
   registration metadata: name + endpoint).
4. A fee/size sanity: at least one output pays the 1,000-sat dust convention
   where required; tx fee left to the builder (min relay fee 1 sat/byte).

Fallback if the covenant proves too hard: operator-held minting NFT (plain P2PKH),
documented honestly in the README/pitch as a centralization tradeoff. Do NOT
silently ship the fallback as if it were the covenant — record which one is live.

## Frontend: `frontend/index.html` (static, no build step — like the original)

Vanilla JS + `<script type="importmap">` pulling ESM from jsDelivr:
`cashscript@0.14.0`, `mainnet-js@3.1.7` (exact), `@wizardconnect/dapp@0.2.2`.
No React (WizardConnect has a non-React `DappConnectionManager` path).

Sections:
1. **Chain stats (live):** tip height, mempool size, fee tiers — from
   Chaingraph GraphQL (`https://gql.chaingraph.pat.mn/v1/graphql`) with Satview
   REST fallback (`https://satview.io/bch/api/v1/status`). Mainnet block time is
   ~10 min — do NOT poll every 6s; subscribe to headers via Electrum WSS and
   refresh stats every ~30s.
2. **Watched nodes table:** from Chaingraph query (registry-category UTXOs +
   `NWATCH` OP_RETURNs). Columns: #, name, endpoint/identifier, owner (NFT
   holder), status, last seen height, latency. Refresh every 30s.
3. **Probed infrastructure list (honest node health):** there is NO public
   BCH full-node-list API (verified: no Bitnodes equivalent; Coin Dance
   cash.coin.dance/nodes is HTML-only, no JSON API). So "nodes" = the public
   Electrum/Fulcrum servers the dashboard can actually probe
   (e.g. `wss://bch.imaginary.cash:50004`, `wss://electrum.imaginary.cash:50004`,
   `cashnode.bch.ninja:50002`, plus the 1209k table as a lead), each probed via
   Electrum `server.version` / `blockchain.headers.subscribe` for liveness,
   height vs. tip, and round-trip latency. Never claim a global BCH full-node
   census in UI copy or the pitch.
4. **Register a node (the mainnet-tx function):** WizardConnect connect
   (Paytaca first, Selene second) → dapp builds tx with CashScript
   `TransactionBuilder`, `placeholderP2PKHUnlocker` for user inputs →
   `generateWcTransactionObject({ broadcast: false })` with `inputPaths` →
   wallet signs (SIGHASH_ALL | SIGHASH_FORKID | SIGHASH_UTXOS) → broadcast via
   Electrum → show txid + explorer link (blockexplorer.cash).
   Cost per registration ≈ 1,000-sat output + ~250-sat fee ≈ 1,250 sats
   ≈ $0.0033 at ~$267/BCH (6 Nov 2026). Pure OP_RETURN attestation ≈ 200–300
   sats, under $0.001. Funding 0.01 BCH (~$2.67) covers hundreds of demos.
   **Mainnet funding needs the user's go-ahead — do NOT fund a mainnet wallet
   without reporting the exact amount first.**
5. **Health attest button:** sends a pure OP_RETURN `NWATCH|H|…` attestation.

## Scripts: `scripts/` (Node.js, ESM)

- `make-wallet.mjs` — generates a fresh chipnet wallet, prints address + WIF
  to stdout ONCE (testnet only). Never writes keys to any file.
- `genesis.mjs` — `CHIPNET_WIF` from env only; tokenGenesis the registry
  category (minting NFT), writes public results (category ID, genesis txid)
  to `frontend/config.json`. Refuses to run against mainnet.
- `deploy-contract.mjs` — compiles `contracts/NodeWatchRegistry.cash` with
  cashc, funds the contract address with chipnet coins, records the contract
  address + category ID in `frontend/config.json`. Refuses mainnet.
- `register-node.mjs` — scripted end-to-end demo tx on chipnet (register a
  node, print txid), for testing without the browser.
- All scripts: keys from env only, never saved; chipnet only (guard: refuse
  any mainnet network string).

## Testing

- Contract unit tests with CashScript `MockNetworkProvider`
  (v0.14.0 validates txs against the BCH VM by default): register succeeds
  with valid commitment; fails if minting NFT does not return to contract;
  fails if commitment length/status wrong; fails if OP_RETURN prefix missing.
- Chipnet end-to-end: faucet https://tbch.googol.cash (verified live page,
  network selector incl. chipnet, arithmetic CAPTCHA, no account/phone/email;
  actual claim untested — claim early, escalate in BLAZE Telegram if dry).
  Chipnet Electrum: `wss://chipnet.bch.ninja:50004`,
  `wss://chipnet.imaginary.cash:50004`. Explorer: https://chipnet.chaingraph.cash,
  https://blockexplorer.cash (chipnet). Record txids + explorer links in
  `docs/CHIPNET-EVIDENCE.md`.
- Frontend smoke test: serve `frontend/` statically, confirm stats load from
  chipnet, registry table renders, register flow reaches wallet-sign step.

## Submission prep (not this build — tracked separately)

- Widget Factory pitch template URL still unknown (not found by search) —
  get from DoraHacks submission page / BLAZE Telegram / prep stream.
- Telegram-channel confirmation + prep-stream attendance — pending.
- User contacts (Telegram + backup + Discord ID) still missing — do not invent.
- New repo for BCH work (BCH rules ask pre-existing projects for old + new
  repo links); old repo: https://github.com/muse-notes/nodewatch.
