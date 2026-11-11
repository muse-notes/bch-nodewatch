// Shared helpers for the BCH NodeWatch chipnet scripts.
// Keys come from environment variables ONLY. Nothing here ever writes a
// private key, mnemonic or WIF to disk. All scripts are chipnet-only:
// mainnet-js 3.1.7 wires its "testnet" wallet class to chipnet Electrum
// servers (see node_modules/mainnet-js/dist/module/network/constant.js),
// and every script below refuses to run if a mainnet network is requested.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = join(ROOT, 'frontend', 'config.json');
export const CONTRACT_SRC = join(ROOT, 'contracts', 'NodeWatchRegistry.cash');
export const CONTRACT_ARTIFACT = join(ROOT, 'contracts', 'NodeWatchRegistry.json');

export const CHIPNET_EXPLORER_TX = (txid) =>
  `https://chipnet.chaingraph.cash/tx/${txid}`;
export const BLOCKEXPLORER_TX = (txid) =>
  `https://blockexplorer.cash/tx/${txid}`;

// --- network guard -------------------------------------------------------
export function assertChipnet() {
  const net = (process.env.BCH_NETWORK ?? 'chipnet').toLowerCase();
  if (net !== 'chipnet' && net !== 'testnet') {
    console.error(`REFUSING: BCH_NETWORK=${net} is not chipnet. Mainnet is never used by these scripts.`);
    process.exit(1);
  }
}

export function requireChipnetWif() {
  const wif = process.env.CHIPNET_WIF;
  if (!wif) {
    console.error('Missing CHIPNET_WIF env var. Generate one with: npm run make-wallet');
    console.error('(Fund it first at https://tbch.googol.cash — select the chipnet network.)');
    process.exit(1);
  }
  return wif;
}

// --- Electrum override ---------------------------------------------------
// CashScript's chipnet default is chipnet.bch.ninja. If that host is
// unreachable from the operator's network, set CHIPNET_ELECTRUM to another
// chipnet Electrum hostname, e.g. chipnet.imaginary.cash.
export function electrumOptions() {
  const hostname = process.env.CHIPNET_ELECTRUM;
  return hostname ? { hostname } : undefined;
}

// --- frontend/config.json (public data only) ------------------------------
export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

export function saveConfig(patch) {
  const config = { ...loadConfig(), ...patch };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

// --- NFT commitment (docs/DESIGN.md layout, 40 bytes) ---------------------
// nodeId(20) | status(1) | lastSeenHeight uint32 BE(4) | latencyMs uint16 BE(2) | reserved(13 zero)
export function nodeIdFor(name, endpoint) {
  return createHash('sha256').update(`${name}|${endpoint}`).digest().subarray(0, 20);
}

export function commitmentHex({ name, endpoint, status = 1, height = 0, latency = 0 }) {
  const id = nodeIdFor(name, endpoint);
  const buf = Buffer.alloc(40);
  Buffer.from(id).copy(buf, 0);
  buf.writeUInt8(status, 20);
  buf.writeUInt32BE(height, 21);
  buf.writeUInt16BE(latency, 25);
  return buf.toString('hex');
}

export function nodeIdHex(name, endpoint) {
  return Buffer.from(nodeIdFor(name, endpoint)).toString('hex');
}
