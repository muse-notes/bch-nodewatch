// build-offline-deploy.mjs — build the SIGNED contract-funding tx offline.
//
// Spends the (not yet broadcast) genesis outputs:
//   - genesis txid:0 — 1000 sats + minting NFT of the NWATCH category
//   - genesis txid:1 — 1,013,500 sats plain BCH (change)
// and locks the minting NFT in the NodeWatchRegistry covenant with
// 10,000 sats. Must be broadcast AFTER the genesis tx confirms.
//
//   CHIPNET_WIF=<wif> node scripts/build-offline-deploy.mjs
//
// Writes scripts/out/deploy-tx.json (public data: signed hex + txid +
// contract address). Chain: genesis-tx.json must exist first.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, ElectrumNetworkProvider, MockNetworkProvider, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { binToHex, hash160, hexToBin } from '@bitauth/libauth';
import { assertChipnet, requireChipnetWif, CONTRACT_SRC, CONTRACT_ARTIFACT } from './lib.mjs';

assertChipnet();
const wif = requireChipnetWif();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const genesis = JSON.parse(readFileSync(join(ROOT, 'scripts', 'out', 'genesis-tx.json'), 'utf8'));
const CATEGORY_ID = genesis.categoryId;
const GENESIS_TXID = genesis.genesisTxid;

const CONTRACT_FUNDING_SATS = 10_000n;
const FEE = 800n; // ~2 sat/byte on a ~400-byte tx

const template = new SignatureTemplate(wif);
const pkh = hash160(template.publicKey);
const p2pkhLock = new Uint8Array([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);

// 1. Compile + derive the contract address (pure local; the Electrum
//    provider is constructed but never connects).
execFileSync('./node_modules/.bin/cashc', [CONTRACT_SRC, '--output', CONTRACT_ARTIFACT], { stdio: 'inherit' });
const artifact = JSON.parse(readFileSync(CONTRACT_ARTIFACT, 'utf8'));
const electrumProvider = new ElectrumNetworkProvider('chipnet');
const contract = new Contract(artifact, [], { provider: electrumProvider, contractType: 'p2sh32' });
console.log(`Contract address: ${contract.address}`);
console.log(`Contract token address: ${contract.tokenAddress}`);
const contractLock = hexToBin(contract.lockingBytecode);

// 2. Inputs: genesis NFT UTXO + genesis change UTXO.
const nftUtxo = {
  txid: GENESIS_TXID,
  vout: 0,
  satoshis: 1000n,
  lockingBytecode: binToHex(p2pkhLock),
  token: { category: CATEGORY_ID, amount: 0n, nft: { capability: 'minting', commitment: '' } },
};
const changeUtxo = {
  txid: GENESIS_TXID,
  vout: 1,
  satoshis: 1_013_500n,
  lockingBytecode: binToHex(p2pkhLock),
};

const provider = new MockNetworkProvider({ updateUtxoSet: true, validateTransactions: true });
provider.setBlockHeight(331135);
provider.addUtxo(binToHex(p2pkhLock), nftUtxo);
provider.addUtxo(binToHex(p2pkhLock), changeUtxo);

const builder = new TransactionBuilder({ provider })
  .addInput(nftUtxo, template.unlockP2PKH())
  .addInput(changeUtxo, template.unlockP2PKH())
  .addOutput({
    to: contractLock,
    amount: CONTRACT_FUNDING_SATS,
    token: { category: CATEGORY_ID, amount: 0n, nft: { capability: 'minting', commitment: '' } },
  })
  .addOutput({
    to: p2pkhLock,
    amount: 1000n + 1_013_500n - CONTRACT_FUNDING_SATS - FEE,
  });

const hex = builder.build();
const fee = builder.calculateTransactionFee();
console.log(`Deploy raw tx (${hex.length / 2} bytes), fee: ${fee.feeSats} sats (${fee.feeSatsPerByte} sat/byte)`);

const txid = await provider.sendRawTransaction(hex);
console.log(`Deploy txid: ${txid}`);
console.log(`Explorer:    https://explorer.selene.cash/tx/${txid}?network=chipnet`);

const { decodeTransactionUnsafe } = await import('@bitauth/libauth');
const decoded = decodeTransactionUnsafe(hexToBin(hex));
const out0 = decoded.outputs[0];
if (!out0.token || binToHex(out0.token.category) !== CATEGORY_ID.toLowerCase() || out0.token.nft?.capability !== 'minting') {
  console.error('DEPLOY TOKEN CHECK FAILED');
  process.exit(1);
}
console.log(`Token check OK: output 0 = ${out0.valueSatoshis} sats + minting NFT to contract; output 1 = ${decoded.outputs[1].valueSatoshis} sats change`);

const outDir = join(ROOT, 'scripts', 'out');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'deploy-tx.json');
writeFileSync(outPath, `${JSON.stringify({ network: 'chipnet', categoryId: CATEGORY_ID, contractAddress: contract.address, contractTokenAddress: contract.tokenAddress, contractFundingSats: Number(CONTRACT_FUNDING_SATS), deployTxid: txid, deployTxHex: hex, feeSats: Number(FEE), genesisTxid: GENESIS_TXID, note: 'Broadcast AFTER the genesis tx confirms.' }, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
