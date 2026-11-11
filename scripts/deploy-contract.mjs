// deploy-contract.mjs — compile contracts/NodeWatchRegistry.cash and lock the
// registry minting NFT in the covenant contract on chipnet.
//
//   CHIPNET_WIF=<wif> npm run deploy
//
// Steps: (1) compile the .cash with cashc, (2) derive the contract address,
// (3) send the minting NFT (from genesis.mjs) to the contract's token address
// with 10,000 sats — that output IS the funded contract UTXO the covenant
// spends from. Records the contract address + category ID in
// frontend/config.json. Refuses to run on mainnet.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Contract, ElectrumNetworkProvider } from 'cashscript';
import { TestNetWifWallet, TokenSendRequest } from 'mainnet-js';
import {
  assertChipnet,
  requireChipnetWif,
  loadConfig,
  saveConfig,
  electrumOptions,
  CONTRACT_SRC,
  CONTRACT_ARTIFACT,
  CHIPNET_EXPLORER_TX,
} from './lib.mjs';

assertChipnet();
const wif = requireChipnetWif();
const config = loadConfig();
if (!config.categoryId) {
  console.error('No categoryId in frontend/config.json — run `npm run genesis` first.');
  process.exit(1);
}

const CONTRACT_FUNDING_SATS = 10_000n;

// 1. Compile the contract.
execFileSync('./node_modules/.bin/cashc', [CONTRACT_SRC, '--output', CONTRACT_ARTIFACT], {
  stdio: 'inherit',
});
const artifact = JSON.parse(readFileSync(CONTRACT_ARTIFACT, 'utf8'));

// 2. Derive the contract address (p2sh32, chipnet provider).
const provider = new ElectrumNetworkProvider('chipnet', electrumOptions());
const contract = new Contract(artifact, [], { provider, contractType: 'p2sh32' });
console.log(`Contract address: ${contract.address}`);
console.log(`Contract token address: ${contract.tokenAddress}`);

// 3. Send the minting NFT + funding into the contract.
const wallet = await TestNetWifWallet.fromWIF(wif);
const balance = await wallet.getBalance();
console.log(`Operator wallet: ${wallet.getDepositAddress()} (${balance} sats)`);
if (balance < CONTRACT_FUNDING_SATS + 2000n) {
  console.error(`Balance too low: need >= ${CONTRACT_FUNDING_SATS + 2000n} sats to fund the contract.`);
  console.error('Fund the wallet at https://tbch.googol.cash (select the chipnet network) and retry.');
  process.exit(1);
}

const response = await wallet.send(
  new TokenSendRequest({
    cashaddr: contract.tokenAddress,
    value: CONTRACT_FUNDING_SATS,
    amount: 0n,
    category: config.categoryId,
    nft: { capability: 'minting', commitment: '' },
  }),
);
const txid = response.txId;
if (!txid) {
  console.error('Deploy send response missing txid:', JSON.stringify(response));
  process.exit(1);
}

console.log(`Funding txid: ${txid}`);
console.log(`Explorer:      ${CHIPNET_EXPLORER_TX(txid)}`);

saveConfig({
  network: 'chipnet',
  categoryId: config.categoryId,
  contractAddress: contract.address,
  contractTokenAddress: contract.tokenAddress,
  contractFundingSats: Number(CONTRACT_FUNDING_SATS),
  deployTxid: txid,
  deployExplorer: CHIPNET_EXPLORER_TX(txid),
});
console.log('Wrote contract address + category to frontend/config.json');
