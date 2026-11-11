# BCH NodeWatch — Build Status

Date: 2026-11-07. Stack: `cashscript@0.14.0`, `cashc@0.14.0`, `mainnet-js@3.1.7`
(pinned exactly), Node 24, vitest 3.2.4. See `docs/DESIGN.md` for the design.

## What is done

- **Contract** `contracts/NodeWatchRegistry.cash` (`pragma cashscript ^0.14.0`,
  no constructor args) — locks the registry minting NFT. Single `register()`
  function, enforced by introspection:
  - output 0 recreates the minting NFT to the same contract (same locking
    script, same token category + minting capability, same commitment, same
    value);
  - output 1 mints exactly one new mutable NFT of the same category with a
    40-byte commitment (nodeId 20B | status 1 or 2 | height u32 BE | latency
    u16 BE | 13 zero bytes reserved);
  - output 2 is an OP_RETURN starting `0x6a 0x06 "NWATCH"`;
  - outputs are exactly 3, or 4 with a token-free change output — so no
    second NFT can be minted.
  Compiles clean with `cashc` (no warnings). Artifact:
  `contracts/NodeWatchRegistry.json`.
- **Unit tests** `tests/NodeWatchRegistry.test.mjs` — **9/9 pass**
  (`npx vitest run`): valid register (status 1 and 2); minting NFT sent
  elsewhere fails; minting NFT burned fails; 39-byte commitment fails;
  status 3 fails; missing NWATCH OP_RETURN fails; wrong OP_RETURN prefix
  fails; second mutable NFT in change output fails.
- **Scripts** `scripts/` (ESM, keys from env only, chipnet only, mainnet
  refused): `make-wallet.mjs`, `genesis.mjs`, `deploy-contract.mjs`,
  `register-node.mjs`, shared `scripts/lib.mjs`. Mainnet guards verified
  (`BCH_NETWORK=mainnet` → refuse, exit 1).
- **Chipnet wallet generated** (throwaway, testnet only):
  `bchtest:qrcs39qa4ye2alu5myvgvddqtd4d5cyuxv3yrx7unv` — WIF printed to
  stdout once by `make-wallet.mjs` and NOT stored in any file. The operator
  holds it in env as `CHIPNET_WIF`.

## What is NOT done — chipnet end-to-end: PRE-SIGNED, AWAITING BROADCAST

- UPDATE 2026-11-07 ~05:00 +07 (supersedes the faucet-CAPTCHA block below):
  faucet claimed — **0.01015 tBCH** to the new wallet
  `bchtest:qzucarquaq4c2en0zc7e58gxq7wckyca7cyhsu9l8g`, tx
  `7996b0b3…22eb8` confirmed in chipnet block 331123. All three txs built
  + signed OFFLINE (`scripts/out/genesis|deploy|register-tx.json`,
  expected txids `6bb05691…38dc0` / `45d0c45f…a3926` /
  `cb5f0728…eb07e`); contract address, category ID and txids are
  pre-computed in `frontend/config.json` (`deployed: false`,
  `broadcastPending: true`). Full evidence:
  `docs/CHIPNET-EVIDENCE.md`. The old throwaway wallet
  `bchtest:qrcs39qa4ye2alu5myvgvddqtd4d5cyuxv3yrx7unv` is abandoned.
- Remaining single blocker: faucet output assumed vout 0 (inferred from
  Electron Cash `payto` ordering) — NOT directly observed. Verify via
  Electrum listunspent / explorer before broadcasting; if it is vout 1,
  DO NOT broadcast — rebuild after a self-send hop. A browser vout check
  launched 2026-11-07 ~07:26 failed to start (no pages opened).
- To unblock (operator / parent agent):
  1. Verify vout 0 of `7996b0b3…22eb8` for
     `bchtest:qzucarquaq4c2en0zc7e58gxq7wckyca7cyhsu9l8g`
     (browser Electrum view, or any machine with WSS access).
  2. Broadcast the three hexes in order from the browser (no private key
     needed), 1 confirmation between steps — see
     `docs/CHIPNET-EVIDENCE.md` "How to complete".
     Alternative: flip `other_tcp` Deny → Ask in Muse settings, then
     `npm run genesis && npm run deploy && npm run register` work from
     the VM as written.
  3. After all three confirm, flip `frontend/config.json`:
     `deployed: true`, drop `broadcastPending`.
- **Second blocker found 2026-11-07 ~21:10: chipnet Electrum is unreachable
  from this VM.** `ElectrumNetworkProvider('chipnet')` fails with
  `WebSocket: 1006`, and raw WebSocket probes to
  `wss://chipnet.imaginary.cash:50004`, `wss://chipnet.bch.ninja:50004` and
  `wss://blackie.c3-soft.com:64004` all time out (10 s each). A mainnet-js
  balance check also hung with no output for 5+ minutes (killed). So even
  after the faucet claim, `genesis`/`deploy`/`register` may hang or fail
  from this VM until Electrum connectivity works — retry from another
  network, or set `CHIPNET_ELECTRUM=<chipnet Electrum hostname>` (e.g.
  `chipnet.imaginary.cash`) for the CashScript-based scripts
  (`deploy`, `register`); mainnet-js (`genesis`) uses its own server list
  (`wss://chipnet.imaginary.cash:50004`) with no override.

## What is NOT done — mainnet (needs the user's go-ahead)

- **Mainnet is NOT funded and NOT deployed. Do NOT fund it without the
  user's explicit go-ahead.**
- Exact mainnet funding needed (per DESIGN.md cost model, ~$267/BCH):
  - Contract funding: **0.01 BCH** (~$2.67) to the contract/operator wallet.
    That covers the 10,000-sat contract UTXO plus genesis + deploy fees,
    and leaves headroom for hundreds of demo registrations (each register
    ≈ 1,250 sats ≈ $0.0033: 1,000-sat NFT dust + ~250-sat fee; pure
    OP_RETURN attestation ≈ 200–300 sats).
  - Minimum viable: 0.001 BCH (~$0.27) would cover genesis + deploy +
    a few registers, but 0.01 BCH is the recommended amount so demos do
    not stall mid-event.
  - No mainnet script exists yet on purpose: the chipnet scripts refuse
    mainnet. A mainnet run needs a separate, explicitly approved step
    (new wallet / funding tx) — it is not a flag flip.
- The covenant contract itself is the real implementation, NOT the
  operator-held fallback: the fallback (plain-P2PKH minting NFT) was not
  needed and is not shipped.
