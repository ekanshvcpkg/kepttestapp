import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";

import { levelFromXp } from "../src/aura/curve.js";
import { encodeCheckedInLog, parseCheckedInEvents } from "../src/aura/events.js";
import { MILESTONES, earnedMilestones } from "../src/aura/milestones.js";
import { signaturesFromWebhook, syncKeeper, syncSignature } from "../src/aura/process.js";
import { AuraMinter, AuraRecord, AuraStore, syncAuras } from "../src/aura/service.js";
import { config } from "../src/config.js";

// ---- fakes ----

class MemoryStore implements AuraStore {
  rows: AuraRecord[] = [];
  failMarkMinted = false;
  async list(w: string) { return this.rows.filter((r) => r.walletAddress === w); }
  async claim(w: string, m: { id: string }, level: number) {
    const row = this.rows.find((r) => r.walletAddress === w && r.milestoneId === m.id);
    if (!row) {
      const created: AuraRecord = { id: this.rows.length + 1, walletAddress: w, milestoneId: m.id, levelAtMint: level, status: "MINTING", assetId: null, mintSignature: null, error: null };
      this.rows.push(created);
      return { ...created };
    }
    if (row.status !== "FAILED") return null;
    row.status = "MINTING";
    row.error = null;
    return { ...row };
  }
  async markMinted(id: number, assetId: string | null, sig: string) {
    if (this.failMarkMinted) throw new Error("db down");
    Object.assign(this.rows.find((r) => r.id === id)!, { status: "MINTED", assetId, mintSignature: sig });
  }
  async markFailed(id: number, error: string) {
    Object.assign(this.rows.find((r) => r.id === id)!, { status: "FAILED", error });
  }
}

class FakeMinter implements AuraMinter {
  calls: string[] = [];
  failNext = 0;
  async mint(owner: string, m: { id: string }) {
    if (this.failNext > 0) { this.failNext--; throw new Error("rpc timeout"); }
    this.calls.push(`${owner}:${m.id}`);
    return { signature: `sig-${this.calls.length}`, assetId: `asset-${this.calls.length}` };
  }
}

const wallet = Keypair.generate().publicKey;
const xpForLevel = (n: number) => 25 * (n - 1) * (n + 2);

// ---- level + milestones ----

test("levelFromXp matches the curve table", () => {
  const table: [number, number][] = [[1, 0], [2, 100], [3, 250], [4, 450], [10, 2700], [20, 10450], [35, 31450], [55, 76950]];
  for (const [n, xp] of table) {
    assert.equal(levelFromXp(xp), n);
    if (xp > 0) assert.equal(levelFromXp(xp - 1), n - 1);
  }
});

test("milestones are earned at their level, lowest first", () => {
  assert.deepEqual(earnedMilestones(4).map((m) => m.id), []);
  assert.deepEqual(earnedMilestones(5).map((m) => m.id), ["ember"]);
  assert.deepEqual(earnedMilestones(20).map((m) => m.id), ["ember", "flame", "azure"]);
  assert.equal(earnedMilestones(99).length, MILESTONES.length);
});

// ---- mint-once ----

test("mints each earned milestone once, and a repeat mints nothing", async () => {
  const store = new MemoryStore();
  const minter = new FakeMinter();
  const first = await syncAuras({ store, minter }, wallet.toBase58(), 10);
  assert.deepEqual(first.map((o) => `${o.milestoneId}:${o.result}`), ["ember:minted", "flame:minted"]);
  const again = await syncAuras({ store, minter }, wallet.toBase58(), 10);
  assert.deepEqual(again, []);
  assert.equal(minter.calls.length, 2);
  assert.ok(store.rows.every((r) => r.status === "MINTED" && r.assetId));
});

test("concurrent syncs for the same wallet mint each milestone exactly once", async () => {
  const store = new MemoryStore();
  const minter = new FakeMinter();
  await Promise.all([1, 2, 3, 4, 5].map(() => syncAuras({ store, minter }, wallet.toBase58(), 20)));
  assert.equal(minter.calls.length, 3);
  assert.equal(new Set(minter.calls).size, 3);
});

test("a failed mint is FAILED, then retried on the next sync", async () => {
  const store = new MemoryStore();
  const minter = new FakeMinter();
  minter.failNext = 1;
  const first = await syncAuras({ store, minter }, wallet.toBase58(), 5);
  assert.equal(first[0].result, "failed");
  assert.equal(store.rows[0].status, "FAILED");
  assert.match(store.rows[0].error!, /rpc timeout/);
  const retry = await syncAuras({ store, minter }, wallet.toBase58(), 5);
  assert.equal(retry[0].result, "minted");
  assert.equal(store.rows[0].status, "MINTED");
  assert.equal(minter.calls.length, 1);
});

test("if recording a successful mint fails, the row is NOT retried (no double mint)", async () => {
  const store = new MemoryStore();
  const minter = new FakeMinter();
  store.failMarkMinted = true;
  const first = await syncAuras({ store, minter }, wallet.toBase58(), 5);
  assert.equal(first[0].result, "minted"); // it did mint
  store.failMarkMinted = false;
  const again = await syncAuras({ store, minter }, wallet.toBase58(), 5);
  assert.deepEqual(again, []); // stuck MINTING, never auto-retried
  assert.equal(minter.calls.length, 1);
});

// ---- events + webhook ----

const PID = config.keeperProgramId;
const keeperPdaBytes = Keypair.generate().publicKey.toBuffer();

test("parses CheckedIn only when emitted by our program", () => {
  const line = encodeCheckedInLog(keeperPdaBytes, 2750n);
  const good = [`Program ${PID} invoke [1]`, line, `Program ${PID} success`];
  const events = parseCheckedInEvents(good, PID);
  assert.equal(events.length, 1);
  assert.equal(events[0].xpTotalAfter, 2750n);
  assert.ok(events[0].keeperBytes.equals(keeperPdaBytes));

  const spoofed = ["Program EvilProgram1111111111111111111111111111111 invoke [1]", line, "Program EvilProgram1111111111111111111111111111111 success"];
  assert.equal(parseCheckedInEvents(spoofed, PID).length, 0);

  // Spoof from a program our program called (inner invoke): top of stack is not ours.
  const inner = [`Program ${PID} invoke [1]`, "Program Evil invoke [2]", line, "Program Evil success", `Program ${PID} success`];
  assert.equal(parseCheckedInEvents(inner, PID).length, 0);

  assert.equal(parseCheckedInEvents(["Program data: AAAA"], PID).length, 0);
});

test("webhook signatures: enhanced, raw, junk", () => {
  const sig = "5Ye8kbF2ah3T23rGLDenrR5bVimB3maPX5ahbpX93T7siSQqRTp7upYwYwNfM78WRpJciYVHMiaKS4Cght6fFpTP";
  assert.deepEqual(signaturesFromWebhook([{ signature: sig }]), [sig]);
  assert.deepEqual(signaturesFromWebhook([{ transaction: { signatures: [sig] } }, { signature: sig }]), [sig]);
  assert.deepEqual(signaturesFromWebhook([{ signature: "nope" }, null, 5]), []);
  assert.deepEqual(signaturesFromWebhook({}), []);
});

test("a webhook signature mints from the ON-CHAIN level, ignoring the event's xp", async () => {
  const store = new MemoryStore();
  const minter = new FakeMinter();
  const authority = Keypair.generate().publicKey;
  // The event claims a huge XP; the chain account says level 5. The chain wins.
  const logs = [`Program ${PID} invoke [1]`, encodeCheckedInLog(keeperPdaBytes, 99_999_999n), `Program ${PID} success`];
  const results = await syncSignature(
    {
      store, minter,
      getLogs: async () => logs,
      getKeeper: async (address: PublicKey) => ({ address, authority, xpTotal: BigInt(xpForLevel(5)) }),
    },
    "sig",
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].level, 5);
  assert.deepEqual(minter.calls, [`${authority.toBase58()}:ember`]);
});

test("a failed or unknown transaction mints nothing", async () => {
  const store = new MemoryStore();
  const minter = new FakeMinter();
  const out = await syncSignature({ store, minter, getLogs: async () => null }, "sig");
  assert.deepEqual(out, []);
  assert.equal(minter.calls.length, 0);
});

test("syncKeeper reports the level it derived", async () => {
  const store = new MemoryStore();
  const minter = new FakeMinter();
  const r = await syncKeeper({ store, minter }, { address: wallet, authority: wallet, xpTotal: BigInt(xpForLevel(35)) });
  assert.equal(r.level, 35);
  assert.equal(r.outcomes.length, 4);
});
