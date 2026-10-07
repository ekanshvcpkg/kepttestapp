// The logging API. Everything else logs through these functions, never logStore directly.

import { logStore, LogCategory, LogEntry } from "./logStore";

/** Pretty, readable text for any value: bigint-safe, Uint8Array as hex. */
export function pretty(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Uint8Array) return `0x${Buffer.from(v).toString("hex")}`;
      if (v && typeof v === "object" && typeof (v as { toBase58?: unknown }).toBase58 === "function") {
        return (v as { toBase58(): string }).toBase58();
      }
      if (v && typeof v === "object" && v.constructor?.name === "BN") return v.toString();
      return v;
    },
    2,
  );
}

function add(category: LogCategory, summary: string, detail?: string, extra?: Partial<LogEntry>) {
  return logStore.add({ category, summary, detail, ...extra });
}

export const log = {
  wallet: (summary: string, detail?: string) => add("WALLET", summary, detail),
  tx: (summary: string, detail?: string, extra?: Partial<LogEntry>) => add("TX", summary, detail, extra),
  account: (summary: string, detail?: string) => add("ACCOUNT", summary, detail),
  derive: (summary: string, detail?: string) => add("DERIVE", summary, detail),
  /** Errors are logged in full: the plain-language meaning first, then the raw error. */
  error: (summary: string, meaning: string, raw: string) =>
    add("ERROR", summary, `What it means:\n${meaning}\n\nRaw error:\n${raw}`),
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** The whole log as readable plain text, oldest first, for Copy all. */
export function logAsText(entries: LogEntry[]): string {
  return [...entries]
    .reverse()
    .map((e) => {
      const head = `[${new Date(e.ts).toISOString()}] ${e.category.padEnd(7)} ${e.summary}`;
      const body = [e.detail, e.url].filter(Boolean).join("\n");
      return body ? `${head}\n${body.replace(/^/gm, "    ")}` : head;
    })
    .join("\n\n");
}
