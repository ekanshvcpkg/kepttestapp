// Connect / disconnect, connected address and SOL balance.

import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PublicKey } from "@solana/web3.js";

import { config } from "../config";
import { LAMPORTS_PER_SOL } from "../constants";
import { explainError } from "../chain/errors";
import { connectWallet, forgetWallet, solBalance } from "../chain/wallet";
import { log } from "../debug/log";

type Props = {
  wallet: PublicKey | null;
  onChange: (wallet: PublicKey | null) => void;
};

export function WalletScreen({ wallet, onChange }: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBalance = useCallback(async (pk: PublicKey) => {
    try {
      const lamports = await solBalance(pk);
      setBalance(lamports);
      log.wallet(`SOL balance ${(lamports / LAMPORTS_PER_SOL).toFixed(4)}`, `${lamports} lamports on ${config.cluster}`);
    } catch (e) {
      const { raw, meaning } = explainError(e);
      log.error("Balance read failed", meaning, raw);
    }
  }, []);

  // A wallet restored from a previous run (or after returning to this tab): show its balance.
  useEffect(() => {
    if (wallet) void loadBalance(wallet);
  }, [wallet, loadBalance]);

  const connect = useCallback(async () => {
    setBusy(true);
    log.wallet("Connect requested", `chain solana:${config.cluster}\nidentity ${config.appIdentity.name} (${config.appIdentity.uri})`);
    try {
      const { publicKey } = await connectWallet();
      log.wallet(`Connected ${publicKey.toBase58()}`);
      onChange(publicKey); // the balance loads via the effect above
    } catch (e) {
      const { raw, meaning } = explainError(e);
      log.error("Connect failed", meaning, raw);
    } finally {
      setBusy(false);
    }
  }, [loadBalance, onChange]);

  const disconnect = useCallback(() => {
    log.wallet(`Disconnected ${wallet?.toBase58() ?? ""}`);
    void forgetWallet();
    onChange(null);
    setBalance(null);
  }, [onChange, wallet]);

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Wallet</Text>
      {wallet ? (
        <>
          <Text style={styles.mono} selectable>{wallet.toBase58()}</Text>
          <Text style={styles.mono}>
            SOL {balance === null ? "…" : (balance / LAMPORTS_PER_SOL).toFixed(4)} ({config.cluster})
          </Text>
          <View style={styles.row}>
            <Btn label="Refresh balance" onPress={() => loadBalance(wallet)} disabled={busy} />
            <Btn label="Disconnect" onPress={disconnect} disabled={busy} />
          </View>
        </>
      ) : (
        <Btn label={busy ? "Connecting…" : "Connect wallet"} onPress={connect} disabled={busy} />
      )}
    </View>
  );
}

export function Btn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      style={[styles.btn, disabled && styles.btnDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  box: { padding: 12, borderBottomWidth: 1, borderColor: "#2a2a2e", gap: 6 },
  title: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  mono: { color: "#e6e6e6", fontFamily: "monospace", fontSize: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  btn: { backgroundColor: "#2a2a2e", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4 },
  btnSelected: { backgroundColor: "#f5b94a" },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#ffffff", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: "#2a2a2e",
    color: "#ffffff",
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 90,
    fontFamily: "monospace",
  },
  label: { color: "#8a8a8f", fontSize: 12 },
  warn: { color: "#ff6b6b", fontSize: 12 },
});
