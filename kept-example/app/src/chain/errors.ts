// Turns any error from the wallet, RPC or program into: the raw text (logged in full) and
// one plain-language line saying what it means.

import { programErrors } from "./program";

const PROGRAM_ERROR_MEANING: Record<string, string> = {
  InvalidSlot: "The quest slot must be 0-7.",
  AlreadyKeptToday: "That quest slot was already kept today. Pick another slot, or wait for the next local day (or use Shift day +1 in debug).",
  InvalidTimezoneOffset: "The device's UTC offset is outside -12:00 .. +14:00.",
  ZeroAmount: "Buy Soul needs an amount greater than zero.",
  Overflow: "A counter would overflow. This should never happen in normal use.",
};

export type Explained = { raw: string; meaning: string };

export function rawError(e: unknown): string {
  if (e instanceof Error) {
    return `${e.name}: ${e.message}\n${e.stack ?? ""}`;
  }
  return typeof e === "object" ? JSON.stringify(e) : String(e);
}

export function explainError(e: unknown): Explained {
  const raw = rawError(e);
  const text = raw.toLowerCase();

  // Program errors: "Error Code: AlreadyKeptToday" in logs, or "custom program error: 0x1771".
  const named = raw.match(/Error Code: (\w+)/);
  const hex = raw.match(/custom program error: (0x[0-9a-f]+)/i);
  const code = hex ? parseInt(hex[1], 16) : undefined;
  const programName = named?.[1] ?? (code !== undefined ? programErrors[code]?.name : undefined);
  if (programName && PROGRAM_ERROR_MEANING[programName]) {
    return { raw, meaning: `Program rejected it (${programName}): ${PROGRAM_ERROR_MEANING[programName]}` };
  }

  if (code === 0 || text.includes("already in use")) {
    return { raw, meaning: "This wallet already has a Keeper. Init Keeper only runs once per wallet." };
  }
  if (text.includes("accountnotinitialized") || text.includes("account does not exist") || code === 3012) {
    return { raw, meaning: "No Keeper account for this wallet yet. Tap Init Keeper first." };
  }
  if (text.includes("no record of a prior credit") || text.includes("insufficient")) {
    return { raw, meaning: "The wallet has no (or too little) SOL on this cluster to pay the fee. Airdrop Devnet SOL to it." };
  }
  if (text.includes("429") || text.includes("too many requests") || text.includes("rate limit")) {
    return { raw, meaning: "The RPC endpoint is rate-limiting this network. Set EXPO_PUBLIC_RPC_URL to a private Devnet RPC." };
  }
  if (text.includes("blockhash not found") || text.includes("block height exceeded") || text.includes("expired")) {
    return {
      raw,
      meaning:
        "The transaction never landed before its blockhash expired. Usually the network or wallet approval was slow; " +
        "but a transaction the program rejects is also dropped this way. Check the Keeper state above, and try again.",
    };
  }
  if (text.includes("declined") || text.includes("rejected") || text.includes("authorization_failed") || text.includes("-1:")) {
    return { raw, meaning: "The request was declined in the wallet, so nothing was sent." };
  }
  if (text.includes("wallet_not_found") || text.includes("found no installed wallet")) {
    return { raw, meaning: "No Mobile Wallet Adapter wallet (e.g. Phantom) is installed on this phone." };
  }
  if (text.includes("network request failed") || text.includes("unable to resolve host") || text.includes("failed to fetch")) {
    return { raw, meaning: "The phone could not reach the RPC. Check the internet connection and EXPO_PUBLIC_RPC_URL." };
  }
  if (text.includes("foreground")) {
    return { raw, meaning: "The app stayed in the background after the wallet, so it could not confirm. Check the explorer for the signature." };
  }
  return { raw, meaning: "Unrecognised error. The raw text below is the full detail." };
}
