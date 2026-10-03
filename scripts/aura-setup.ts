// One-time Aura setup (Devnet): creates the minter wallet file and the Merkle tree.
//   npm run aura:setup
// Run it once. It never prints a secret key; it prints public addresses and next steps.

import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createTree, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { generateSigner, keypairIdentity } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

import { config } from "../src/config.js";

const KEY_FILE = ".aura-minter.json";
// 2^14 = 16,384 mints. Enough for a test; rent is roughly 0.3 SOL on Devnet.
const MAX_DEPTH = 14;
const MAX_BUFFER_SIZE = 64;
const MIN_LAMPORTS = 500_000_000n; // 0.5 SOL

const umi = createUmi(config.devnetRpcUrl).use(mplBubblegum());

let keypair;
if (existsSync(KEY_FILE)) {
  keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY_FILE, "utf8"))));
  console.log(`Using existing minter wallet from ${KEY_FILE}`);
} else {
  keypair = umi.eddsa.generateKeypair();
  writeFileSync(KEY_FILE, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  console.log(`Created minter wallet, saved to ${KEY_FILE} (gitignored, keep it private)`);
}
umi.use(keypairIdentity(keypair));
console.log(`Minter wallet (public): ${keypair.publicKey}`);

const balance = (await umi.rpc.getBalance(keypair.publicKey)).basisPoints;
if (balance < MIN_LAMPORTS) {
  console.log(`\nBalance is ${Number(balance) / 1e9} SOL. Send at least 0.5 Devnet SOL to ${keypair.publicKey}, then run this again:`);
  console.log(`  solana transfer ${keypair.publicKey} 1 --url devnet --allow-unfunded-recipient`);
  process.exit(0);
}

const merkleTree = generateSigner(umi);
await (await createTree(umi, { merkleTree, maxDepth: MAX_DEPTH, maxBufferSize: MAX_BUFFER_SIZE })).sendAndConfirm(umi);
console.log(`\nMerkle tree created: ${merkleTree.publicKey}`);
console.log(`\nSet these on Render (Environment tab) and in .env:`);
console.log(`  AURA_MERKLE_TREE=${merkleTree.publicKey}`);
console.log(`  AURA_MINTER_SECRET_KEY=<the JSON array inside ${KEY_FILE}>`);
console.log(`  WEBHOOK_SECRET=<any long random string you choose>`);
