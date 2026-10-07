// Ring buffer of the last LOG_CAPACITY entries, persisted to AsyncStorage so a crash or
// restart never loses the evidence. Newest entry first.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { LOG_CAPACITY, LOG_PERSIST_DEBOUNCE_MS, LOG_STORAGE_KEY } from "../constants";

export type LogCategory = "WALLET" | "TX" | "ACCOUNT" | "DERIVE" | "ERROR";

export type LogEntry = {
  id: string;
  ts: number; // epoch ms
  category: LogCategory;
  summary: string;
  detail?: string;
  /** Tap-to-copy value (e.g. a signature). */
  copyValue?: string;
  /** Tap-to-open URL (e.g. explorer). */
  url?: string;
};

type Listener = () => void;

let entries: LogEntry[] = [];
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    AsyncStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(entries)).catch(() => {
      // Persisting is best-effort; the in-memory log is still intact.
    });
  }, LOG_PERSIST_DEBOUNCE_MS);
}

export const logStore = {
  /** Loads persisted entries. New entries written before load finishes are kept on top. */
  async load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      const raw = await AsyncStorage.getItem(LOG_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as LogEntry[];
        entries = [...entries, ...saved].slice(0, LOG_CAPACITY);
        emit();
      }
    } catch {
      // Corrupt or unavailable storage: start fresh rather than crash.
    }
  },

  add(entry: Omit<LogEntry, "id" | "ts">): LogEntry {
    const full: LogEntry = { ...entry, id: `${Date.now()}-${seq++}`, ts: Date.now() };
    entries = [full, ...entries].slice(0, LOG_CAPACITY);
    emit();
    scheduleSave();
    return full;
  },

  clear() {
    entries = [];
    emit();
    scheduleSave();
  },

  getSnapshot(): LogEntry[] {
    return entries;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
