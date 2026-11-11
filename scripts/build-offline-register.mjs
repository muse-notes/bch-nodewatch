// build-offline-register.mjs — build the SIGNED first-node register tx offline.
//
// Spends the (not yet broadcast) deploy outputs:
//   - deploy txid:0 — 10,000 sats + minting NFT, locked in the covenant
//   - deploy txid:1 — 1,003,700 sats plain BCH (funder change)
// and mints one mutable NFT (one node) with a 40-byte commitment plus the
// NWATCH OP_RETURN attestation, via the covenant's register() function.
// Must be broadcast AFTER the deploy tx confirms.
//
//   CHIPNET_WIF=<wif> node scripts/build-offline-register.mjs [name] [endpoint]
//
// Writes scripts/out/register-tx.json (public data: signed hex + txid).
// The commitment height is the chipnet tip at build time (331135, Selene
// 2026-11-07 ~05:00 +07); it is informational on-chain, a few blocks of
// staleness by broadcast time is fine.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, ElectrumNetworkProvider, MockNetworkProvider, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { binToHex, encodeCashAddress, hash160, hexToBin, publicKeyToP2pkhCashAddress } from '@bitauth/libauth';
import { assertChipnet, requireChipnetWif, CONTRACT_ARTIFACT, commitmentHex, nodeIdHex } from './lib.mjs';

assertChipnet();
const wif = requireChipnetWif();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const deploy = JSON.parse(readFileSync(join(ROOT, 'scripts', 'out', 'deploy-tx.json'), 'utf8'));
const CATEGORY_ID = deploy.categoryId;
const DEPLOY_TXID = deploy.deployTxid;
const CONTRACT_ADDRESS = deploy.contractAddress;

const name = process.argv[2] ?? 'chipnet-demo-node';
const endpoint = process.argv[3] ?? 'wss://chipnet.imaginary.cash:50004';
const NFT_VALUE = 1000n;
const HEIGHT = 331135; // chipnet tip at build time (Selene)
const FEE = 900n; // ~2 sat/byte on a ~450-byte tx

const template = new SignatureTemplate(wif);
const pkh = hash160(template.publicKey);
const p2pkhLock = new Uint8Array([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
const funderAddress = publicKeyToP2pkhCashAddress({ publicKey: template.publicKey, prefix: 'bchtest' }).address;
const funderTokenAddress = encodeCashAddress({ payload: hash160(template.publicKey), prefix: 'bchtest', type: 'p2pkhWithTokens' }).address;

const artifact = JSON.parse(readFileSync(CONTRACT_ARTIFACT, 'utf8'));
const electrumProvider = new ElectrumNetworkProvider('chipnet');
const contract = new Contract(artifact, [], { provider: electrumProvider, contractType: 'p2sh32' });
if (contract.address !== CONTRACT_ADDRESS) {
  console.error(`Contract address mismatch: compiled ${contract.address} != deploy ${CONTRACT_ADDRESS}`);
  process.exit(1);
}
const contractLock = hexToBin(contract.lockingBytecode);

const contractUtxo = {
  txid: DEPLOY_TXID,
  vout: 0,
  satoshis: 10_000n,
  lockingBytecode: binToHex(contractLock),
  token: { category: CATEGORY_ID, amount: 0n, nft: { capability: 'minting', commitment: '' } },
};
const funderUtxo = {
  txid: DEPLOY_TXID,
  vout: 1,
  satoshis: 1_003_700n,
  lockingBytecode: binToHex(p2pkhLock),
};

const provider = new MockNetworkProvider({ updateUtxoSet: true, validateTransactions: true });
provider.setBlockHeight(HEIGHT);
provider.addUtxo(binToHex(contractLock), contractUtxo);
provider.addUtxo(binToHex(p2pkhLock), funderUtxo);

const commitment = commitmentHex({ name, endpoint, status: 1, height: HEIGHT, latency: 0 });
console.log(`Registering node "${name}" (${endpoint}) at height ${HEIGHT}`);
console.log(`nodeId: ${nodeIdHex(name, endpoint)}`);

const builder = new TransactionBuilder({ provider })
  .addInput(contractUtxo, contract.unlock.register())
  .addOutput({
    to: contractLock,
    amount: contractUtxo.satoshis,
    token: { category: CATEGORY_ID, amount: 0n, nft: { capability: 'minting', commitment: '' } },
  })
  .addOutput({
    to: p2pkhLock,
    amount: NFT_VALUE,
    token: { category: CATEGORY_ID, amount: 0n, nft: { capability: 'mutable', commitment } },
  })
  .addOpReturnOutput(['NWATCH', '0x01', '0x52', `0x${nodeIdHex(name, endpoint)}`, `${name}|${endpoint}`])
  .addInput(funderUtxo, template.unlockP2PKH())
  .addOutput({
    to: p2pkhLock,
    amount: funderUtxo.satoshis - NFT_VALUE - FEE,
  });

const hex = builder.build();
const fee = builder.calculateTransactionFee();
console.log(`Register raw tx (${hex.length / 2} bytes), fee: ${fee.feeSats} sats (${fee.feeSatsPerByte} sat/byte)`);

// Covenant check: evaluate register() against the VM locally.
try {
  const debug = await builder.debug();
  console.log('Covenant debug: SUCCESS — register() evaluates cleanly');
} catch (e) {
  console.log(`Covenant debug: FAILED — ${e.message?.slice(0, 300)}`);
}

const txid = await provider.sendRawTransaction(hex);
console.log(`Register txid: ${txid}`);
console.log(`Explorer:      https://explorer.selene.cash/tx/${txid}?network=chipnet`);

const { decodeTransactionUnsafe } = await import('@bitauth/libauth');
const decoded = decodeTransactionUnsafe(hexToBin(hex));
console.log(`Outputs: [0] ${decoded.outputs[0].valueSatoshis} sats + minting NFT -> contract, [1] ${decoded.outputs[1].valueSatoshis} sats + mutable NFT -> funder, [2] OP_RETURN, [3] ${decoded.outputs[3].valueSatoshis} sats change`);

const outDir = join(ROOT, 'scripts', 'out');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'register-tx.json');
writeFileSync(outPath, `${JSON.stringify({ network: 'chipnet', categoryId: CATEGORY_ID, contractAddress: CONTRACT_ADDRESS, nodeName: name, nodeEndpoint: endpoint, nodeId: nodeIdHex(name, endpoint), commitmentHeight: HEIGHT, registerTxid: txid, registerTxHex: hex, feeSats: Number(FEE), deployTxid: DEPLOY_TXID, note: 'Broadcast AFTER the deploy tx confirms.' }, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
