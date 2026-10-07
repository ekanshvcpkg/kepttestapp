import { createHash, createHmac, randomBytes, timingSafeEqual, verify as verifySignature, createPublicKey } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import { config } from "./config.js";

const pending = new Map<string, { nonce: string; expires: number }>();
const DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export type AuthedRequest = Request & { wallet: string };

export function issueNonce(wallet: string): string {
  const pk = new PublicKey(wallet).toBase58();
  const nonce = randomBytes(32).toString("hex");
  pending.set(pk, { nonce, expires: Date.now() + 5 * 60_000 });
  return `KEPT V4 sign-in\nWallet: ${pk}\nNonce: ${nonce}\nThis signature only signs in and cannot move funds.`;
}

export function verifyLogin(wallet: string, message: string, signatureBase64: string): boolean {
  const pk = new PublicKey(wallet).toBase58();
  const challenge = pending.get(pk);
  pending.delete(pk);
  if (!challenge || challenge.expires < Date.now() || message !== `KEPT V4 sign-in\nWallet: ${pk}\nNonce: ${challenge.nonce}\nThis signature only signs in and cannot move funds.`) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([DER_PREFIX, new PublicKey(pk).toBuffer()]), format: "der", type: "spki" });
    return verifySignature(null, Buffer.from(message), key, Buffer.from(signatureBase64, "base64"));
  } catch { return false; }
}

export function issueSession(wallet: string): string {
  if (!config.sessionSecret) throw new Error("SESSION_SECRET is not configured");
  const payload = Buffer.from(JSON.stringify({ sub: wallet, exp: Date.now() + 7 * 24 * 60 * 60_000 })).toString("base64url");
  const sig = createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  try {
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token || !config.sessionSecret) throw new Error("Unauthorized");
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new Error("Unauthorized");
    const expected = createHmac("sha256", config.sessionSecret).update(payload).digest();
    const got = Buffer.from(signature, "base64url");
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new Error("Unauthorized");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub: string; exp: number };
    if (!data.sub || data.exp < Date.now()) throw new Error("Unauthorized");
    (req as AuthedRequest).wallet = new PublicKey(data.sub).toBase58();
    next();
  } catch { res.status(401).json({ error: "Sign-in required" }); }
}

export function hashBytes(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
