import AsyncStorage from "@react-native-async-storage/async-storage";
import { PublicKey } from "@solana/web3.js";
import { config } from "./config";
import { BACKEND_SESSION_STORAGE_KEY } from "./constants";
import { log, pretty } from "./debug/log";
import { signWalletMessage } from "./chain/wallet";

let token: string | null = null;

export async function signIn(wallet: PublicKey) {
  const messageRes = await call<{ message: string }>("/api/auth/nonce", { method: "POST", body: { wallet: wallet.toBase58() }, auth: false });
  const signed = await signWalletMessage(messageRes.message);
  const response = await call<{ token: string; wallet: string }>("/api/auth/verify", { method: "POST", body: { wallet: signed.wallet.toBase58(), message: messageRes.message, signature: Buffer.from(signed.signature).toString("base64") }, auth: false });
  token = response.token;
  await AsyncStorage.setItem(BACKEND_SESSION_STORAGE_KEY, token);
  return response;
}

export async function restoreSession() {
  token = await AsyncStorage.getItem(BACKEND_SESSION_STORAGE_KEY);
  if (!token) return null;
  try { return await call<{ wallet: string; genesis: boolean; mocked: boolean; genesisMint: string | null }>("/api/me", { method: "GET" }); }
  catch { token = null; await AsyncStorage.removeItem(BACKEND_SESSION_STORAGE_KEY); return null; }
}

export async function signOut() { token = null; await AsyncStorage.removeItem(BACKEND_SESSION_STORAGE_KEY); }

export async function api<T>(route: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  return call<T>(route, { method, body });
}

async function call<T>(route: string, options: { method: "GET" | "POST"; body?: unknown; auth?: boolean }): Promise<T> {
  let printable: unknown = options.body;
  if (printable && typeof printable === "object" && "photo" in printable) {
    const { photo, ...rest } = printable as Record<string, unknown>;
    printable = { ...rest, photo: `<base64 image ${String(photo).length} chars>` };
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  log.tx(`API ${options.method} ${route} →`, pretty({ id, body: printable ?? null }));
  try {
    const auth = options.auth === false ? null : (token ?? await AsyncStorage.getItem(BACKEND_SESSION_STORAGE_KEY));
    if (auth) token = auth;
    const response = await fetch(`${config.backendUrl}${route}`, {
      method: options.method,
      headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const raw = await response.text();
    let data: any;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    log.tx(`API ${response.status} ${route} ←`, pretty({ id, status: response.status, body: data }));
    if (!response.ok) throw new Error(data?.error ?? `Backend returned ${response.status}`);
    return data as T;
  } catch (e) {
    log.error(`API ${route} failed`, e instanceof Error ? e.message : String(e), String(e));
    throw e;
  }
}
