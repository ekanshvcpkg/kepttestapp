// The evidence screen: a pinned panel with every stored Keeper field (and, separately,
// what the device derives from them), then the log, newest first.

import { memo, useCallback, useState, useSyncExternalStore } from "react";
import { Alert, FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";

import { KEEPER_FIELDS, formatField, keeperSnapshot, KeeperState } from "../chain/keeper";
import { derive } from "../progress/curve";
import { formatTime, logAsText } from "./log";
import { LogCategory, LogEntry, logStore } from "./logStore";

const CATEGORY_COLOR: Record<LogCategory, string> = {
  WALLET: "#7aa2ff",
  TX: "#f5b94a",
  ACCOUNT: "#5fd38d",
  DERIVE: "#c792ea",
  ERROR: "#ff6b6b",
};

export function DebugConsole() {
  const entries = useSyncExternalStore(logStore.subscribe, logStore.getSnapshot);
  const keeper = useSyncExternalStore(keeperSnapshot.subscribe, keeperSnapshot.get);

  const copyAll = useCallback(async () => {
    await Clipboard.setStringAsync(logAsText(logStore.getSnapshot()));
    Alert.alert("Copied", `${logStore.getSnapshot().length} log entries copied as plain text.`);
  }, []);

  const clear = useCallback(() => {
    Alert.alert("Clear log?", "This deletes every entry, including the saved copy.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => logStore.clear() },
    ]);
  }, []);

  return (
    <View style={styles.root}>
      <StatePanel keeper={keeper} />
      <View style={styles.toolbar}>
        <Text style={styles.count}>{entries.length} entries</Text>
        <Pressable style={styles.toolButton} onPress={copyAll}>
          <Text style={styles.toolText}>Copy all</Text>
        </Pressable>
        <Pressable style={styles.toolButton} onPress={clear}>
          <Text style={styles.toolText}>Clear</Text>
        </Pressable>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <LogRow entry={item} />}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={11}
        removeClippedSubviews
        ListEmptyComponent={<Text style={styles.empty}>No entries yet. Use the Harness tab.</Text>}
      />
    </View>
  );
}

function StatePanel({ keeper }: { keeper: KeeperState | null }) {
  if (!keeper) {
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>KEEPER ACCOUNT</Text>
        <Text style={styles.mono}>Not loaded. Connect, then Init Keeper or Refresh account.</Text>
      </View>
    );
  }
  const d = derive(keeper.xpTotal);
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>STORED ON CHAIN  ·  {keeper.address.slice(0, 6)}…{keeper.address.slice(-4)}</Text>
      {KEEPER_FIELDS.map(([key, label]) => (
        <Text key={key} style={styles.mono} numberOfLines={1}>
          {label.padEnd(18)} {formatField(key, keeper[key])}
        </Text>
      ))}
      <Text style={[styles.panelTitle, styles.derivedTitle]}>DERIVED ON DEVICE  (from xp_total, never stored)</Text>
      <Text style={styles.mono}>{"level".padEnd(18)} {d.level}</Text>
      <Text style={styles.mono}>{"rank".padEnd(18)} {d.rank}</Text>
      <Text style={styles.mono}>{"xp_into_level".padEnd(18)} {d.xpIntoLevel}</Text>
      <Text style={styles.mono}>{"xp_to_next_level".padEnd(18)} {d.xpForNextLevel - d.xpIntoLevel} (of {d.xpForNextLevel})</Text>
    </View>
  );
}

const LogRow = memo(function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(entry.category === "ACCOUNT" || entry.category === "ERROR");
  return (
    <Pressable style={styles.row} onPress={() => setOpen((o) => !o)}>
      <View style={styles.rowHead}>
        <Text style={styles.time}>{formatTime(entry.ts)}</Text>
        <Text style={[styles.category, { color: CATEGORY_COLOR[entry.category] }]}>{entry.category}</Text>
        <Text style={styles.summary} numberOfLines={open ? undefined : 1}>
          {entry.summary}
        </Text>
      </View>
      {open && entry.detail ? <Text style={styles.detail}>{entry.detail}</Text> : null}
      {open && entry.copyValue ? (
        <Pressable onPress={() => Clipboard.setStringAsync(entry.copyValue!)}>
          <Text style={styles.link}>Copy signature</Text>
        </Pressable>
      ) : null}
      {open && entry.url ? (
        <Pressable onPress={() => Linking.openURL(entry.url!)}>
          <Text style={styles.link}>Open in explorer</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
});

const MONO = "monospace";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0b0c" },
  panel: { padding: 10, borderBottomWidth: 1, borderColor: "#2a2a2e", backgroundColor: "#121214" },
  panelTitle: { color: "#5fd38d", fontFamily: MONO, fontSize: 11, marginBottom: 4 },
  derivedTitle: { color: "#c792ea", marginTop: 8 },
  mono: { color: "#e6e6e6", fontFamily: MONO, fontSize: 11 },
  toolbar: { flexDirection: "row", alignItems: "center", padding: 8, gap: 8, borderBottomWidth: 1, borderColor: "#2a2a2e" },
  count: { color: "#8a8a8f", flex: 1, fontFamily: MONO, fontSize: 12 },
  toolButton: { backgroundColor: "#2a2a2e", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 },
  toolText: { color: "#ffffff", fontSize: 13 },
  empty: { color: "#8a8a8f", padding: 16, textAlign: "center" },
  row: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: "#1c1c1f" },
  rowHead: { flexDirection: "row", gap: 6 },
  time: { color: "#6e6e73", fontFamily: MONO, fontSize: 11 },
  category: { fontFamily: MONO, fontSize: 11, width: 56 },
  summary: { color: "#ffffff", fontSize: 12, flex: 1 },
  detail: { color: "#d0d0d0", fontFamily: MONO, fontSize: 11, marginTop: 6 },
  link: { color: "#7aa2ff", fontSize: 12, marginTop: 6 },
});
