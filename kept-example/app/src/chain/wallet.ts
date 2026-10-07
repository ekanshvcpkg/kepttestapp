// Mobile Wallet Adapter session: connect, and sign + send one transaction.
//
// The wallet's `auth_token` is remembered (AsyncStorage), so the user connects ONCE. Later
// actions re-authorize silently with that token and the wallet only asks to confirm the
// transaction. If the wallet rejects the token (revoked / expired / unverified app), we fall
// back to a full authorize and remember the new token.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { PublicKey, Transaction } from "@solana/web3.js";
import { transact, Web3MobileWallet } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";

import { config, walletChain } from "../config";
import { FOREGROUND_WAIT_TIMEOUT_MS, WALLET_AUTH_STORAGE_KEY } from "../constants";
import { log } from "../debug/log";
import { connection } from "./connection";

const identity = { name: config.appIdentity.name, uri: config.appIdentity.uri };

// ---- remembered wallet session ----

type WalletSession = { authToken: string; address: string };
let session: WalletSession | null | undefined; // undefined = not loaded yet

async function loadSession(): Promise<WalletSession | null> {
  if (session !== undefined) return session;
  try {
    const raw = await AsyncStorage.getItem(WALLET_AUTH_STORAGE_KEY);
    session = raw ? (JSON.parse(raw) as WalletSession) : null;
  } catch {
    session = null; // storage unavailable: behave as "not connected"
  }
  return session;
}

async function saveSession(next: WalletSession | null): Promise<void> {
  session = next;
  try {
    if (next) await AsyncStorage.setItem(WALLET_AUTH_STORAGE_KEY, JSON.stringify(next));
    else await AsyncStorage.removeItem(WALLET_AUTH_STORAGE_KEY);
  } catch {
    // Best effort: the in-memory session still works for this run.
  }
}

/** The wallet connected in a previous run, WITHOUT opening the wallet. Null if none. */
export async function restoreWallet(): Promise<PublicKey | null> {
  const s = await loadSession();
  return s ? new PublicKey(s.address) : null;
}

/** Forget the remembered session (the next action will ask the wallet to connect again). */
export async function forgetWallet(): Promise<void> {
  await saveSession(null);
}

/**
 * Inside an open wallet session: re-authorize silently with the remembered token, or fall back
 * to a full authorize. Remembers the (possibly new) token and returns the account.
 */
async function authorizeInSession(wallet: Web3MobileWallet): Promise<PublicKey> {
  const saved = await loadSession();
  let auth;
  if (saved) {
    try {
      auth = await wallet.authorize({ chain: walletChain, identity, auth_token: saved.authToken });
    } catch (e) {
      log.wallet("Saved wallet session rejected, reconnecting", e instanceof Error ? e.message : String(e));
      await saveSession(null);
    }
  }
  if (!auth) auth = await wallet.authorize({ chain: walletChain, identity });

  const account = auth.accounts[0];
  if (!account) throw new Error("Wallet authorized but returned no account");
  const publicKey = new PublicKey(Buffer.from(account.address, "base64"));
  await saveSession({ authToken: auth.auth_token, address: publicKey.toBase58() });
  return publicKey;
}

/** Asks the wallet to connect (silently reuses the remembered session if it is still valid). */
export async function connectWallet(): Promise<{ publicKey: PublicKey }> {
  const publicKey = await transact((wallet) => authorizeInSession(wallet));
  await waitForForeground();
  return { publicKey };
}

/** Sign an explicit server-provided message for Sign-in with Solana. */
export async function signWalletMessage(message: string): Promise<{ wallet: PublicKey; signature: Uint8Array }> {
  const result = await transact(async (wallet) => {
    const publicKey = await authorizeInSession(wallet);
    const signatures = await wallet.signMessages({
      addresses: [Buffer.from(publicKey.toBytes()).toString("base64")],
      payloads: [new TextEncoder().encode(message)],
    });
    if (!signatures[0]) throw new Error("Wallet did not return a message signature");
    return { publicKey, signature: signatures[0] };
  });
  await waitForForeground();
  return { wallet: result.publicKey, signature: result.signature };
}

/** Builds a transaction from one instruction, has the wallet sign + send it, waits for
 * confirmation. Returns the signature. */
export async function signAndSend(
  payer: PublicKey,
  instruction: Transaction["instructions"][number] | Transaction["instructions"],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(...(Array.isArray(instruction) ? instruction : [instruction]));

  // Dry-run first. If the program would reject this transaction, the wallet's send is silently
  // dropped and the only symptom is a misleading "block height exceeded". Fail here instead,
  // with the program's real error and logs.
  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) {
    throw new Error(
      `Simulation failed: ${JSON.stringify(sim.value.err)}\n${(sim.value.logs ?? []).join("\n")}`,
    );
  }

  const slot = await connection.getSlot("confirmed");
  const [signature] = await transact(async (wallet) => {
    const authorized = await authorizeInSession(wallet);
    if (!authorized.equals(payer)) {
      throw new Error(`Wallet switched accounts: expected ${payer.toBase58()}, got ${authorized.toBase58()}`);
    }
    // Phantom rejects the request if minContextSlot is missing.
    return wallet.signAndSendTransactions({ transactions: [tx], minContextSlot: slot });
  });
  if (!signature) throw new Error("Wallet returned no signature");

  // Some Android builds block network access for backgrounded apps, and the wallet is still
  // in front right after signing. Wait until we are visible again before using the RPC.
  await waitForForeground();
  const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (result.value.err) {
    throw new Error(`Transaction ${signature} failed on chain: ${JSON.stringify(result.value.err)}`);
  }
  return signature;
}

export async function solBalance(owner: PublicKey): Promise<number> {
  return connection.getBalance(owner, "confirmed");
}

function waitForForeground(): Promise<void> {
  if (AppState.currentState === "active") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error("App did not return to the foreground after the wallet"));
    }, FOREGROUND_WAIT_TIMEOUT_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        clearTimeout(timer);
        sub.remove();
        resolve();
      }
    });
  });
}
