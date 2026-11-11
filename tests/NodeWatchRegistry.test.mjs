// Unit tests for contracts/NodeWatchRegistry.cash (CashScript 0.14.0).
// MockNetworkProvider validates transactions against the BCH VM, so a
// .send() that resolves means the covenant accepted the tx, and a
// rejection means the covenant (or consensus token rules) rejected it.
import { describe, it, expect } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import {
  Contract,
  MockNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  randomUtxo,
  randomNFT,
  utils,
} from 'cashscript';
import { binToHex, encodeCashAddress, hash160, publicKeyToP2pkhCashAddress, publicKeyToP2pkhLockingBytecode } from '@bitauth/libauth';
import artifact from '../contracts/NodeWatchRegistry.json' with { type: 'json' };

const CONTRACT_VALUE = 10_000n;
const NFT_VALUE = 1_000n;

function nodeIdFor(name, endpoint) {
  return createHash('sha256').update(`${name}|${endpoint}`).digest().subarray(0, 20);
}

// 40-byte commitment per docs/DESIGN.md:
// nodeId(20) | status(1) | height uint32 BE(4) | latency uint16 BE(2) | reserved(13 zero)
function commitmentHex({ status = 1, height = 800_000, latency = 120, nodeId } = {}) {
  const id = nodeId ?? nodeIdFor('test-node', 'wss://example.invalid:50004');
  const buf = Buffer.alloc(40);
  Buffer.from(id).copy(buf, 0);
  buf.writeUInt8(status, 20);
  buf.writeUInt32BE(height, 21);
  buf.writeUInt16BE(latency, 25);
  return buf.toString('hex');
}

function makeFunder() {
  const template = new SignatureTemplate(randomBytes(32));
  const lock = publicKeyToP2pkhLockingBytecode({ publicKey: template.publicKey });
  const address = publicKeyToP2pkhCashAddress({ publicKey: template.publicKey, prefix: 'bchtest' }).address;
  // Token outputs require a token-aware address (bchtest:z...).
  const tokenAddress = encodeCashAddress({
    payload: hash160(template.publicKey),
    prefix: 'bchtest',
    type: 'p2pkhWithTokens',
  }).address;
  return { template, lock, address, tokenAddress };
}

async function setup() {
  const provider = new MockNetworkProvider();
  const contract = new Contract(artifact, [], { provider, contractType: 'p2sh32' });
  const category = binToHex(randomBytes(32));
  const funder = makeFunder();

  const mintingToken = randomNFT({
    category,
    amount: 0n,
    nft: { capability: 'minting', commitment: '' },
  });
  const contractUtxo = provider.addUtxo(
    contract.tokenAddress,
    randomUtxo({
      satoshis: CONTRACT_VALUE,
      token: mintingToken,
      lockingBytecode: contract.lockingBytecode,
    }),
  );
  const funderUtxo = provider.addUtxo(
    funder.address,
    randomUtxo({
      satoshis: 100_000n,
      lockingBytecode: binToHex(funder.lock),
    }),
  );
  return { provider, contract, category, funder, contractUtxo, funderUtxo };
}

// Build a register tx. `mutate` receives the builder after the standard
// inputs are added, so each test can vary exactly one thing.
async function buildRegister(ctx, mutate) {
  const { provider, contract, category, funder, contractUtxo, funderUtxo } = ctx;
  const nodeId = nodeIdFor('test-node', 'wss://example.invalid:50004');
  const builder = new TransactionBuilder({ provider })
    .addInput(contractUtxo, contract.unlock.register())
    .addInput(funderUtxo, funder.template.unlockP2PKH());
  await mutate(builder, { nodeId });
  return builder;
}

function standardOutputs(ctx, { commitment, opReturn = true } = {}) {
  const { contract, category, funder } = ctx;
  return (builder, { nodeId }) => {
    builder
      .addOutput({
        to: contract.tokenAddress,
        amount: CONTRACT_VALUE,
        token: { category, amount: 0n, nft: { capability: 'minting', commitment: '' } },
      })
      .addOutput({
        to: funder.tokenAddress,
        amount: NFT_VALUE,
        token: {
          category,
          amount: 0n,
          nft: { capability: 'mutable', commitment: commitment ?? commitmentHex({ nodeId }) },
        },
      });
    if (opReturn) {
      builder.addOpReturnOutput([
        'NWATCH',
        '0x01',
        '0x52', // 'R' = register
        `0x${binToHex(nodeId)}`,
        'test-node|wss://example.invalid:50004',
      ]);
    }
    builder.addBchChangeOutputIfNeeded({ to: funder.address, feeRate: 1 });
  };
}

describe('NodeWatchRegistry.register', () => {
  it('valid register succeeds', async () => {
    const ctx = await setup();
    const tx = await buildRegister(ctx, standardOutputs(ctx));
    const details = await tx.send();
    expect(details.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('valid register succeeds with status 2 (degraded)', async () => {
    const ctx = await setup();
    const tx = await buildRegister(
      ctx,
      standardOutputs(ctx, { commitment: commitmentHex({ status: 2 }) }),
    );
    const details = await tx.send();
    expect(details.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails when the minting NFT is not recreated to the contract', async () => {
    const ctx = await setup();
    const { contract, category, funder } = ctx;
    const tx = await buildRegister(ctx, (builder, { nodeId }) => {
      // Output 0 sends the minting NFT to the funder instead of the contract.
      builder
        .addOutput({
          to: funder.tokenAddress,
          amount: CONTRACT_VALUE,
          token: { category, amount: 0n, nft: { capability: 'minting', commitment: '' } },
        })
        .addOutput({
          to: funder.tokenAddress,
          amount: NFT_VALUE,
          token: {
            category,
            amount: 0n,
            nft: { capability: 'mutable', commitment: commitmentHex({ nodeId }) },
          },
        })
        .addOpReturnOutput(['NWATCH', '0x01', '0x52', `0x${binToHex(nodeId)}`, 'test-node'])
        .addBchChangeOutputIfNeeded({ to: funder.address, feeRate: 1 });
    });
    await expect(tx.send()).rejects.toThrow();
  });

  it('fails when the minting NFT is burned (not recreated at all)', async () => {
    const ctx = await setup();
    const tx = await buildRegister(ctx, (builder, { nodeId }) => {
      // No output carries the minting NFT: output 0 is plain BCH.
      builder
        .addOutput({ to: ctx.funder.address, amount: CONTRACT_VALUE })
        .addOutput({
          to: ctx.funder.tokenAddress,
          amount: NFT_VALUE,
          token: {
            category: ctx.category,
            amount: 0n,
            nft: { capability: 'mutable', commitment: commitmentHex({ nodeId }) },
          },
        })
        .addOpReturnOutput(['NWATCH', '0x01', '0x52', `0x${binToHex(nodeId)}`, 'test-node'])
        .addBchChangeOutputIfNeeded({ to: ctx.funder.address, feeRate: 1 });
    });
    await expect(tx.send()).rejects.toThrow();
  });

  it('fails when the commitment is not 40 bytes', async () => {
    const ctx = await setup();
    // 39 bytes: one reserved byte short.
    const shortCommitment = commitmentHex().slice(0, 78);
    const tx = await buildRegister(ctx, standardOutputs(ctx, { commitment: shortCommitment }));
    await expect(tx.send()).rejects.toThrow();
  });

  it('fails when the commitment status byte is not 1 or 2', async () => {
    const ctx = await setup();
    const tx = await buildRegister(
      ctx,
      standardOutputs(ctx, { commitment: commitmentHex({ status: 3 }) }),
    );
    await expect(tx.send()).rejects.toThrow();
  });

  it('fails when the NWATCH OP_RETURN output is missing', async () => {
    const ctx = await setup();
    const tx = await buildRegister(ctx, standardOutputs(ctx, { opReturn: false }));
    await expect(tx.send()).rejects.toThrow();
  });

  it('fails when the OP_RETURN prefix is not NWATCH', async () => {
    const ctx = await setup();
    const tx = await buildRegister(ctx, (builder, { nodeId }) => {
      builder
        .addOutput({
          to: ctx.contract.tokenAddress,
          amount: CONTRACT_VALUE,
          token: {
            category: ctx.category,
            amount: 0n,
            nft: { capability: 'minting', commitment: '' },
          },
        })
        .addOutput({
          to: ctx.funder.tokenAddress,
          amount: NFT_VALUE,
          token: {
            category: ctx.category,
            amount: 0n,
            nft: { capability: 'mutable', commitment: commitmentHex({ nodeId }) },
          },
        })
        .addOpReturnOutput(['OTHER!', '0x01', '0x52', `0x${binToHex(nodeId)}`, 'test-node'])
        .addBchChangeOutputIfNeeded({ to: ctx.funder.address, feeRate: 1 });
    });
    await expect(tx.send()).rejects.toThrow();
  });

  it('fails when a second mutable NFT is minted in the change output', async () => {
    const ctx = await setup();
    const tx = await buildRegister(ctx, (builder, { nodeId }) => {
      builder
        .addOutput({
          to: ctx.contract.tokenAddress,
          amount: CONTRACT_VALUE,
          token: {
            category: ctx.category,
            amount: 0n,
            nft: { capability: 'minting', commitment: '' },
          },
        })
        .addOutput({
          to: ctx.funder.tokenAddress,
          amount: NFT_VALUE,
          token: {
            category: ctx.category,
            amount: 0n,
            nft: { capability: 'mutable', commitment: commitmentHex({ nodeId }) },
          },
        })
        .addOpReturnOutput(['NWATCH', '0x01', '0x52', `0x${binToHex(nodeId)}`, 'test-node'])
        .addOutput({
          to: ctx.funder.tokenAddress,
          amount: NFT_VALUE,
          token: {
            category: ctx.category,
            amount: 0n,
            nft: { capability: 'mutable', commitment: commitmentHex({ nodeId }) },
          },
        });
    });
    await expect(tx.send()).rejects.toThrow();
  });
});
