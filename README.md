# NodeWatch

NodeWatch is a node-health dashboard plus an on-chain registry of watched nodes on Bitcoin Cash, built with CashScript and CashTokens.

## Status

- Contract compiles clean, 9/9 unit tests pass.
- Chipnet faucet claimed 0.01015 tBCH.
- Three deploy transactions were built and signed OFFLINE — they have NOT been broadcast and NOTHING is deployed on any chain yet.

## Live demo

Live demo (not deployed yet): https://muse-notes.github.io/bch-nodewatch-demo/

## Repository layout

- `contracts/` — CashScript contract source (`NodeWatchRegistry.cash`) and compiled artifact (`NodeWatchRegistry.json`)
- `docs/` — design, build status and Chipnet evidence
- `frontend/` — demo frontend (`index.html`, `config.json`)
- `scripts/` — deploy, genesis and registration scripts, including offline transaction builders
- `scripts/out/` — signed offline transactions (deploy, genesis, register) — built offline, not broadcast
- `tests/` — contract unit tests

## Notes

Nothing in this repository is deployed on any chain yet. The signed transactions in `scripts/out/` were built and signed offline and have not been broadcast.
