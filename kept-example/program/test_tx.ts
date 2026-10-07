import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

const programId = new PublicKey("6iXXBqsdiCnUTSVf8CW3Uuw8c7iYvZSj5haz64QMuMUh");
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Use local keypair
const secretKey = JSON.parse(fs.readFileSync("/Users/voidmain/.config/solana/id.json", "utf8"));
const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
const wallet = new anchor.Wallet(walletKeypair);

const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "confirmed" });
anchor.setProvider(provider);

const idl = JSON.parse(fs.readFileSync("./target/idl/kept_test.json", "utf8"));
const program = new anchor.Program(idl, provider);

async function run() {
  const userPubkey = new PublicKey("BsUYmyow44ZchgLqUntHQx98QGJt5DLkRzyTMQFYFdm9");
  const [keeperPda] = PublicKey.findProgramAddressSync([Buffer.from("keeper"), userPubkey.toBuffer()], programId);

  console.log("Fetching PDA:", keeperPda.toBase58());

  try {
    const keeperAccount = await (program as any).account.keeper.fetchNullable(keeperPda);
    console.log("Keeper account:", keeperAccount);
  } catch (err) {
    console.error("Fetch Error:", err);
  }
}

run().catch(console.error);
