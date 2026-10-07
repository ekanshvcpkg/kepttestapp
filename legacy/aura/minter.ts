// Mints one compressed NFT (Metaplex Bubblegum) into a wallet from our Merkle tree.
// The minter wallet is the tree creator/delegate and pays the (tiny) fee. Devnet only.

import { mintV1, mplBubblegum, parseLeafFromMintV1Transaction } from "@metaplex-foundation/mpl-bubblegum";
import { keypairIdentity, none, publicKey } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

import { config } from "../config.js";
import { AURA_SELLER_FEE_BPS, AURA_SYMBOL, Milestone } from "./milestones.js";
import { AuraMinter } from "./service.js";

export function auraConfigured(): boolean {
  return Boolean(config.auraMerkleTree && config.auraMinterSecretKey && config.publicBaseUrl);
}

/** Accepts the key as `[1,2,3]` (the file's contents) or `1,2,3` (brackets lost when pasted). */
export function parseSecretKey(raw: string): Uint8Array {
  const text = raw.trim();
  const bytes = JSON.parse(text.startsWith("[") ? text : `[${text}]`) as unknown;
  if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    throw new Error("AURA_MINTER_SECRET_KEY must be 64 numbers (0-255), as in .aura-minter.json");
  }
  return Uint8Array.from(bytes);
}

export function metadataUri(milestoneId: string): string {
  return `${config.publicBaseUrl}/aura/metadata/${milestoneId}.json`;
}

export function createBubblegumMinter(): AuraMinter {
  const umi = createUmi(config.devnetRpcUrl).use(mplBubblegum());
  const keypair = umi.eddsa.createKeypairFromSecretKey(parseSecretKey(config.auraMinterSecretKey));
  umi.use(keypairIdentity(keypair));
  const merkleTree = publicKey(config.auraMerkleTree);

  return {
    async mint(owner, milestone: Milestone) {
      const { signature } = await mintV1(umi, {
        leafOwner: publicKey(owner),
        merkleTree,
        metadata: {
          name: milestone.name,
          symbol: AURA_SYMBOL,
          uri: metadataUri(milestone.id),
          sellerFeeBasisPoints: AURA_SELLER_FEE_BPS,
          collection: none(),
          creators: [{ address: umi.identity.publicKey, verified: false, share: 100 }],
        },
      }).sendAndConfirm(umi);

      // Reading the asset id back is best-effort: the mint already happened, so a failure
      // here must NOT fail the mint (that would trigger a duplicate on retry).
      let assetId: string | null = null;
      try {
        assetId = (await parseLeafFromMintV1Transaction(umi, signature)).id.toString();
      } catch {
        assetId = null;
      }
      return { signature: base58.deserialize(signature)[0], assetId };
    },
  };
}
