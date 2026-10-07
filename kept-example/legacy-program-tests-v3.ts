// Tests for the kept_test program, run against LiteSVM (an in-process Solana VM) so the
// clock can be set directly and day boundaries crossed without waiting.
//
// Run: anchor build && npm test

import { expect } from "chai";
import { randomBytes } from "crypto";
import path from "path";
import { BN, BorshCoder, Idl } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { Clock, FailedTransactionMetadata, LiteSVM } from "litesvm";
import {
  AccountRole,
  Address,
  KeyPairSigner,
  address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
} from "@solana/kit";

import idlJson from "../target/idl/kept_test.json";

const idl = idlJson as Idl;
const coder = new BorshCoder(idl);
const PROGRAM_ID = new PublicKey(idl.address);
const PROGRAM_SO = path.join(__dirname, "..", "target", "deploy", "kept_test.so");

// Mirrors constants.rs (asserted against chain behaviour below, not trusted blindly).
const SECONDS_PER_DAY = 86_400n;
const IST = 330; // UTC+5:30 in minutes
const I64_MIN = -(2n ** 63n);

type TierName = "Easy" | "Normal" | "Hard" | "Epic";

type Keeper = {
  authority: PublicKey;
  xp_total: bigint;
  quests_kept_total: number;
  streak_current: number;
  streak_best: number;
  last_checkin_day: bigint;
  today_mask: number;
  xp_today: number;
  xp_today_day: bigint;
  soul_earned: bigint;
  soul_bought: bigint;
  tz_offset_minutes: number;
};

class Harness {
  svm = new LiteSVM();
  user!: KeyPairSigner;
  keeper!: Address;

  static async create(tz = IST): Promise<Harness> {
    const h = new Harness();
    h.svm.addProgramFromFile(address(PROGRAM_ID.toBase58()), PROGRAM_SO);
    h.user = await generateKeyPairSigner();
    h.svm.airdrop(h.user.address, lamports(10_000_000_000n));
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("keeper"), new PublicKey(h.user.address).toBuffer()],
      PROGRAM_ID,
    );
    h.keeper = address(pda.toBase58());
    h.setTime(1_000n * SECONDS_PER_DAY); // a fixed, positive starting point
    await h.ok("init_keeper", { tz_offset_minutes: tz }, true);
    return h;
  }

  setTime(unix: bigint) {
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, unix));
  }

  /** Puts the clock at noon of local day `day` for this Keeper's offset. */
  setLocalDay(day: bigint, tzMinutes = IST) {
    this.setTime(day * SECONDS_PER_DAY + SECONDS_PER_DAY / 2n - BigInt(tzMinutes) * 60n);
  }

  private async send(name: string, args: object, withSystem = false) {
    const accounts = [
      { address: this.keeper, role: AccountRole.WRITABLE },
      { address: this.user.address, role: withSystem ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER },
    ];
    if (withSystem) {
      accounts.push({ address: address("11111111111111111111111111111111"), role: AccountRole.READONLY });
    }
    this.svm.expireBlockhash(); // every tx gets a fresh blockhash
    const tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.user, m),
      (m) => this.svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
      (m) =>
        appendTransactionMessageInstruction(
          {
            programAddress: address(PROGRAM_ID.toBase58()),
            accounts,
            data: new Uint8Array(coder.instruction.encode(name, args)),
          },
          m,
        ),
      (m) => signTransactionMessageWithSigners(m),
    );
    return this.svm.sendTransaction(tx);
  }

  async ok(name: string, args: object, withSystem = false) {
    const r = await this.send(name, args, withSystem);
    if (r instanceof FailedTransactionMetadata) {
      throw new Error(`${name} failed: ${r.toString()}\n${r.meta().logs().join("\n")}`);
    }
  }

  async fails(name: string, args: object, errorName: string) {
    const r = await this.send(name, args);
    expect(r).to.be.instanceOf(FailedTransactionMetadata);
    const logs = (r as FailedTransactionMetadata).meta().logs().join("\n");
    expect(logs).to.contain(`Error Code: ${errorName}`);
  }

  checkIn(slot: number, tier: TierName = "Normal", proven = true) {
    return this.ok("check_in", {
      quest_slot: slot,
      tier: { [tier]: {} },
      proven,
      proof_hash: [...randomBytes(32)],
    });
  }

  read(): Keeper {
    const acc = this.svm.getAccount(this.keeper);
    if (!acc.exists) throw new Error("Keeper account missing");
    expect(acc.data.length).to.equal(126);
    const k = coder.accounts.decode("Keeper", Buffer.from(acc.data));
    const big = (v: { toString(): string }) => BigInt(v.toString());
    return {
      ...k,
      xp_total: big(k.xp_total),
      last_checkin_day: big(k.last_checkin_day),
      xp_today_day: big(k.xp_today_day),
      soul_earned: big(k.soul_earned),
      soul_bought: big(k.soul_bought),
    };
  }
}

const DAY = 20_000n; // an arbitrary local day index

describe("kept_test", () => {
  it("init_keeper: zeroes everything except tz, bump and the 'never' days; cannot run twice", async () => {
    const h = await Harness.create();
    const k = h.read();
    expect(k.authority.toBase58()).to.equal(h.user.address);
    expect(k.xp_total).to.equal(0n);
    expect(k.streak_current).to.equal(0);
    expect(k.last_checkin_day).to.equal(I64_MIN);
    expect(k.tz_offset_minutes).to.equal(IST);
    const again = await (h as any).send("init_keeper", { tz_offset_minutes: IST }, true);
    expect(again).to.be.instanceOf(FailedTransactionMetadata);
  });

  it("1. first check-in ever sets streak to 1", async () => {
    const h = await Harness.create();
    h.setLocalDay(DAY);
    await h.checkIn(0);
    const k = h.read();
    expect(k.streak_current).to.equal(1);
    expect(k.streak_best).to.equal(1);
    expect(k.last_checkin_day).to.equal(DAY);
  });

  it("2. check-ins on consecutive days -> streak 2", async () => {
    const h = await Harness.create();
    h.setLocalDay(DAY);
    await h.checkIn(0);
    h.setLocalDay(DAY + 1n);
    await h.checkIn(0);
    expect(h.read().streak_current).to.equal(2);
    expect(h.read().streak_best).to.equal(2);
  });

  it("3. a skipped day resets streak to 1, streak_best keeps the old high", async () => {
    const h = await Harness.create();
    for (const d of [0n, 1n, 2n]) {
      h.setLocalDay(DAY + d);
      await h.checkIn(0);
    }
    expect(h.read().streak_current).to.equal(3);
    h.setLocalDay(DAY + 4n); // DAY+3 skipped
    await h.checkIn(0);
    expect(h.read().streak_current).to.equal(1);
    expect(h.read().streak_best).to.equal(3);
  });

  it("4. two check-ins on the same day do not increment the streak (step 5/6 ordering)", async () => {
    const h = await Harness.create();
    h.setLocalDay(DAY);
    await h.checkIn(0);
    h.setLocalDay(DAY + 1n);
    await h.checkIn(0);
    expect(h.read().streak_current).to.equal(2);
    await h.checkIn(1);
    await h.checkIn(2);
    expect(h.read().streak_current).to.equal(2, "same-day check-ins must not move the streak");
    // The next day must still advance it. With the mask written before the streak step,
    // first_today is never true and this would stay stuck.
    h.setLocalDay(DAY + 2n);
    await h.checkIn(3);
    expect(h.read().streak_current).to.equal(3);
  });

  it("5. the same quest slot twice in one day fails with AlreadyKeptToday", async () => {
    const h = await Harness.create();
    h.setLocalDay(DAY);
    await h.checkIn(4, "Hard");
    const before = h.read();
    await h.fails(
      "check_in",
      { quest_slot: 4, tier: { Hard: {} }, proven: true, proof_hash: [...randomBytes(32)] },
      "AlreadyKeptToday",
    );
    expect(h.read()).to.deep.equal(before);
    h.setLocalDay(DAY + 1n);
    await h.checkIn(4, "Hard"); // fine the next day
  });

  it("slot 8 fails with InvalidSlot", async () => {
    const h = await Harness.create();
    h.setLocalDay(DAY);
    await h.fails(
      "check_in",
      { quest_slot: 8, tier: { Easy: {} }, proven: true, proof_hash: [...randomBytes(32)] },
      "InvalidSlot",
    );
  });

  it("6. crossing the daily cap truncates the award but still keeps the quest", async () => {
    const h = await Harness.create();
    h.setLocalDay(DAY);
    await h.checkIn(0, "Epic"); // 250
    await h.checkIn(1, "Epic"); // 500
    await h.checkIn(2, "Epic"); // only 100 left -> 600
    let k = h.read();
    expect(k.xp_today).to.equal(600);
    expect(k.xp_total).to.equal(600n);
    await h.checkIn(3, "Normal"); // at the cap: awarded 0
    k = h.read();
    expect(k.xp_today).to.equal(600);
    expect(k.xp_total).to.equal(600n);
    expect(k.quests_kept_total).to.equal(4);
    expect(k.today_mask & (1 << 3)).to.not.equal(0);
    expect(k.soul_earned).to.equal(60n); // 25 + 25 + 10 + 0: the cap limits Soul too
  });

  it("7. a declared check-in awards exactly half", async () => {
    const expected: [TierName, bigint][] = [["Easy", 25n], ["Normal", 50n], ["Hard", 75n], ["Epic", 125n]];
    for (const [tier, half] of expected) {
      const h = await Harness.create();
      h.setLocalDay(DAY);
      await h.checkIn(0, tier, false);
      expect(h.read().xp_total).to.equal(half, tier);
    }
  });

  it("8. daily counters reset when the day index changes, and only then", async () => {
    const h = await Harness.create();
    h.setLocalDay(DAY);
    await h.checkIn(0);
    await h.checkIn(1);
    // Later on the same local day (23:59 local): no reset.
    h.setTime((DAY + 1n) * SECONDS_PER_DAY - 1n - BigInt(IST) * 60n);
    await h.checkIn(2);
    let k = h.read();
    expect(k.xp_today).to.equal(300);
    expect(k.today_mask).to.equal(0b111);
    expect(k.xp_today_day).to.equal(DAY);
    // One second later it is the next local day: reset, then only this check-in.
    h.setTime((DAY + 1n) * SECONDS_PER_DAY - BigInt(IST) * 60n);
    await h.checkIn(0, "Easy");
    k = h.read();
    expect(k.xp_today).to.equal(50);
    expect(k.today_mask).to.equal(0b1);
    expect(k.xp_today_day).to.equal(DAY + 1n);
    expect(k.xp_total).to.equal(350n);
  });

  it("9. local_day: negative timestamp, and midnight at +330", async () => {
    // Negative timestamp, UTC: -1s is day -1 (plain `/` would say 0).
    const utc = await Harness.create(0);
    utc.setTime(-1n);
    await utc.checkIn(0);
    expect(utc.read().xp_today_day).to.equal(-1n);

    // +330: local midnight is 18:30 UTC of the previous UTC day.
    const ist = await Harness.create(IST);
    const midnight = DAY * SECONDS_PER_DAY - BigInt(IST) * 60n;
    ist.setTime(midnight - 1n);
    await ist.checkIn(0);
    expect(ist.read().xp_today_day).to.equal(DAY - 1n);
    ist.setTime(midnight);
    await ist.checkIn(0); // slot 0 is free again: it is a new local day
    expect(ist.read().xp_today_day).to.equal(DAY);
    expect(ist.read().streak_current).to.equal(2);
  });

  it("10. buy_soul touches soul_bought only", async () => {
    const h = await Harness.create();
    h.setLocalDay(DAY);
    await h.checkIn(0, "Epic");
    const before = h.read();
    await h.ok("buy_soul", { amount: new BN(500) });
    const after = h.read();
    expect(after.soul_bought).to.equal(before.soul_bought + 500n);
    expect({ ...after, soul_bought: 0n }).to.deep.equal({ ...before, soul_bought: 0n });
    await h.fails("buy_soul", { amount: new BN(0) }, "ZeroAmount");
  });

  it("record_oath bumps only the matching oath counter", async () => {
    const h = await Harness.create();
    h.setLocalDay(DAY);
    await h.checkIn(0, "Epic");
    const before = h.read();
    await h.ok("record_oath", { success: true });
    await h.ok("record_oath", { success: true });
    await h.ok("record_oath", { success: false });
    const after = h.read() as Keeper & { oaths_completed: number; oaths_failed: number };
    expect(after.oaths_completed).to.equal(2);
    expect(after.oaths_failed).to.equal(1);
    const strip = (k: object) => ({ ...k, oaths_completed: 0, oaths_failed: 0 });
    expect(strip(after)).to.deep.equal(strip(before)); // XP, Soul, streak untouched
  });

  it("debug_shift_day moves the local day by whole days (debug-only)", async () => {
    const h = await Harness.create();
    h.setLocalDay(DAY);
    await h.checkIn(0);
    await h.ok("debug_shift_day", { days: 1 });
    expect(h.read().tz_offset_minutes).to.equal(IST + 1440);
    await h.checkIn(0); // same wall clock, but now the next local day
    expect(h.read().xp_today_day).to.equal(DAY + 1n);
    expect(h.read().streak_current).to.equal(2);
  });
});
