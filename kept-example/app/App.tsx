import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { PublicKey } from "@solana/web3.js";
import { config } from "./src/config";
import { DebugConsole } from "./src/screens/DebugConsole";
import { logStore } from "./src/debug/logStore";
import { log } from "./src/debug/log";
import { restoreWallet } from "./src/chain/wallet";
import { restoreSession } from "./src/backend";
import { TestHarness } from "./src/screens/TestHarness";

type Tab = "oaths" | "console";
export default function App() {
  const [tab,setTab]=useState<Tab>("oaths");
  const [wallet,setWallet]=useState<PublicKey|null>(null);
  const [signedIn,setSignedIn]=useState(false);
  useEffect(()=>{ void logStore.load(); void (async()=>{
    const restored=await restoreWallet();
    if(restored){ setWallet(restored); log.wallet(`Restored wallet ${restored.toBase58()}`); }
    const session=await restoreSession(); if(session) setSignedIn(true);
  })(); },[]);
  return <View style={styles.root}>
    <StatusBar style="light" />
    <View style={styles.header}><Text style={styles.title}>KEPT V4 · Devnet test harness</Text><Text style={styles.sub}>{config.cluster} · {config.programId.toBase58().slice(0,8)}…</Text></View>
    <View style={styles.tabs}>{(["oaths","console"] as const).map(t=><Pressable key={t} style={[styles.tab,tab===t&&styles.active]} onPress={()=>setTab(t)}><Text style={styles.tabText}>{t==="oaths"?"Oaths":"Debug console"}</Text></Pressable>)}</View>
    <View style={styles.body}>{tab==="oaths"?<TestHarness wallet={wallet} onWalletChange={setWallet} signedIn={signedIn} onSignedInChange={setSignedIn} onShowConsole={()=>setTab("console")}/>:<DebugConsole/>}</View>
  </View>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:"#0b0b0c",paddingTop:32},header:{paddingHorizontal:12,paddingBottom:6},title:{color:"white",fontSize:17,fontWeight:"700"},sub:{color:"#8a8a8f",fontSize:12,fontFamily:"monospace"},tabs:{flexDirection:"row",borderBottomWidth:1,borderColor:"#2a2a2e"},tab:{flex:1,paddingVertical:10,alignItems:"center"},active:{borderBottomWidth:2,borderColor:"#f5b94a"},tabText:{color:"white",fontSize:14},body:{flex:1}});
