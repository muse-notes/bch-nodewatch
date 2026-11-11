// register-node.mjs — scripted end-to-end register on chipnet: spends the
// contract's minting NFT via the covenant, mints one mutable NFT (one node)
// with a 40-byte commitment, and attaches the NWATCH OP_RETURN attestation.
//
//   CHIPNET_WIF=<wif> npm run register -- [name] [endpoint]
//   CHIPNET_WIF=<wif> node scripts/register-node.mjs demo-node wss://chipnet.imaginary.cash:50004
//
// The caller pays the fee and the new NFT's 1000-sat dust from their own
// P2PKH inputs; the contract UTXO value is preserved by the covenant.
// Prints the register txid. Refuses to run on mainnet.
import { readFileSync } from 'node:fs';
import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
} from 'cashscript';
import {
  binToHex,
  encodeCashAddress,
  hash160,
  publicKeyToP2pkhCashAddress,
} from '@bitauth/libauth';
import {
  assertChipnet,
  requireChipnetWif,
  loadConfig,
  saveConfig,
  electrumOptions,
  CONTRACT_ARTIFACT,
  commitmentHex,
  nodeIdHex,
  CHIPNET_EXPLORER_TX,
} from './lib.mjs';

assertChipnet();
const wif = requireChipnetWif();
const config = loadConfig();
if (!config.categoryId || !config.contractAddress) {
  console.error('frontend/config.json needs categoryId + contractAddress — run genesis + deploy first.');
  process.exit(1);
}

const name = process.argv[2] ?? 'chipnet-demo-node';
const endpoint = process.argv[3] ?? 'wss://chipnet.imaginary.cash:50004';
const NFT_VALUE = 1000n;

const provider = new ElectrumNetworkProvider('chipnet', electrumOptions());
const artifact = JSON.parse(readFileSync(CONTRACT_ARTIFACT, 'utf8'));
const contract = new Contract(artifact, [], { provider, contractType: 'p2sh32' });
if (contract.address !== config.contractAddress) {
  console.error(`Contract address mismatch: compiled ${contract.address} != config ${config.contractAddress}`);
  process.exit(1);
}

// Registrant key + addresses (bchtest prefix: chipnet).
const template = new SignatureTemplate(wif);
const funderAddress = publicKeyToP2pkhCashAddress({ publicKey: template.publicKey, prefix: 'bchtest' }).address;
const funderTokenAddress = encodeCashAddress({
  payload: hash160(template.publicKey),
  prefix: 'bchtest',
  type: 'p2pkhWithTokens',
}).address;
console.log(`Registrant: ${funderAddress}`);

// Contract UTXO holding the minting NFT.
const contractUtxos = await provider.getUtxos(contract.tokenAddress);
const contractUtxo = contractUtxos.find(
  (u) => u.token?.category === config.categoryId && u.token?.nft?.capability === 'minting',
);
if (!contractUtxo) {
  console.error(`No minting-NFT UTXO of category ${config.categoryId} at ${contract.tokenAddress}`);
  process.exit(1);
}
console.log(`Contract UTXO: ${contractUtxo.txid}:${contractUtxo.vout} (${contractUtxo.satoshis} sats)`);

// Funder UTXOs (plain BCH for the NFT dust + fee).
const funderUtxos = (await provider.getUtxos(funderAddress)).filter((u) => !u.token);
if (funderUtxos.length === 0) {
  console.error(`No spendable BCH UTXOs at ${funderAddress} — fund the wallet first.`);
  process.exit(1);
}

const height = await provider.getBlockHeight();
const commitment = commitmentHex({ name, endpoint, status: 1, height, latency: 0 });
console.log(`Registering node "${name}" (${endpoint}) at height ${height}`);
console.log(`nodeId: ${nodeIdHex(name, endpoint)}`);

const builder = new TransactionBuilder({ provider })
  .addInput(contractUtxo, contract.unlock.register())
  .addOutput({
    to: contract.tokenAddress,
    amount: contractUtxo.satoshis,
    token: {
      category: config.categoryId,
      amount: 0n,
      nft: { capability: 'minting', commitment: contractUtxo.token.nft.commitment },
    },
  })
  .addOutput({
    to: funderTokenAddress,
    amount: NFT_VALUE,
    token: {
      category: config.categoryId,
      amount: 0n,
      nft: { capability: 'mutable', commitment },
    },
  })
  .addOpReturnOutput([
    'NWATCH',
    '0x01',
    '0x52', // 'R' = register
    `0x${nodeIdHex(name, endpoint)}`,
    `${name}|${endpoint}`,
  ]);

// Add funder inputs until they cover NFT dust + fee, then change.
let funderTotal = 0n;
for (const utxo of funderUtxos) {
  builder.addInput(utxo, template.unlockP2PKH());
  funderTotal += utxo.satoshis;
  if (funderTotal >= NFT_VALUE + 2000n) break;
}
if (funderTotal < NFT_VALUE + 1000n) {
  console.error(`Funder balance too low: ${funderTotal} sats in UTXOs (need >= ${NFT_VALUE + 1000n}).`);
  process.exit(1);
}
builder.addBchChangeOutputIfNeeded({ to: funderAddress, feeRate: 1 });

const details = await builder.send();
console.log(`Register txid: ${details.txid}`);
console.log(`Explorer:      ${CHIPNET_EXPLORER_TX(details.txid)}`);
saveConfig({ lastRegisterTxid: details.txid });
