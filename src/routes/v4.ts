import { createHash, randomBytes, createSign } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Router, Request, Response, RequestHandler } from "express";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddress, getMint, getTokenGroupMemberState } from "@solana/spl-token";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { authenticate, AuthedRequest, hashBytes, issueNonce, issueSession, verifyLogin } from "../auth.js";
import { nudgeRejection, proofRejection } from "../v4/rules.js";

export const v4Router = Router();
const asyncRoute = (fn: (req: any, res: Response) => unknown): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res)).catch(next);
};
const post = (route: string, fn: (req: any, res: Response) => unknown) => v4Router.post(route, asyncRoute(fn));
const get = (route: string, fn: (req: any, res: Response) => unknown) => v4Router.get(route, asyncRoute(fn));
const connection = new Connection(config.devnetRpcUrl, "confirmed");
const programId = new PublicKey(config.programId);
const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
const gestures = ["thumbs_up", "victory", "open_palm", "closed_fist", "pointing_up"] as const;
const OBJECT_IDS = ["dumbbell", "book", "water_bottle", "guitar", "running_shoe", "plant", "skipping_rope", "yoga_mat"];

post("/api/auth/nonce", (req, res) => {
  try { const message = issueNonce(req.body?.wallet); res.json({ message }); }
  catch { res.status(400).json({ error: "Invalid wallet address" }); }
});

post("/api/auth/verify", (req, res) => {
  const { wallet, message, signature } = req.body ?? {};
  if (typeof wallet !== "string" || typeof message !== "string" || typeof signature !== "string" || !verifyLogin(wallet, message, signature)) {
    return res.status(401).json({ error: "Invalid or expired sign-in signature" });
  }
  return res.json({ token: issueSession(new PublicKey(wallet).toBase58()), wallet: new PublicKey(wallet).toBase58() });
});

v4Router.use("/api", authenticate);


get("/api/me", async (req: AuthedRequest, res) => {
  const seat = await prisma.sessionSeat.findUnique({ where: { wallet: req.wallet } });
  const genesisMint = await checkGenesis(req.wallet);
  if (genesisMint) {
    try { await prisma.sessionSeat.upsert({ where: { wallet: req.wallet }, create: { wallet: req.wallet, genesisMint }, update: { genesisMint } }); }
    catch { return res.status(409).json({ wallet:req.wallet, genesis:false, mocked:false, genesisMint:null, error:"This Genesis Token is assigned to a different wallet" }); }
  }
  return res.json({ wallet: req.wallet, genesis: !!genesisMint, mocked: config.sgtMock && !!genesisMint, genesisMint: genesisMint ?? seat?.genesisMint ?? null });
});

v4Router.use("/api", async (req: Request, res: Response, next) => {
  try {
    const wallet = (req as AuthedRequest).wallet;
    if (!wallet) return res.status(401).json({ error: "Sign-in required" });
    const mint = await checkGenesis(wallet);
    if (!mint) return res.status(403).json({ error: "A Seeker Genesis Token is required" });
    await prisma.sessionSeat.upsert({ where: { wallet }, create: { wallet, genesisMint: mint }, update: { genesisMint: mint } });
    next();
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) return res.status(409).json({ error: "This Genesis Token is already assigned to another wallet" });
    next(e);
  }
});

post("/api/oaths/watch", async (req: AuthedRequest, res) => {
  const oath = typeof req.body?.oath === "string" ? req.body.oath : "";
  const info = await readOath(oath);
  if (!info || !info.members.includes(req.wallet)) return res.status(403).json({ error: "Oath member access required" });
  await prisma.oathWatch.upsert({ where: { oath }, create: { oath }, update: {} });
  return res.status(204).end();
});


post("/api/faucet", async (req: AuthedRequest, res) => {
  if (config.devnetRpcUrl.includes("mainnet")) return res.status(403).json({ error: "Faucet is Devnet only" });
  if (!config.stakeMint || !config.faucetSecretKey) return res.status(503).json({ error: "Faucet is not configured" });
  try { await prisma.faucetClaim.create({ data: { wallet: req.wallet, signature: "pending" } }); }
  catch { return res.status(429).json({ error: "This wallet has already used the 5,000 SKR faucet" }); }
  try {
    const signer = keypairFromEnv(config.faucetSecretKey);
    const mint = new PublicKey(config.stakeMint);
    const owner = new PublicKey(req.wallet);
    const program = await tokenProgramForMint(mint);
    const source = await getAssociatedTokenAddress(mint, signer.publicKey, false, program);
    const destination = await getAssociatedTokenAddress(mint, owner, false, program);
    const tx = new Transaction();
    if (!(await connection.getAccountInfo(destination))) tx.add(createAssociatedTokenAccountInstruction(signer.publicKey, destination, owner, mint, program));
    const info = await getMint(connection, mint, "confirmed", program);
    const amount = 5_000n * 10n ** BigInt(info.decimals);
    tx.add(createTransferInstruction(source, destination, signer.publicKey, amount, [], program));
    const sig = await connection.sendTransaction(tx, [signer]);
    await connection.confirmTransaction(sig, "confirmed");
    await prisma.faucetClaim.update({ where: { wallet: req.wallet }, data: { signature: sig } });
    return res.json({ signature: sig, amount: "5000", mint: mint.toBase58() });
  } catch (e) {
    await prisma.faucetClaim.deleteMany({ where: { wallet: req.wallet, signature: "pending" } });
    return res.status(502).json({ error: e instanceof Error ? e.message : "Faucet transfer failed" });
  }
});

post("/api/invites", async (req: AuthedRequest, res) => {
  const oath = typeof req.body?.oath === "string" ? req.body.oath : "";
  const info = await readOath(oath);
  if (!info || info.status !== 0 || !info.members.includes(req.wallet)) return res.status(403).json({ error: "Only an oath member can create an invite while the oath is Open" });
  const code = randomBytes(5).toString("base64url");
  await prisma.oathInvite.create({ data: { code, oath, createdBy: req.wallet } });
  return res.status(201).json({ code, deepLink: `kept://join/${code}`, oath: info });
});

get("/api/invites/:code", async (req, res) => {
  const row = await prisma.oathInvite.findUnique({ where: { code: req.params.code } });
  if (!row) return res.status(404).json({ error: "Invite not found" });
  const oath = await readOath(row.oath);
  if (!oath) return res.status(404).json({ error: "Oath not found" });
  const details = await prisma.oathDetails.findUnique({ where: { oath: row.oath } });
  return res.json({ oath, goalText: details?.goalText ?? null, alreadyStarted: oath.status !== 0 });
});

post("/api/oaths/details", async (req: AuthedRequest, res) => {
  const { oath, goalText } = req.body ?? {};
  if (typeof oath !== "string" || typeof goalText !== "string" || !goalText.trim() || goalText !== goalText.trim() || goalText.length > 120) {
    return res.status(400).json({ error: "Oath and a goal of 1–120 characters are required" });
  }
  const info = await readOath(oath);
  if (!info) return res.status(404).json({ error: "Oath not found" });
  if (info.creator !== req.wallet || info.status !== 0) return res.status(403).json({ error: "Only the creator can save goal details while the Oath is Open" });
  const normalized = goalText.trim();
  if (createHash("sha256").update(normalized, "utf8").digest("hex") !== info.goalHash) return res.status(422).json({ error: "Goal text does not match the on-chain goal hash" });
  await prisma.oathDetails.upsert({ where: { oath }, create: { oath, creator: req.wallet, goalText: normalized }, update: { goalText: normalized } });
  return res.status(201).json({ oath, goalText: normalized });
});

get("/api/oaths/:oath/details", async (req: AuthedRequest, res) => {
  const info = await readOath(req.params.oath);
  if (!info || !info.members.includes(req.wallet)) return res.status(403).json({ error: "Oath member access required" });
  const details = await prisma.oathDetails.findUnique({ where: { oath: req.params.oath } });
  return res.json({ goalText: details?.goalText ?? null });
});

post("/api/proof", async (req: AuthedRequest, res) => {
  const { oath, dayIndex, photo, detection } = req.body ?? {};
  if (typeof oath !== "string" || !Number.isInteger(dayIndex) || typeof photo !== "string" || !detection || typeof detection !== "object") return res.status(400).json({ error: "Expected oath, dayIndex, photo and detection result" });
  const state = await readOath(oath);
  const day = Number(dayIndex);
  if (!state) return res.status(404).json({ error: "Oath not found" });
  const prior = await prisma.oathProof.findUnique({ where: { oath_wallet_dayIndex: { oath, wallet: req.wallet, dayIndex: day } } });
  if (prior?.status === "RECORDED") return res.status(409).json({ error: "Proof already recorded for this day" });
  const duplicate = (state.daysKept[req.wallet] & (1 << day)) !== 0 && prior?.status !== "PENDING";
  const rejected = proofRejection({ status: state.status, member: state.members.includes(req.wallet), day, numDays: state.numDays, startTs: state.startTs, daySeconds: state.daySeconds, now: Math.floor(Date.now()/1000), alreadyRecorded: duplicate });
  if (rejected === "non_member") return res.status(403).json({ error: "Wallet is not an Oath member" });
  if (rejected === "not_active") return res.status(409).json({ error: "Oath is not active" });
  if (rejected === "wrong_day") return res.status(400).json({ error: "Wrong day" });
  if (rejected === "outside_day_window") return res.status(409).json({ error: "Proof is outside today's day window" });
  if (rejected === "duplicate") return res.status(409).json({ error: "Proof already recorded for this day" });
  const expected = dailyTarget(state.oathId, day, state.objectId);
  const obj = detection.object;
  const gesture = detection.gesture;
  if (!obj || obj.label !== expected.object || !Number.isFinite(obj.confidence) || obj.confidence < 0.7 || !gesture || gesture.label !== expected.gesture || !Number.isFinite(gesture.confidence) || gesture.confidence < 0.7 || detection.target?.object !== expected.object || detection.target?.gesture !== expected.gesture) return res.status(422).json({ error: "Detection did not meet today's target and confidence threshold", expected });
  let bytes: Buffer;
  try { bytes = Buffer.from(photo.replace(/^data:image\/(jpeg|jpg|png);base64,/, ""), "base64"); } catch { return res.status(400).json({ error: "Invalid photo data" }); }
  if (bytes.length < 100 || bytes.length > 8_000_000) return res.status(413).json({ error: "Photo must be between 100 bytes and 8 MB" });
  const verifier = config.verifierSecretKey ? keypairFromEnv(config.verifierSecretKey) : null;
  if (!verifier) return res.status(503).json({ error: "Verifier key is not configured" });
  const proofHash = Buffer.from(hashBytes(bytes), "hex");
  if (prior && prior.proofHash !== proofHash.toString("hex")) return res.status(409).json({ error: "A proof for this day is pending; retry the same image" });
  const file = prior?.photoPath || `${hashBytes(Buffer.from(`${oath}:${req.wallet}:${day}`))}.jpg`;
  try {
    await mkdir(config.proofStorageDir, { recursive: true });
    if (!prior) await writeFile(path.join(config.proofStorageDir, file), bytes, { flag: "wx" });
    if (prior?.status === "PENDING" && prior.signature && prior.signature !== "pending") {
      const confirmation = await connection.confirmTransaction(prior.signature, "confirmed");
      if (confirmation.value.err) throw new Error(`Verifier check-in failed: ${JSON.stringify(confirmation.value.err)}`);
      await prisma.oathProof.update({ where: { id: prior.id }, data: { status: "RECORDED" } });
      return res.status(200).json({ signature: prior.signature, proofHash: prior.proofHash, target: expected, recovered: true });
    }
    const row = prior ? await prisma.oathProof.update({ where: { id: prior.id }, data: { status: "PENDING", signature: "pending" } }) : await prisma.oathProof.create({ data: { oath, wallet: req.wallet, dayIndex: day, proofHash: proofHash.toString("hex"), photoPath: file, signature: "pending", status: "PENDING", objectLabel: obj.label, objectConfidence: obj.confidence, gestureLabel: gesture.label, gestureConfidence: gesture.confidence } });
    const signature = await recordCheckin(verifier, new PublicKey(oath), new PublicKey(req.wallet), day, proofHash, async (sig) => {
      await prisma.oathProof.update({ where: { id: row.id }, data: { signature: sig } });
    });
    await prisma.oathProof.update({ where: { id: row.id }, data: { status: "RECORDED", signature } });
    return res.status(prior ? 200 : 201).json({ signature, proofHash: proofHash.toString("hex"), target: expected });
  } catch (e) {
    const message=e instanceof Error?e.message:"Proof submission failed";
    if(message.includes("Verifier check-in failed:")) await prisma.oathProof.updateMany({where:{oath,wallet:req.wallet,dayIndex:day,status:"PENDING"},data:{status:"FAILED"}}).catch(()=>undefined);
    return res.status(502).json({ error: message, retryable: true });
  }
});

get("/api/photos/:oath/:day", async (req: AuthedRequest, res) => {
  const info = await readOath(req.params.oath);
  if (!info || !info.members.includes(req.wallet)) return res.status(403).json({ error: "Oath members only" });
  const rows = await prisma.oathProof.findMany({ where: { oath: req.params.oath, dayIndex: Number(req.params.day), status: "RECORDED", photoPath: { not: "" } }, orderBy: { createdAt: "asc" } });
  return res.json({ photos: await Promise.all(rows.map(async (p) => ({ wallet: p.wallet, proofHash: p.proofHash, signature: p.signature, image: `data:image/jpeg;base64,${(await readFile(path.join(config.proofStorageDir, p.photoPath))).toString("base64")}` }))) });
});

post("/api/push-token", async (req: AuthedRequest, res) => {
  if (typeof req.body?.token !== "string" || req.body.token.length > 4096) return res.status(400).json({ error: "Invalid device token" });
  await prisma.deviceToken.upsert({ where: { token: req.body.token }, create: { token: req.body.token, wallet: req.wallet }, update: { wallet: req.wallet } });
  return res.status(204).end();
});

post("/api/nudges", async (req: AuthedRequest, res) => {
  const { oath, recipient, dayIndex } = req.body ?? {};
  const info = await readOath(oath);
  if (!info || info.status !== 1) return res.status(403).json({ error: "Invalid Oath or status" });
  const currentDay=Math.floor((Math.floor(Date.now()/1000)-info.startTs)/info.daySeconds);
  const rejection=nudgeRejection({member:info.members.includes(req.wallet),recipientMember:info.members.includes(recipient),self:req.wallet===recipient,day:Number(dayIndex),currentDay,alreadyCheckedIn:(info.daysKept[recipient]&(1<<Number(dayIndex)))!==0});
  if(rejection==="wrong_day")return res.status(400).json({error:"Nudges are limited to today's Oath day"});
  if(rejection==="already_checked_in")return res.status(409).json({error:"That member has already checked in"});
  if(rejection)return res.status(403).json({error:"Invalid Oath member"});
  try {
    await prisma.nudge.create({ data: { oath, sender: req.wallet, recipient, dayIndex: Number(dayIndex) } });
    await pushToWallet(recipient, { title: "A friend nudged you", body: "Your Oath check-in is still waiting today.", oath, dayIndex: String(dayIndex) }).catch((e) => console.error("[push] nudge delivery failed", e));
    return res.status(201).json({ ok: true });
  } catch { return res.status(429).json({ error: "You have already nudged this member today" }); }
});

get("/api/price", async (_req, res) => res.json({ usdPerSkr: 0.01, skrForUsd10: 1000, devnet: true, label: "placeholder rate" }));

get("/api/photos/file/:id", async (req: AuthedRequest, res) => {
  const proof = await prisma.oathProof.findFirst({ where: { photoPath: req.params.id } });
  const oath = proof ? await readOath(proof.oath) : null;
  if (!proof || proof.status !== "RECORDED" || !proof.photoPath || !oath?.members.includes(req.wallet)) return res.status(404).end();
  return res.type("image/jpeg").send(await readFile(path.join(config.proofStorageDir, proof.photoPath)));
});

export function dailyTarget(oathId: string, day: number, objectId: number) {
  const digest = createHash("sha256").update(`${oathId}:${day}`).digest();
  return { object: OBJECT_IDS[objectId] ?? OBJECT_IDS[0], gesture: gestures[digest.readUInt32LE(0) % gestures.length] };
}

let fcmAccess: { token: string; expiresAt: number } | null = null;
async function fcmToken(): Promise<string | null> {
  if (!config.fcmServiceAccountJson) return null;
  if (fcmAccess && fcmAccess.expiresAt > Date.now() + 30_000) return fcmAccess.token;
  const sa = JSON.parse(config.fcmServiceAccountJson) as { client_email: string; private_key: string; project_id: string };
  const b64 = (v: string) => Buffer.from(v).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const input = `${head}.${claim}`;
  const signer = createSign("RSA-SHA256"); signer.update(input);
  const assertion = `${input}.${signer.sign(sa.private_key).toString("base64url")}`;
  const result = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  if (!result.ok) throw new Error(`FCM OAuth failed: ${result.status}`);
  const body = await result.json() as { access_token: string; expires_in: number };
  fcmAccess = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

async function pushToWallet(wallet: string, data: Record<string, string>) {
  if (!config.fcmServiceAccountJson) return;
  const service = JSON.parse(config.fcmServiceAccountJson) as { project_id: string };
  const token = await fcmToken();
  const devices = await prisma.deviceToken.findMany({ where: { wallet } });
  for (const d of devices) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${service.project_id}/messages:send`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { token: d.token, notification: { title: data.title, body: data.body }, data } }),
    });
    if (!r.ok) console.error("[push] FCM rejected message", r.status, await r.text());
  }
}

export function startV4Scheduler() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const watches = await prisma.oathWatch.findMany();
      for (const w of watches) {
        const oath = await readOath(w.oath);
        if (!oath) continue;
        if (oath.status === 2) {
          const proofs = await prisma.oathProof.findMany({ where: { oath: w.oath, photoPath: { not: "" } } });
          for (const proof of proofs) await unlink(path.join(config.proofStorageDir, proof.photoPath)).catch(() => undefined);
          if (proofs.length) await prisma.oathProof.updateMany({ where: { oath: w.oath }, data: { photoPath: "" } });
          continue;
        }
        if (oath.status !== 1) continue;
        const now = Math.floor(Date.now() / 1000);
        const elapsed = now - oath.startTs;
        const day = Math.floor(elapsed / oath.daySeconds);
        const end = oath.startTs + (day + 1) * oath.daySeconds;
        const secondsLeft = end - now;
        if (day >= 0 && day < oath.numDays && secondsLeft <= 7200 && secondsLeft > 0 && config.fcmServiceAccountJson) {
          for (const wallet of oath.members) {
            if (oath.daysKept[wallet] & (1 << day)) continue;
            try {
              await prisma.reminderSent.create({ data: { oath: w.oath, wallet, dayIndex: day } });
              await pushToWallet(wallet, { title: "Your KEPT check-in is due", body: "Two hours remain in today's Oath day.", oath: w.oath, dayIndex: String(day) });
          } catch { /* already reminded or delivery unavailable */ }
          }
        }
        if (now >= oath.startTs + oath.numDays * oath.daySeconds) {
          try {
            const signature = await settleOnChain(w.oath, oath);
            const proofs = await prisma.oathProof.findMany({ where: { oath: w.oath, photoPath: { not: "" } } });
            for (const proof of proofs) await unlink(path.join(config.proofStorageDir, proof.photoPath)).catch(() => undefined);
            await prisma.oathProof.updateMany({ where: { oath: w.oath }, data: { photoPath: "" } });
            console.log(`[v4] settled ${w.oath}: ${signature}; proof images deleted`);
          } catch (e) { console.error(`[v4] settlement failed ${w.oath}:`, e instanceof Error ? e.message : e); }
        }
      }
    } catch (e) { console.error("[v4] scheduler failed:", e); }
    finally { running = false; }
  };
  void tick();
  setInterval(() => void tick(), 60_000).unref();
}

async function settleOnChain(address: string, oath: OathRead) {
  if (!config.verifierSecretKey || !config.stakeMint) throw new Error("Settlement signer/mint is not configured");
  const signer = keypairFromEnv(config.verifierSecretKey);
  const oathPk = new PublicKey(address), mint = new PublicKey(config.stakeMint);
  const vault = PublicKey.findProgramAddressSync([Buffer.from("vault"), oathPk.toBuffer()], programId)[0];
  if (!config.treasuryTokenAccount) throw new Error("TREASURY_TOKEN_ACCOUNT is not configured");
  const treasury = new PublicKey(config.treasuryTokenAccount);
  const tokenProgram = await tokenProgramForMint(mint);
  const keys = [
    { pubkey: configPda, isSigner: false, isWritable: false }, { pubkey: oathPk, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: treasury, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ...oath.members.map((wallet) => ({ pubkey: PublicKey.findProgramAddressSync([Buffer.from("keeper"), new PublicKey(wallet).toBuffer()], programId)[0], isSigner: false, isWritable: true })),
  ];
  const data = createHash("sha256").update("global:settle_oath").digest().subarray(0, 8);
  const tx = new Transaction().add(new TransactionInstruction({ programId, keys, data }));
  const sig = await connection.sendTransaction(tx, [signer]);
  const confirmed = await connection.confirmTransaction(sig, "confirmed");
  if (confirmed.value.err) throw new Error(`settle_oath failed: ${JSON.stringify(confirmed.value.err)}`);
  return sig;
}

async function checkGenesis(wallet: string): Promise<string | null> {
  if (config.sgtMock) return config.sgtMockAllowlist.includes(wallet) ? `mock-sgt-${wallet}` : null;
  if (!config.genesisGroup) return null;
  const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), { programId: TOKEN_2022_PROGRAM_ID }, "confirmed");
  for (const a of accounts.value) {
    const mint = new PublicKey((a.account.data as any).parsed.info.mint);
    try {
      const state = getTokenGroupMemberState(await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID));
      if (state?.group?.toBase58() === config.genesisGroup) return mint.toBase58();
    } catch { /* unsupported or non-Token-2022 mint */ }
  }
  return null;
}

function keypairFromEnv(raw: string): Keypair {
  const parsed = JSON.parse(raw.startsWith("[") ? raw : `[${raw}]`) as number[];
  if (!Array.isArray(parsed) || parsed.length !== 64) throw new Error("Secret key must be a 64-byte JSON array");
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

async function tokenProgramForMint(mint: PublicKey) {
  const a = await connection.getAccountInfo(mint, "confirmed");
  if (!a) throw new Error("Stake mint not found");
  if (a.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (a.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error("Stake mint is not owned by Token or Token-2022");
}

type OathRead = { oathId: string; creator: string; goalHash: string; status: number; startTs: number; daySeconds: number; numDays: number; objectId: number; members: string[]; daysKept: Record<string, number> };
async function readOath(address: string): Promise<OathRead | null> {
  try {
    const pk = new PublicKey(address);
    const account = await connection.getAccountInfo(pk, "confirmed");
    if (!account || !account.owner.equals(programId)) return null;
    const d = account.data;
    if (d.length < 316 || !d.subarray(0, 8).equals(createHash("sha256").update("account:Oath").digest().subarray(0, 8))) return null;
    const oathId = d.readBigUInt64LE(40).toString();
    const objectId = d[120], numDays = d[121], daySeconds = d.readUInt32LE(122), startTs = Number(d.readBigInt64LE(126)), status = d[136], count = d[138];
    const members: string[] = [], daysKept: Record<string, number> = {};
    for (let i = 0; i < count; i++) { const o = 139 + i * 44; const wallet = new PublicKey(d.subarray(o, o + 32)).toBase58(); members.push(wallet); daysKept[wallet] = d.readUInt16LE(o + 33); }
    return { oathId, creator: new PublicKey(d.subarray(8, 40)).toBase58(), goalHash: d.subarray(88, 120).toString("hex"), status, startTs, daySeconds, numDays, objectId, members, daysKept };
  } catch { return null; }
}

async function recordCheckin(verifier: Keypair, oath: PublicKey, member: PublicKey, day: number, proofHash: Buffer, onSubmitted: (signature: string) => Promise<void>) {
  const disc = createHash("sha256").update("global:record_checkin").digest().subarray(0, 8);
  const ix = new TransactionInstruction({ programId, keys: [
    { pubkey: configPda, isSigner: false, isWritable: false }, { pubkey: oath, isSigner: false, isWritable: true },
    { pubkey: verifier.publicKey, isSigner: true, isWritable: false }, { pubkey: member, isSigner: false, isWritable: false },
  ], data: Buffer.concat([disc, Buffer.from([day]), proofHash]) });
  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [verifier]);
  await onSubmitted(sig);
  const confirmation = await connection.confirmTransaction(sig, "confirmed");
  if (confirmation.value.err) throw new Error(`Verifier check-in failed: ${JSON.stringify(confirmation.value.err)}`);
  return sig;
}
