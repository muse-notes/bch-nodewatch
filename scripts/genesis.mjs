// genesis.mjs — create the NodeWatch registry CashToken category on chipnet.
// Mints exactly ONE minting-capability NFT (the registry's minting authority)
// with an empty commitment, held by the operator wallet until
// deploy-contract.mjs locks it in the covenant contract.
//
//   CHIPNET_WIF=<wif> npm run genesis
//
// Writes ONLY public results (category ID, genesis txid) to
// frontend/config.json. Refuses to run on mainnet.
import { TestNetWifWallet, TokenGenesisRequest } from 'mainnet-js';
import {
  assertChipnet,
  requireChipnetWif,
  saveConfig,
  CHIPNET_EXPLORER_TX,
} from './lib.mjs';

assertChipnet();
const wif = requireChipnetWif();

const wallet = await TestNetWifWallet.fromWIF(wif);
const address = wallet.getDepositAddress();
const balance = await wallet.getBalance();
console.log(`Wallet: ${address}`);
console.log(`Balance: ${balance} sats`);
if (balance < 5000n) {
  console.error('Balance too low for genesis (need >= 5000 sats: 1000-sat NFT output + fee).');
  console.error('Fund the wallet at https://tbch.googol.cash (select the chipnet network) and retry.');
  process.exit(1);
}

// One minting NFT, no fungible supply, empty commitment, 1000-sat output.
const response = await wallet.tokenGenesis(
  new TokenGenesisRequest({
    nft: { capability: 'minting', commitment: '' },
    value: 1000n,
  }),
);

const categoryId = response.categories?.[0];
const txid = response.txId;
if (!categoryId || !txid) {
  console.error('Genesis response missing category/txid:', JSON.stringify(response));
  process.exit(1);
}

console.log(`Genesis txid: ${txid}`);
console.log(`Category ID:  ${categoryId}`);
console.log(`Explorer:     ${CHIPNET_EXPLORER_TX(txid)}`);

const config = saveConfig({
  network: 'chipnet',
  categoryId,
  genesisTxid: txid,
  genesisExplorer: CHIPNET_EXPLORER_TX(txid),
});
console.log(`Wrote public results to frontend/config.json: ${JSON.stringify(config)}`);
