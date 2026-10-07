import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import fs from "fs";

const connection = new Connection(process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const idl = JSON.parse(fs.readFileSync("./target/idl/kept_test.json", "utf8"));
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(anchor.web3.Keypair.generate()), {});
const program = new anchor.Program(idl, provider);

async function run() {
  const pda = new PublicKey("3FwaKRhs4gK3yfPEkkbpZ92XkUzB9yUzMdo8S7vNtk9X");
  const account = await (program as any).account.keeper.fetchNullable(pda);
  console.log(account);
}
run().catch(console.error);
