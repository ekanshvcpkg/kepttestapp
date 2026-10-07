import { useSyncExternalStore, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { logAsText } from "../debug/log";
import { logStore, LogEntry } from "../debug/logStore";

export function DebugConsole(){
 const rows=useSyncExternalStore(logStore.subscribe,logStore.getSnapshot);
 return <View style={s.root}><View style={s.bar}><Text style={s.muted}>{rows.length} entries</Text><Pressable onPress={()=>void Clipboard.setStringAsync(logAsText(rows))}><Text style={s.link}>Copy all</Text></Pressable><Pressable onPress={()=>Alert.alert("Clear logs?","This clears the saved debug history.",[{text:"Cancel"},{text:"Clear",onPress:()=>logStore.clear()}])}><Text style={s.link}>Clear</Text></Pressable></View><FlatList data={rows} keyExtractor={(x:LogEntry)=>x.id} renderItem={({item})=><Row row={item}/>} /></View>
}
function Row({row}:{row:LogEntry}){const [open,set]=useState(row.category==="ERROR");return <Pressable onPress={()=>set(!open)} style={s.row}><Text style={s.head}>{new Date(row.ts).toLocaleTimeString()} · {row.category} · {row.summary}</Text>{open&&row.detail?<Text selectable style={s.detail}>{row.detail}</Text>:null}</Pressable>}
const s=StyleSheet.create({root:{flex:1,backgroundColor:"#0b0b0c"},bar:{flexDirection:"row",justifyContent:"space-between",padding:10},muted:{color:"#888"},link:{color:"#7aa2ff"},row:{padding:10,borderBottomWidth:1,borderColor:"#222"},head:{color:"white",fontFamily:"monospace",fontSize:12},detail:{color:"#ccc",fontFamily:"monospace",fontSize:11,marginTop:8}});
