import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { issueNonce, verifyLogin } from "../src/auth.js";
import { nudgeRejection, proofRejection } from "../src/v4/rules.js";

test("Sign-in requires the issued wallet-specific message and consumes its nonce", () => {
  const kp=Keypair.generate(), wallet=kp.publicKey.toBase58(), message=issueNonce(wallet);
  const signature=Buffer.from(nacl.sign.detached(Buffer.from(message),kp.secretKey)).toString("base64");
  assert.equal(verifyLogin(wallet,message,signature),true);
  assert.equal(verifyLogin(wallet,message,signature),false,"nonce cannot be replayed");
});

test("proof gates reject non-members, wrong day windows and duplicates", () => {
  const base={status:1,member:true,day:1,numDays:3,startTs:1000,daySeconds:120,now:1120,alreadyRecorded:false};
  assert.equal(proofRejection({...base,member:false}),"non_member");
  assert.equal(proofRejection({...base,day:0}),"outside_day_window");
  assert.equal(proofRejection({...base,alreadyRecorded:true}),"duplicate");
  assert.equal(proofRejection(base),null);
});

test("nudge rules restrict members, current day, and already completed proof", () => {
  const base={member:true,recipientMember:true,self:false,day:2,currentDay:2,alreadyCheckedIn:false};
  assert.equal(nudgeRejection({...base,recipientMember:false}),"invalid_member");
  assert.equal(nudgeRejection({...base,day:1}),"wrong_day");
  assert.equal(nudgeRejection({...base,alreadyCheckedIn:true}),"already_checked_in");
  assert.equal(nudgeRejection(base),null);
});
