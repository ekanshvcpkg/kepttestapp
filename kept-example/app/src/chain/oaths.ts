import { BN } from "@anchor-lang/core";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha2.js";
import { config } from "../config";
import { log } from "../debug/log";
import { connection } from "./connection";
import { program } from "./program";
import { signAndSend } from "./wallet";

const CONFIG_SEED = Buffer.from("config"), OATH_SEED = Buffer.from("oath"), VAULT_SEED = Buffer.from("vault"), KEEPER_SEED = Buffer.from("keeper");
export const configPda = PublicKey.findProgramAddressSync([CONFIG_SEED], config.programId)[0];
export const oathPda = (creator: PublicKey, id: bigint) => PublicKey.findProgramAddressSync([OATH_SEED, creator.toBuffer(), u64(id)], config.programId)[0];
const vaultPda = (oath: PublicKey) => PublicKey.findProgramAddressSync([VAULT_SEED, oath.toBuffer()], config.programId)[0];
const keeperPda = (wallet: PublicKey) => PublicKey.findProgramAddressSync([KEEPER_SEED, wallet.toBuffer()], config.programId)[0];
const u64 = (x: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(x); return b; };

export type OathView = { address: string; oathId: string; creator: string; stakeAmount: string; mint: string; goalHash: string; objectId: number; numDays: number; daySeconds: number; startTs: number; tzOffset: number; status: number; isSolo: boolean; members: Array<{ wallet: string; daysKept: number; payout: string; claimed: boolean }> };

export async function fetchOath(address: PublicKey): Promise<OathView | null> {
  const acc = await connection.getAccountInfo(address, "confirmed");
  if (!acc || !acc.owner.equals(config.programId) || acc.data.length < 316) return null;
  const d = acc.data;
  const count = d[138], members = [];
  for (let i=0;i<count;i++) { const o=139+i*44; members.push({ wallet:new PublicKey(d.subarray(o,o+32)).toBase58(), daysKept:d.readUInt16LE(o+33), claimed:d[o+35]===1, payout:d.readBigUInt64LE(o+36).toString() }); }
  return { address:address.toBase58(), creator:new PublicKey(d.subarray(8,40)).toBase58(), oathId:d.readBigUInt64LE(40).toString(), stakeAmount:d.readBigUInt64LE(48).toString(), mint:new PublicKey(d.subarray(56,88)).toBase58(), goalHash:d.subarray(88,120).toString("hex"), objectId:d[120], numDays:d[121], daySeconds:d.readUInt32LE(122), startTs:Number(d.readBigInt64LE(126)), tzOffset:d.readInt16LE(134), status:d[136], isSolo:d[137]===1, members };
}

async function tokenContext(wallet: PublicKey) {
  if (!config.stakeMint || !config.treasuryTokenAccount) throw new Error("Set EXPO_PUBLIC_STAKE_MINT and EXPO_PUBLIC_TREASURY_TOKEN_ACCOUNT");
  const mint = new PublicKey(config.stakeMint), info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("Stake mint account was not found");
  const tokenProgram = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const ata = await getAssociatedTokenAddress(mint, wallet, false, tokenProgram);
  const ix: TransactionInstruction[] = [];
  if (!(await connection.getAccountInfo(ata))) ix.push(createAssociatedTokenAccountInstruction(wallet, ata, wallet, mint, tokenProgram));
  return { mint, tokenProgram, ata, ix, treasury: new PublicKey(config.treasuryTokenAccount) };
}

export async function createOath(wallet: PublicKey, input: { id: bigint; goal: string; objectId: number; days: number; daySeconds: number; tzOffset: number; stake: bigint; solo: boolean }) {
  const t=await tokenContext(wallet), oath=oathPda(wallet,input.id), vault=vaultPda(oath), keeper=keeperPda(wallet);
  const ix=await program.methods.createOath(new BN(input.id.toString()), Array.from(sha256(new TextEncoder().encode(input.goal))), input.objectId, input.days, input.daySeconds, input.tzOffset, new BN(input.stake.toString()), input.solo)
    .accountsPartial({ config:configPda, oath, vault, keeper, creator:wallet, stakeMint:t.mint, creatorToken:t.ata, treasury:t.treasury, tokenProgram:t.tokenProgram, systemProgram:SystemProgram.programId }).instruction();
  const sig=await signAndSend(wallet,[...t.ix,ix]); log.tx("Oath created",`${oath.toBase58()}\n${sig}`); return { oath, signature:sig };
}

export async function joinOath(wallet: PublicKey,address: PublicKey) {
  const t=await tokenContext(wallet), keeper=keeperPda(wallet), vault=vaultPda(address);
  const ix=await program.methods.joinOath().accountsPartial({ config:configPda, oath:address, vault, keeper, member:wallet, stakeMint:t.mint, memberToken:t.ata, treasury:t.treasury, tokenProgram:t.tokenProgram, systemProgram:SystemProgram.programId }).instruction();
  return signAndSend(wallet,[...t.ix,ix]);
}

export async function startOath(wallet: PublicKey,address: PublicKey) { return signAndSend(wallet,await program.methods.startOath().accountsPartial({ oath:address, creator:wallet }).instruction()); }
export async function cancelOath(wallet: PublicKey,address: PublicKey) { return signAndSend(wallet,await program.methods.cancelOath().accountsPartial({ oath:address, creator:wallet }).instruction()); }

export async function settleOath(wallet: PublicKey,address: PublicKey) {
  const state=await fetchOath(address); if (!state) throw new Error("Oath not found");
  const t=await tokenContext(wallet);
  const ix=await program.methods.settleOath().accountsPartial({ config:configPda, oath:address, vault:vaultPda(address), treasury:t.treasury, stakeMint:t.mint, tokenProgram:t.tokenProgram }).remainingAccounts(state.members.map(m=>({pubkey:keeperPda(new PublicKey(m.wallet)),isSigner:false,isWritable:true}))).instruction();
  return signAndSend(wallet,ix);
}

export async function claimOath(wallet: PublicKey,address: PublicKey) {
  const t=await tokenContext(wallet), ix=await program.methods.claim().accountsPartial({ oath:address, vault:vaultPda(address), stakeMint:t.mint, destination:t.ata, member:wallet, tokenProgram:t.tokenProgram }).instruction();
  return signAndSend(wallet,[...t.ix,ix]);
}

export async function migrateKeeper(wallet:PublicKey){
  const [keeper]=PublicKey.findProgramAddressSync([KEEPER_SEED,wallet.toBuffer()],config.programId);
  const ix=await program.methods.migrateKeeper().accountsPartial({keeper,authority:wallet}).instruction();
  return signAndSend(wallet,ix);
}
