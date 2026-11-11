// make-wallet.mjs — generate a fresh CHIPNET wallet and print its address
// and WIF to stdout ONCE. Testnet/chipnet only. Writes NOTHING to disk:
// the operator must copy the WIF into the CHIPNET_WIF env var themselves.
// Never run this for mainnet, and never paste the output anywhere public.
import { TestNetWifWallet } from 'mainnet-js';
import { assertChipnet } from './lib.mjs';

assertChipnet();

const wallet = await TestNetWifWallet.newRandom();
console.log('Network: chipnet (testnet)');
console.log(`Address: ${wallet.getDepositAddress()}`);
console.log(`WIF: ${wallet.privateKeyWif}`);
console.log('');
console.log('Fund it at https://tbch.googol.cash (select the chipnet network), then:');
console.log('  export CHIPNET_WIF=<WIF above>');
console.log('  npm run genesis');
