# Chipnet Evidence — BCH NodeWatch

## Status: PRE-SIGNED OFFLINE, AWAITING BROADCAST (2026-11-07 ~05:00 +07)

The contract is NOT on-chain yet. All three transactions are built,
signed and validated offline (CashScript `TransactionBuilder.build()` +
`MockNetworkProvider` validation; the register tx additionally passed
`builder.debug()` — the covenant evaluates cleanly in the VM). The only
missing step is broadcast, which the VM shell cannot do (see blockers).

## Wallet (chipnet)

- Address: `bchtest:qzucarquaq4c2en0zc7e58gxq7wckyca7cyhsu9l8g`
- WIF: `~/workspace/earning/bch-chipnet-wallet.json` (chmod 600, env only)
- Faucet funding: **0.01015 tBCH (1,015,000 sats)**

## Faucet tx — CONFIRMED

- Txid: `7996b0b388cf3929d8cadcffa812ca518a4b591d4f6fcb064cffbec863b22eb8`
- Block: **331123** (mined 2026-11-06 21:28:58 UTC), 12+ confirmations at
  tip 331135 (Selene explorer, `explorer.selene.cash`,
  `/overview/live?network=chipnet`).
- Spent 1 input, created 2 outputs (total 1,403.622528 BCH). Electron
  Cash `payto` puts the payment first, so our output is **vout 0**
  (inferred from the faucet's source — `ec_slp_lib.prepare_bch_transaction`
  calls Electron Cash daemon `payto`; payment output first, change last).
  NOT directly observed: tx/address pages hang from the shell. **Verify
  via Electrum listunspent before broadcasting; if our output is vout 1,
  DO NOT broadcast the pre-signed hexes — rebuild after a self-send hop
  to a vout-0 UTXO.**
- Category ID (CashTokens genesis rule: category = genesis input's txid):
  `7996b0b388cf3929d8cadcffa812ca518a4b591d4f6fcb064cffbec863b22eb8`

## Pre-signed transactions (scripts/out/*.json — hex + txid)

| Step | Txid | Size / fee | Explorer (after broadcast) |
| ---- | ---- | ---------- | -------------------------- |
| Genesis (minting NFT) | `6bb05691ed2b8d8674dbacf53e141ed179634fac30e9e530484e6c22ec438dc0` | 253 B / 500 sats | https://explorer.selene.cash/tx/6bb05691ed2b8d8674dbacf53e141ed179634fac30e9e530484e6c22ec438dc0?network=chipnet |
| Deploy (NFT → contract, 10,000 sats) | `45d0c45f749e16027d02b08feabf3aa335f46a7ec4f332eb610d3efb70ca3926` | 404 B / 800 sats | https://explorer.selene.cash/tx/45d0c45f749e16027d02b08feabf3aa335f46a7ec4f332eb610d3efb70ca3926?network=chipnet |
| Register (node `chipnet-demo-node`) | `cb5f072886cb7cd8c3b013df4d99b13b67b624207ae897f8ae2d42c9321eb07e` | 644 B / 900 sats | https://explorer.selene.cash/tx/cb5f072886cb7cd8c3b013df4d99b13b67b624207ae897f8ae2d42c9321eb07e?network=chipnet |

- Contract address: `bchtest:p0456dspvll05uvttsk3q4829a76m0d5t2v265qjtkn2kk3ngarq59nfvw6l5`
- Contract token address: `bchtest:r0456dspvll05uvttsk3q4829a76m0d5t2v265qjtkn2kk3ngarq5hq4dhmxl`
- Node: `chipnet-demo-node`, `wss://chipnet.imaginary.cash:50004`,
  nodeId `f427f1332868bde5c6dbe855fb1712347b1f1b69`, commitment height 331135.
- Rebuild offline any time: `npm run build-offline`
  (runs genesis → deploy → register; needs `CHIPNET_WIF` in env).

## Why the shell cannot broadcast (all proven 2026-11-07)

1. **HTTP POST is blocked by the VM egress proxy.** GET works
   (google/httpbin 200 in <1 s); every POST hangs to timeout —
   httpbin.org, postman-echo.com, Chaingraph GraphQL. No REST broadcast
   endpoint is reachable, and Chaingraph GraphQL (POST-only) is dead.
2. **Electrum WSS is unreachable.** The egress proxy allows CONNECT
   tunnels to port 443 only (verified: CONNECT to
   chipnet.imaginary.cash:50004 and :50002 times out, :443 succeeds).
   mainnet-js / CashScript only speak WSS, so `npm run genesis` fails
   with WebSocket 1006.
3. **Raw TCP Electrum is blocked by the runtime.** `net.connect` to
   :50001 returns the interceptor message: "Other TCP connections is
   turned off for this assistant. To allow it, ask the user to open Muse
   settings -> Permissions -> Direct network protocols and switch
   other_tcp from Deny to Ask."
4. **Explorer dynamic pages hang from the shell.** tx/address pages on
   chipnet.imaginary.cash, chipnet.chaingraph.cash and explorer.selene.cash
   never respond (55 s timeouts); only static roots, Selene block pages
   and Selene `/overview/live` JSON answer. The faucet tx was confirmed
   by scanning Selene block pages 331120–331135 (found in 331123, p.2).

## How to complete (broadcast from the browser — no keys needed)

Broadcast is just publishing three already-signed hex blobs; no private
key is involved at this step.

1. In the live browser, verify the faucet UTXO first: open a chipnet
   Electrum view for `bchtest:qzucarquaq4c2en0zc7e58gxq7wckyca7cyhsu9l8g`
   (or run the existing scripts from a machine with WSS access) and
   confirm our 1,015,000-sat output is **vout 0** of
   `7996b0b3…22eb8`. If it is vout 1, STOP and rebuild after a self-send.
2. Broadcast in order, waiting for 1 confirmation between steps:
   a. `scripts/out/genesis-tx.json` → `genesisTxHex`
      (expect txid `6bb05691…38dc0`, category `7996b0b3…22eb8`).
   b. `scripts/out/deploy-tx.json` → `deployTxHex`
      (expect txid `45d0c45f…a3926`).
   c. `scripts/out/register-tx.json` → `registerTxHex`
      (expect txid `cb5f0728…eb07e`).
   Any explorer broadcast page works (Selene / imaginary.cash), or an
   Electrum `blockchain.transaction.broadcast` call from the browser.
3. After all three confirm, flip `frontend/config.json`:
   `deployed: true`, drop `broadcastPending`, and copy
   `contracts/NodeWatchRegistry.json` next to `frontend/index.html`.
4. Alternative without the browser: flip `other_tcp` to Ask in Muse
   settings (see blocker 3) — then the existing
   `npm run genesis && npm run deploy && npm run register` scripts work
   from the VM as written. Or run them from any machine with direct
   WSS access to chipnet Electrum.

## Unit-test evidence (no chain needed)

`npm test` — 9/9 pass (see `tests/NodeWatchRegistry.test.mjs`).
Covenant `builder.debug()` on the pre-signed register tx: SUCCESS.

## Old throwaway wallet (abandoned)

- `bchtest:qrcs39qa4ye2alu5myvgvddqtd4d5cyuxv3yrx7unv`, balance 0.
  Superseded by the funded wallet above.
