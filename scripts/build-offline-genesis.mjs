// build-offline-genesis.mjs — build the SIGNED NWATCH genesis tx fully offline.
//
// The VM shell cannot reach chipnet Electrum (WSS blocked by the egress
// proxy, raw TCP blocked by the runtime, HTTP POST blocked) and cannot
// broadcast. This script does everything that does NOT need the network:
// it constructs and signs the genesis transaction from the confirmed faucet
// UTXO and prints the raw hex + txid. The parent broadcasts the hex from
// the browser (no keys involved in broadcast).
//
// Facts (verified 2026-11-07 ~05:00 +07):
// - Faucet tx 7996b0b388cf3929d8cadcffa812ca518a4b591d4f6fcb064cffbec863b22eb8
//   is CONFIRMED in chipnet block 331123 (mined 2026-11-06 21:28:58 UTC),
//   12+ confirmations at tip 331135 (Selene explorer).
// - It spent 1 input and created 2 outputs. Electron Cash `payto` puts the
//   payment first and change last, so our 0.01015 tBCH (1,015,000 sats)
//   output is vout 0. (NOT directly observed — tx pages hang from the
//   shell; the browser flow MUST verify the UTXO via Electrum listunspent
//   before broadcasting. If our output is vout 1 instead, this hex is
//   invalid and the fallback is a self-send hop to a vout-0 UTXO.)
// - CashTokens genesis rule (see mainnet-js tokenGenesis): the genesis
//   input must be a vout-0 UTXO, and the new category = that input's txid.
//   => categoryId = 7996b0b388cf3929d8cadcffa812ca518a4b591d4f6fcb064cffbec863b22eb8
// - Genesis output: minting NFT, empty commitment, 1000 sats, to the
//   operator wallet (P2PKH locking bytecode; token-aware address has the
//   same script as plain P2PKH).
//
//   CHIPNET_WIF=<wif> node scripts/build-offline-genesis.mjs
//
// Writes the signed hex + txid + category to scripts/out/genesis-tx.json
// (public data only — a signed transaction hex contains no secrets).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { binToHex, hash160, hexToBin } from '@bitauth/libauth';
import { assertChipnet, requireChipnetWif } from './lib.mjs';

assertChipnet();
const wif = requireChipnetWif();

const FAUCET_TXID = '7996b0b388cf3929d8cadcffa812ca518a4b591d4f6fcb064cffbec863b22eb8';
const FAUCET_VOUT = 0; // Electron Cash payto: payment first, change last (see header)
const FAUCET_VALUE = 1_015_000n; // 0.01015 tBCH
const CATEGORY_ID = FAUCET_TXID; // CashTokens genesis rule
const NFT_VALUE = 1000n;
const FEE = 500n; // ~2 sat/byte on a ~250-byte tx; chipnet accepts 1 sat/byte

const template = new SignatureTemplate(wif);
// P2PKH locking bytecode: OP_DUP OP_HASH160 <hash160(pubkey)> OP_EQUALVERIFY OP_CHECKSIG
const pkh = hash160(template.publicKey);
const p2pkhLock = new Uint8Array([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);

const provider = new MockNetworkProvider({ updateUtxoSet: true, validateTransactions: true });
provider.setBlockHeight(331135); // chipnet tip, Selene explorer 2026-11-07 ~05:00 +07

const faucetUtxo = {
  txid: FAUCET_TXID,
  vout: FAUCET_VOUT,
  satoshis: FAUCET_VALUE,
  lockingBytecode: binToHex(p2pkhLock),
};
provider.addUtxo(binToHex(p2pkhLock), faucetUtxo);

const builder = new TransactionBuilder({ provider })
  .addInput(faucetUtxo, template.unlockP2PKH())
  .addOutput({
    to: p2pkhLock,
    amount: NFT_VALUE,
    token: {
      category: CATEGORY_ID,
      amount: 0n,
      nft: { capability: 'minting', commitment: '' },
    },
  })
  .addOutput({
    to: p2pkhLock,
    amount: FAUCET_VALUE - NFT_VALUE - FEE,
  });

const hex = builder.build();
const fee = builder.calculateTransactionFee();
console.log(`Genesis raw tx (${hex.length / 2} bytes):`);
console.log(hex);
console.log(`Fee: ${fee.feeSats} sats (${fee.feeSatsPerByte} sat/byte)`);

// Validate + derive the txid offline via the mock provider (no network).
const txid = await provider.sendRawTransaction(hex);
console.log(`Genesis txid: ${txid}`);
console.log(`Category ID:  ${CATEGORY_ID}`);
console.log(`Explorer:     https://chipnet.chaingraph.cash/tx/${txid}`);
console.log(`              https://explorer.selene.cash/tx/${txid}?network=chipnet`);

// Independent decode check with libauth: libauth splits the token prefix
// out of lockingBytecode into output.token — verify that instead.
const { decodeTransactionUnsafe } = await import('@bitauth/libauth');
const decoded = decodeTransactionUnsafe(hexToBin(hex));
const out0 = decoded.outputs[0];
const token = out0.token;
if (!token) {
  console.error('DECODE CHECK FAILED: output 0 has no token');
  process.exit(1);
}
if (binToHex(token.category) !== CATEGORY_ID.toLowerCase()) {
  console.error(`CATEGORY MISMATCH: got ${binToHex(token.category)}, expected ${CATEGORY_ID}`);
  process.exit(1);
}
if (token.nft?.capability !== 'minting' || token.nft?.commitment?.length !== 0 || token.amount !== 0n) {
  console.error('TOKEN CHECK FAILED:', JSON.stringify(token));
  process.exit(1);
}
console.log('Token check OK: category == faucet txid, minting NFT, empty commitment, amount 0');
console.log(`Outputs: [0] ${out0.valueSatoshis} sats + minting NFT, [1] ${decoded.outputs[1].valueSatoshis} sats change`);

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'genesis-tx.json');
writeFileSync(
  outPath,
  `${JSON.stringify({ network: 'chipnet', categoryId: CATEGORY_ID, genesisTxid: txid, genesisTxHex: hex, feeSats: Number(FEE), faucetTxid: FAUCET_TXID, faucetVout: FAUCET_VOUT, note: 'Broadcast this hex from the browser. Verify the faucet UTXO is vout 0 via Electrum listunspent before broadcasting; if it is vout 1, DO NOT broadcast — rebuild after a self-send hop.' }, null, 2)}\n`,
);
console.log(`Wrote ${outPath}`);
