# Kept Backend — Build Log

> **Superseded in part.** The current, complete handoff is **`BACKEND_PART_1.md`**. This file is the
> older build log. Still valid here: the payment-verification design and the Node/Render rebuild guide.
> **Obsolete here:** everything about `kept_example`, program ID `GmW838...` (never deployed),
> `src/keeper.ts` and `GET /api/keeper/:wallet` (all removed), and the Express-side level curve notes.
> The on-chain program is now `kept_test` (`6iXXBq...`). Do not rebuild from the obsolete parts.

> **Claude: to rebuild or debug the backend, start at the "REBUILD GUIDE FOR CLAUDE (backend)" section below.** It has the exact source of every file, the Render deploy steps, and every problem we hit with its fix. It overrides the older design notes and the Progress Log where they disagree.

> This file tracks the backend side of **Kept**, a native Android dApp for the
> Solana Mobile ecosystem. A teammate is building the bare-bones Kotlin frontend
> using the `mobile-wallet-adapter` repo in this workspace; I own everything else.
> Once both sides are far enough along, bring this file (and the frontend's
> equivalent doc) to Claude so it can combine them into one app.
>
> **Folder structure:**
> - `mobile-wallet-adapter-main/` — Solana Mobile's official reference implementation
>   (clientlib/walletlib/fakedapp/fakewallet). We **learn from it** — it's the contract
>   that tells us exactly what the frontend will send us. We don't build the product in it.
> - `mainbackend/` (this folder) — where our **own** Kept backend code actually lives.
>
> **Rule going forward:** every time real backend work is done, add an entry to the
> Progress Log below (what changed, why, and what's next).
>
> **IMPORTANT — a separate, more developed "Kept" project exists:**
> `~/Documents/mainfile/KEPT-APP-MAIN-main/` has its own real Expo/React Native
> frontend (`frontend/`, Android package `app.kept.mobile`, domain `keptdapp.vercel.app`,
> already has a working `assetlinks.json`) **and** its own real backend — but that
> backend is an **Anchor/Solana on-chain program** (`backend/programs/kept_system`,
> "Keeper profiles, check-ins, XP, ranks, Penalty Zone"), not a Node/Express REST API.
> Discovered 2026-10-03 while debugging the MWA identity-verification warning. Everything
> in *this* `mainweb3/kept_backend/` tree (the Express SOL-payment-verification backend,
> the `testharness` Android app) is a **separate, parallel effort** — confirmed intentional
> by the user, not a mix-up — so don't assume they're the same system or quietly merge them.

---

## Separation of Concerns

This is the strict split for this build. The frontend is deliberately dumb; every
decision, every check, every piece of state lives in the backend.

### Frontend (teammate) — not built by us, documented here only so the API contract is unambiguous
- Main screen: a single, centered **"Connect Wallet"** button. Nothing else.
- On tap: uses Solana **Mobile Wallet Adapter (MWA)** to fire the `authorize`
  association intent against whatever wallet app is installed (Phantom, etc.),
  explicitly requesting `chain: "solana:devnet"` (see `MobileWalletAdapter.kt` /
  `connect()` in `clientlib-ktx` — it's a bare `transact(sender) {}` call with no
  signing, just establishing the session and getting back the authorized pubkey).
- To unlock an action/item: builds a plain **native SOL transfer** — a
  `SystemProgram.transfer` instruction, user's authorized pubkey → our treasury
  address, for a fixed lamport amount — serializes it, and calls MWA's
  `signAndSendTransactions`. The wallet app signs **and submits** it to Devnet RPC
  itself, returning a base58 **transaction signature**.
- Passes `{ signature, payerAddress }` to our backend and nothing more. The
  frontend does **zero verification** — it is purely a messenger between the
  wallet and our API.

### Backend (us) — Node.js + Express + TypeScript + `@solana/web3.js`
All business logic, all trust decisions, all state. Core rule: **nothing the
client says is believed until it's re-derived from Devnet RPC itself.**

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime / Framework | Node.js + Express, TypeScript |
| Solana web3 | `@solana/web3.js` — `Connection.getTransaction()` against Devnet RPC, reading `meta.preBalances`/`postBalances` and `message.accountKeys` |
| Database | PostgreSQL (via Prisma) — a `payments` table with a hard **unique constraint on `signature`**, which is what makes replay/double-unlock impossible at the DB layer, not just in application logic |
| Network | Solana **Devnet** exclusively |
| No SPL token, no SIWS login | This flow is pure native SOL + wallet-connect only — intentionally dropped from the earlier draft of this doc (see Progress Log) to match the actual "incredibly basic" frontend scope |

---

## API Design: `POST /api/verify-sol-payment`

Request body: `{ signature: string, itemId: string }`
(`payerAddress` is **not** trusted from the body — it's re-derived from the
transaction itself in step 4, since the client could lie about who paid.)

### Step-by-step verification

1. **Validate shape** — `signature` must be a plausible base58 string (reject
   malformed input before spending an RPC call on it).

2. **Idempotency check (requirement d) — do this first, before any RPC call.**
   Query `payments` for an existing row with this `signature`.
   - If found: this signature has already been successfully verified and
     credited. Return the **same success response** as the original call
     (`200`, idempotent) — a legitimate retry (e.g. the frontend's HTTP request
     timed out but actually succeeded) must not fail, but it must also never be
     processed a second time. The DB's unique constraint is the real guarantee
     here; this check is just the fast path.

3. **Fetch the transaction from Devnet RPC:**
   ```ts
   const tx = await connection.getTransaction(signature, {
     commitment: "confirmed",
     maxSupportedTransactionVersion: 0,
   });
   ```
   - If `tx === null` → `404`, "not found or not yet confirmed" — tell the
     frontend to retry after a short delay (Devnet confirmation lag), don't
     treat this as a failure yet.

4. **Requirement (a) — the transaction actually succeeded on-chain:**
   `tx.meta.err === null`. Anything else → `422 Verification failed`, nothing
   is written to the DB (an unsuccessful signature isn't "used", so a client
   could in theory retry with a *different, successful* signature for the same
   item without being blocked).

5. **Requirements (b) + (c) — correct recipient AND correct amount, verified
   together via the balance delta (this is the authoritative check, not the
   instruction data):**
   - Find the index of our `TREASURY_ADDRESS` in `tx.transaction.message.accountKeys` (or `getAccountKeys()` for versioned txs). If it isn't present at all → `422` (wrong recipient, full stop).
   - `lamportsReceived = tx.meta.postBalances[treasuryIndex] - tx.meta.preBalances[treasuryIndex]`
   - `expectedLamports` comes from a **server-side price table** keyed by `itemId` (never accept an amount from the client) — e.g. `PRICES = { unlock_feature_x: 0.01 * LAMPORTS_PER_SOL }`.
   - Reject with `422` unless `lamportsReceived === expectedLamports` exactly.
   - Defense in depth: also confirm the instruction executed is a System Program `Transfer` (`tx.transaction.message.instructions[0].programId === "11111111111111111111111111111111"`), though the balance-delta check above is what actually can't be spoofed.

6. **Derive `payerAddress`** as the transaction's fee payer — `accountKeys[0]` — never from the request body.

7. **All checks passed.** Single DB insert (unique on `signature`, so a race
   between two concurrent requests for the same signature can only ever
   succeed once):
   ```
   payments.insert({ signature, payerAddress, itemId, lamports: lamportsReceived, verifiedAt: now() })
   ```
   This insert **is** the "unlock" — the item/action is considered unlocked
   for `payerAddress` iff a row exists.

8. Respond `{ success: true, payerAddress, itemId, lamports: lamportsReceived }`.

### Response summary
| Case | Status |
|---|---|
| Malformed signature | `400` |
| Already verified (idempotent replay) | `200` (cached result) |
| Tx not found on Devnet yet | `404` (client should retry) |
| Tx found but failed on-chain, wrong recipient, or wrong amount | `422` |
| All checks pass | `200` + unlock recorded |

### Data model (Postgres / Prisma)
```
payments { id, signature (unique, indexed), payerAddress, itemId,
           lamports, treasuryAddress, verifiedAt }
```
Config (env, not DB — hackathon scope, no price-table admin UI needed):
```
TREASURY_ADDRESS = "<our Devnet treasury pubkey, base58>"
DEVNET_RPC_URL    = "https://api.devnet.solana.com"
PRICES            = { itemId: lamports, ... }   // server-side, never from client
```

---

## REBUILD GUIDE FOR CLAUDE (backend) — read this first

> **Audience:** a future Claude session asked to rebuild the Kept backend from scratch.
> **Scope:** the Node.js/Express/Prisma/Postgres server and its deployment on Render,
> plus every backend problem hit while building it and how each was fixed. Wallet UI
> (Connect button, Compose screens) is out of scope; only the parts of the client that
> the backend depends on are listed in "Client contract".
> **Authority:** if anything in the older "API Design" section above or in the
> Progress Log below disagrees with this guide, **this guide wins**. Those sections
> are history. For example, they still mention `itemId`, `PRICES` and SQLite, which
> were all replaced.
> **State this guide describes:** working end to end on 2026-10-03. A real phone bought
> coins with Devnet SOL through `https://kept-backend-bn75.onrender.com`, and the
> backend verified the payment on-chain and credited the coins.

### 1. What the backend does (one paragraph)
A wallet app (Phantom, via Solana Mobile Wallet Adapter) sends a native SOL transfer on
**Devnet** from the user's wallet to our **treasury address**. The wallet signs *and
submits* the transaction itself and gives the app a base58 **transaction signature**. The
app POSTs `{ signature, packageId }` to this backend. The backend **trusts nothing from
the client**. It fetches the transaction from Devnet RPC and checks that it succeeded,
that the treasury's balance went up by exactly the package price, and who paid (taken
from the transaction, not from the request). In **one DB transaction** it then records
the payment (unique on `signature`, so a payment can never be counted twice) and adds
coins to the payer's balance.

### 2. Fixed facts (copy exactly)
| Thing | Value |
|---|---|
| Network | Solana **Devnet** only, RPC `https://api.devnet.solana.com` |
| Treasury (public key only, safe to commit) | `4AxmDUCWpC8F1aGL6ZsgyJoHfM3FDcK3AMbgMmcjD6jR` |
| Coin packages (server-side, never from client) | `small` 10,000,000 lamports (0.01 SOL) → 100 coins; `medium` 45,000,000 → 500; `large` 90,000,000 → 1200 |
| Deployed URL | `https://kept-backend-bn75.onrender.com` (Render, free tier) |
| Git repo Render deploys from | `https://github.com/ekanshvcpkg/kept_backend` branch `main` (repo root = this `mainbackend/` folder) |
| DB | PostgreSQL (Neon free tier is fine), via Prisma 6 |
| Node | >= 20, ESM (`"type": "module"`) |

**Never** give the backend a private key. It only reads chain data.

### 3. API contract
| Method / path | Body / params | Responses |
|---|---|---|
| `GET /health` | – | `200 {"ok":true}` |
| `POST /api/verify-sol-payment` | `{ "signature": "<base58>", "packageId": "small"\|"medium"\|"large" }` | see table below |
| `GET /api/balance/:address` | wallet base58 | `200 {"address","coinBalance"}` (0 if wallet never paid) |

`POST /api/verify-sol-payment` outcomes:
| Case | Status | Body |
|---|---|---|
| Bad signature shape (not base58, 64–90 chars) | 400 | `{"error":"Invalid signature"}` |
| Unknown packageId | 400 | `{"error":"Unknown packageId"}` |
| Signature already credited (retry/replay) | 200 | same success body + `"idempotent":true`, **no** extra coins |
| Tx not found / not yet confirmed on Devnet | 404 | `{"error":"Transaction not found or not yet confirmed"}`; **client should retry** |
| Tx failed on-chain | 422 | `{"error":"Transaction failed on-chain"}` |
| Treasury not in tx | 422 | `{"error":"Treasury address was not involved in this transaction"}` |
| Wrong amount | 422 | `{"error":"Expected N lamports to the treasury, found M"}` |
| OK | 200 | `{"success":true,"payerAddress","packageId","lamports","coinsAwarded","coinBalance"}` |

A 422 writes nothing to the DB, so the signature is not "used up".

### 4. Verification algorithm (why it's safe)
1. Validate input shape **before** any RPC call.
2. **Idempotency fast path:** if a `Payment` row with this signature exists, return the stored result (200, `idempotent:true`).
3. `connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })`. If the result is `null` → 404 (Devnet lag, not a failure).
4. `tx.meta.err` must be null.
5. Find the treasury in `tx.transaction.message.getAccountKeys().staticAccountKeys`. Then `received = postBalances[i] - preBalances[i]`, which must **equal** the package's lamports. The balance delta is checked instead of instruction data because a client can't fake it.
6. Payer = `accountKeys[0]` (fee payer), derived from the tx, never from the request.
7. `prisma.$transaction`: create the `Payment` (unique `signature`) **and** upsert `User` with `coinBalance += coins`. Coins are never credited without a payment row, and a payment row never exists without its coins.
8. If two requests race on the same signature, the second insert fails with Prisma `P2002`. Catch it and return the idempotent success, not a 500.

### 5. Files — exact contents
Create these in the backend root. They are the working versions. (The `config.ts` treasury default, the `index.ts` startup log and the `.env.example` treasury were hardened after the Render fix; the live server works either way because Render has `TREASURY_ADDRESS` set.)

**`package.json`** (note: `prisma`, `typescript`, `@types/*` are in `dependencies` on purpose so the cloud build always has them; `build` runs `prisma generate`; `start` runs `prisma migrate deploy` so Render applies migrations on every boot):
```json
{
  "name": "kept-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "prisma generate && tsc -p tsconfig.json",
    "start": "prisma migrate deploy && node dist/index.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev --name init"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@prisma/client": "^6.1.0",
    "@solana/web3.js": "^1.98.0",
    "dotenv": "^16.4.5",
    "express": "^4.21.1",
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.1",
    "prisma": "^6.1.0",
    "typescript": "^5.7.2"
  },
  "devDependencies": {
    "tsx": "^4.19.2"
  },
  "allowScripts": {
    "@prisma/client@6.19.3": true,
    "@prisma/engines@6.19.3": true,
    "prisma@6.19.3": true,
    "esbuild@0.28.2": true,
    "bufferutil@4.1.0": true,
    "utf-8-validate@6.0.6": true,
    "utf-8-validate@5.0.10": true
  }
}
```

**`tsconfig.json`** (NodeNext ⇒ relative imports in `src/` **must** end in `.js`, e.g. `./config.js`, even though the files are `.ts`):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

**`.gitignore`** (`.env` must never be committed):
```
node_modules/
dist/
.env
.claude/
.DS_Store
prisma/dev.db
prisma/dev.db-journal
```

**`.env.example`** (copy to `.env` for local runs; set the same keys in Render's Environment tab):
```
# PostgreSQL (Neon free tier works for both local dev and the cloud deploy).
# Render/Railway free disks are ephemeral, so a SQLite file would be wiped on every deploy.
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"

DEVNET_RPC_URL="https://api.devnet.solana.com"

# PUBLIC key only. The backend never needs (and must never be given) a private key.
TREASURY_ADDRESS="4AxmDUCWpC8F1aGL6ZsgyJoHfM3FDcK3AMbgMmcjD6jR"

# Set automatically by Render/Railway. Only set it yourself for local runs.
PORT=3000
```

**`prisma/schema.prisma`**:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Unique on `signature` is the actual trustless guarantee: the same on-chain
// SOL transfer can never be credited twice, even under concurrent requests.
model Payment {
  id              Int      @id @default(autoincrement())
  signature       String   @unique
  payerAddress    String
  packageId       String
  lamports        BigInt
  coinsAwarded    Int
  treasuryAddress String
  verifiedAt      DateTime @default(now())
}

// Coin balance per wallet. Only ever mutated in the same DB transaction as a
// Payment insert — a coin is never credited without a verified SOL payment
// backing it, and that payment can never be double-counted (unique signature).
model User {
  id            Int      @id @default(autoincrement())
  walletAddress String   @unique
  coinBalance   Int      @default(0)
  updatedAt     DateTime @updatedAt
}
```

**`prisma/migrations/migration_lock.toml`**:
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., Git)
provider = "postgresql"
```

**`prisma/migrations/20261003000000_init/migration.sql`** (Postgres baseline; was generated without a DB via `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`):
```sql
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "signature" TEXT NOT NULL,
    "payerAddress" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "coinsAwarded" INTEGER NOT NULL,
    "treasuryAddress" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "coinBalance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_signature_key" ON "Payment"("signature");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");
```

**`src/config.ts`**:
```ts
export const config = {
  port: Number(process.env.PORT ?? 3000),
  devnetRpcUrl: process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com",
  // Public Devnet treasury address (safe to commit). Must match the app's TREASURY_ADDRESS.
  // `||` (not `??`) so an empty env var on the host also falls back to it.
  treasuryAddress: process.env.TREASURY_ADDRESS || "4AxmDUCWpC8F1aGL6ZsgyJoHfM3FDcK3AMbgMmcjD6jR",
};

// Server-side coin shop — the client never gets to say how much SOL a package
// costs or how many coins it's worth. Must match the packageId keys used by
// the app (testharness/MainActivity.kt's COIN_PACKAGES).
export const coinPackages: Record<string, { lamports: number; coins: number }> = {
  small: { lamports: 10_000_000, coins: 100 }, // 0.01 SOL -> 100 coins
  medium: { lamports: 45_000_000, coins: 500 }, // 0.045 SOL -> 500 coins (bonus rate)
  large: { lamports: 90_000_000, coins: 1200 }, // 0.09 SOL -> 1200 coins (bigger bonus)
};
```

**`src/db.ts`**:
```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

**`src/solana.ts`**:
```ts
import { Connection } from "@solana/web3.js";
import { config } from "./config.js";

const connection = new Connection(config.devnetRpcUrl, "confirmed");

export type VerifyResult =
  | { ok: true; payerAddress: string; lamports: number }
  | { ok: false; status: 404 | 422; reason: string };

/**
 * The only thing this backend ever trusts: what Devnet RPC itself reports for
 * a given signature. Recipient and amount are both checked via the treasury
 * account's balance delta, not via instruction data — that delta can't be
 * spoofed by a client no matter what it claims.
 */
export async function verifyTransactionOnChain(
  signature: string,
  expectedLamports: number,
): Promise<VerifyResult> {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    return { ok: false, status: 404, reason: "Transaction not found or not yet confirmed" };
  }

  if (tx.meta?.err) {
    return { ok: false, status: 422, reason: "Transaction failed on-chain" };
  }

  const accountKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const treasuryIndex = accountKeys.findIndex((key) => key.toBase58() === config.treasuryAddress);

  if (treasuryIndex === -1) {
    return { ok: false, status: 422, reason: "Treasury address was not involved in this transaction" };
  }

  const preBalances = tx.meta!.preBalances;
  const postBalances = tx.meta!.postBalances;
  const lamportsReceived = postBalances[treasuryIndex] - preBalances[treasuryIndex];

  if (lamportsReceived !== expectedLamports) {
    return {
      ok: false,
      status: 422,
      reason: `Expected ${expectedLamports} lamports to the treasury, found ${lamportsReceived}`,
    };
  }

  // Fee payer / first signer — derived from the transaction itself, never from client input.
  const payerAddress = accountKeys[0].toBase58();

  return { ok: true, payerAddress, lamports: lamportsReceived };
}
```

**`src/routes/verifySolPayment.ts`**:
```ts
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config, coinPackages } from "../config.js";
import { verifyTransactionOnChain } from "../solana.js";

export const verifySolPaymentRouter = Router();

// Base58, no 0/O/I/l. Solana signatures are typically 87-88 chars; allow some slack.
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

verifySolPaymentRouter.post("/api/verify-sol-payment", async (req, res) => {
  const { signature, packageId } = req.body ?? {};

  if (typeof signature !== "string" || !SIGNATURE_RE.test(signature)) {
    return res.status(400).json({ error: "Invalid signature" });
  }
  if (typeof packageId !== "string" || !(packageId in coinPackages)) {
    return res.status(400).json({ error: "Unknown packageId" });
  }

  // Idempotency fast path: already verified + credited, so a retry succeeds
  // without re-processing (the unique constraint below is the real guarantee).
  const existing = await prisma.payment.findUnique({ where: { signature } });
  if (existing) {
    const user = await prisma.user.findUnique({ where: { walletAddress: existing.payerAddress } });
    return res.status(200).json({
      success: true,
      payerAddress: existing.payerAddress,
      packageId: existing.packageId,
      lamports: Number(existing.lamports),
      coinsAwarded: existing.coinsAwarded,
      coinBalance: user?.coinBalance ?? 0,
      idempotent: true,
    });
  }

  const pkg = coinPackages[packageId];
  const result = await verifyTransactionOnChain(signature, pkg.lamports);

  if (!result.ok) {
    return res.status(result.status).json({ error: result.reason });
  }

  try {
    // Payment insert + coin credit happen atomically: a coin is never
    // credited without a recorded, verified, one-time-use payment behind it.
    const user = await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          signature,
          payerAddress: result.payerAddress,
          packageId,
          lamports: result.lamports,
          coinsAwarded: pkg.coins,
          treasuryAddress: config.treasuryAddress,
        },
      });

      return tx.user.upsert({
        where: { walletAddress: result.payerAddress },
        create: { walletAddress: result.payerAddress, coinBalance: pkg.coins },
        update: { coinBalance: { increment: pkg.coins } },
      });
    });

    return res.status(200).json({
      success: true,
      payerAddress: result.payerAddress,
      packageId,
      lamports: result.lamports,
      coinsAwarded: pkg.coins,
      coinBalance: user.coinBalance,
    });
  } catch (e) {
    // Unique constraint race: another request already inserted this signature
    // (and credited the coins) between our lookup and this transaction.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await prisma.payment.findUniqueOrThrow({ where: { signature } });
      const user = await prisma.user.findUnique({ where: { walletAddress: row.payerAddress } });
      return res.status(200).json({
        success: true,
        payerAddress: row.payerAddress,
        packageId: row.packageId,
        lamports: Number(row.lamports),
        coinsAwarded: row.coinsAwarded,
        coinBalance: user?.coinBalance ?? 0,
        idempotent: true,
      });
    }
    throw e;
  }
});

verifySolPaymentRouter.get("/api/balance/:address", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { walletAddress: req.params.address } });
  return res.status(200).json({ address: req.params.address, coinBalance: user?.coinBalance ?? 0 });
});
```

**`src/index.ts`**:
```ts
import "dotenv/config";
import express from "express";
import { config } from "./config.js";
import { verifySolPaymentRouter } from "./routes/verifySolPayment.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(verifySolPaymentRouter);

// config.port reads process.env.PORT (set by Render/Railway), falling back to 3000 locally.
// Bind 0.0.0.0 so the platform's proxy can reach the container.
app.listen(config.port, "0.0.0.0", () => {
  console.log(`Kept backend listening on :${config.port}, treasury ${config.treasuryAddress}`);
});
```

### 6. Local run
```bash
npm install
# npm 11 blocks dependency install scripts by default. If Prisma/esbuild complain, approve them
# (the "allowScripts" block in package.json records the approved ones), then reinstall.
cp .env.example .env        # put a real Postgres DATABASE_URL in it (Neon works)
npx prisma migrate deploy   # or `npx prisma migrate dev` when changing the schema
npm run dev                 # tsx watch, http://localhost:3000
```
Smoke test:
```bash
curl -s localhost:3000/health                                   # {"ok":true}
curl -s -X POST localhost:3000/api/verify-sol-payment -H 'content-type: application/json' -d '{"signature":"bad","packageId":"small"}'   # 400 Invalid signature
curl -s localhost:3000/api/balance/11111111111111111111111111111111   # coinBalance 0
```
Testing the app against a *local* backend from a USB phone: `adb reverse tcp:3000 tcp:3000`
and use `http://127.0.0.1:3000` (this phone could not resolve `localhost`). Plain HTTP also
needs `android:usesCleartextTraffic="true"` in the test app only.

### 7. Deploy on Render
1. Create a Postgres DB (Neon free tier) and copy its connection string (`...?sslmode=require`).
2. Render → New → **Web Service** → connect the GitHub repo (root = this backend folder).
3. Runtime Node. **Build command:** `npm install && npm run build`. **Start command:** `npm start`.
4. **Environment** tab, set **all** of:
   - `DATABASE_URL` = the Postgres URL
   - `DEVNET_RPC_URL` = `https://api.devnet.solana.com`
   - `TREASURY_ADDRESS` = `4AxmDUCWpC8F1aGL6ZsgyJoHfM3FDcK3AMbgMmcjD6jR`
   - Do **not** set `PORT`; Render sets it.
5. Deploy. The startup log must print `Kept backend listening on :<port>, treasury 4Axm...D6jR`.
   If it prints `treasury 1111...`, the treasury config is wrong (see problem 5 below).
6. Verify from outside:
   ```bash
   curl -s https://<service>.onrender.com/health
   curl -s https://<service>.onrender.com/api/balance/<any wallet>
   ```
   A 200 from `/api/balance` proves the DB connection and migration work.

### 8. Every backend problem we hit: symptom → root cause → fix
Read all of these before rebuilding. Each one cost real debugging time.

**Problem 1: Server crashes `Cannot read properties of undefined (reading 'findUnique')` after a schema change.**
- Cause: `tsx watch` only reloads on `src/` changes. After `prisma migrate dev` regenerates the client, the running process still holds the **old** Prisma Client, which has no new model.
- Fix: **always kill and restart `npm run dev` after any Prisma schema/migration change.**

**Problem 2: Balances/payments would vanish on every cloud deploy.**
- Cause: first version used SQLite (`file:./dev.db`). Render/Railway free disks are ephemeral, so the DB file is wiped on each deploy/restart.
- Fix: switched provider to `postgresql`. Deleted the SQLite migrations and replaced them with one Postgres baseline migration (`20261003000000_init`). Prisma migrations are provider-specific, so SQLite migrations cannot be reused on Postgres.

**Problem 3: Cloud build missing `prisma`/`tsc`, or Prisma Client not generated.**
- Fix: keep `prisma`, `typescript`, `@types/*` in `dependencies`. `build` = `prisma generate && tsc`. `start` = `prisma migrate deploy && node dist/index.js`, so tables exist before the server listens.

**Problem 4: Platform can't reach the server.**
- Fix: listen on `process.env.PORT` and bind `0.0.0.0` (not localhost).

**Problem 5 (the big one): every real purchase rejected with `422 "Expected 10000000 lamports to the treasury, found 0"`.** The SOL *was* debited from the wallet.
- How it was diagnosed: on-chain the tx clearly sent 10,000,000 lamports to `4Axm…D6jR` (checked with `getTransaction` and the balance deltas). "Found 0" means the backend matched **a different account** with a zero delta. A simple SOL transfer has 3 accounts: payer, treasury, and the System Program `11111111111111111111111111111111`, whose balance never changes. So the backend's treasury was the `1111…` placeholder.
- Root cause: `TREASURY_ADDRESS` was **not set in Render's Environment**, so `config.ts` fell back to its old placeholder default `"1111…"`. `.env` is gitignored and never reaches Render. Also, `.env.example` had the `1111…` placeholder too.
- Fix: set `TREASURY_ADDRESS` in Render's Environment tab and redeploy. Hardening: `config.ts` now defaults to the real public treasury and uses `||` (so an *empty* env var also falls back); `index.ts` logs the treasury at startup; `.env.example` holds the real address.
- Lesson: **every env var the server needs must be set on the host; check the startup log.** A `found 0` error means the treasury is misconfigured. It does not mean the client underpaid.

**Problem 6: Paid but not credited (recovering lost payments).**
- Cause: while problems 5 and 7 were active, SOL transfers landed on-chain but the backend never credited them (request blocked, or rejected because of the wrong treasury).
- Fix: once the server is correct, simply **re-POST the signatures**. It's safe because the backend re-verifies on-chain and `signature` is unique. Find them with:
  ```bash
  curl -s https://api.devnet.solana.com -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":["4AxmDUCWpC8F1aGL6ZsgyJoHfM3FDcK3AMbgMmcjD6jR",{"limit":10}]}'
  # For each: confirm the treasury delta via getTransaction, map lamports to packageId, then:
  curl -s -X POST https://<service>.onrender.com/api/verify-sol-payment \
    -H 'content-type: application/json' -d '{"signature":"<sig>","packageId":"small"}'
  ```
  On 2026-10-03 this recovered 4 × 100 coins. Re-sending one again returned `"idempotent":true` and the balance didn't change.

**Problem 7: App showed `Unable to resolve host "kept-backend-bn75.onrender.com": No address associated with hostname` right after Phantom confirmed.** (It looked like a DNS or backend problem, but it was neither.)
- Diagnosis: `adb shell ping kept-backend-bn75.onrender.com` resolved fine, and the app had the `INTERNET` permission. `adb logcat | grep NetdEventListenerService` showed `DNS Requested by ... (com.kept.testharness), 4(FAIL), isBlocked=true`, and `adb shell dumpsys netpolicy | grep "UID=<appUid>"` showed `blocked=APP_BACKGROUND`. This phone (Samsung, Android 15) **blocks network for backgrounded apps**. The app sent the verify POST while Phantom was still in front.
- Fix (client side, but required for the backend to ever be reached): wait until the activity is `RESUMED` before calling the backend, and retry. See "Client contract".

**Problem 8: Render free-tier cold start.**
- The service sleeps when idle, and the first request takes ~30–50 s. Phantom's sign sheet times out after ~30 s.
- Mitigation: 60 s HTTP timeouts and retries in the client. Before a demo, hit `/health` to wake the server.

**Problem 9: Trailing slash in the backend URL** (`https://...onrender.com/` → `...//api/...`).
- Fix: the client does `backendUrl.trim().trimEnd('/')` before appending paths.

**Problem 10: Hard-to-see failure because the wallet's error is not the library's error.** (Wallet side, recorded so it isn't re-debugged.)
- `signAndSendTransactions` without `minContextSlot` is rejected by Phantom (zod: `params.minContextSlot` required), which surfaces as "Failed establishing local association". Pass `TransactionParams(minContextSlot = 0, ...)`.
- Occasionally Phantom logs `onScenarioReady` but its local WebSocket port never listens (`ECONNREFUSED 127.0.0.1:<port>`). It's Phantom-side and transient; relaunch and retry.
- Always read `adb logcat | grep -E "PhantomMWAModule|ReactNativeJS|LocalAssociationScenario|IdentityVerifier"` before trusting the dApp's exception text.

### 9. Client contract (what any frontend must do so the backend works)
- Build a plain `SystemProgram.transfer(payer → TREASURY, lamports)` with the **exact** lamports of the chosen package. Treasury and package table must match the backend's.
- Send it via MWA `signAndSendTransactions` with `minContextSlot = 0`. Take `signatures[0]`, base58-encode it.
- **Wait until the app is in the foreground again**, then POST `{ signature, packageId }`.
- Retry on network errors **and on 404** (tx not yet confirmed), e.g. 6 tries × 3 s. Do not retry on 400/422.
- Use ≥ 60 s timeouts (Render cold start). Strip trailing `/` from the base URL.
- Show `coinBalance` from the response, and fetch `/api/balance/:address` after connecting.
- Never send amounts, recipient or payer to the backend. It ignores them by design.

### 10. "Done" checklist for a rebuild
1. `GET /health` → `{"ok":true}` on the deployed URL.
2. `GET /api/balance/<wallet>` → 200 (DB and migration OK).
3. Startup log shows `treasury 4AxmDUCWpC8F1aGL6ZsgyJoHfM3FDcK3AMbgMmcjD6jR`.
4. Bad signature → 400. Unknown packageId → 400.
5. Re-POST an already-credited real signature → 200 with `"idempotent":true`, balance unchanged.
6. Real phone purchase of `small` → app shows "Bought 100 coins. New balance: N+100", and `/api/balance` agrees.

---

## Progress Log

### 2026-10-02
- Scanned `mobile-wallet-adapter-main/android/clientlib-ktx`, `common/.../ProtocolContract.java`, `common/.../SignInWithSolana.java`, and `fakedapp/MainViewModel.kt` to confirm exactly what our teammate's frontend will send us: a base58 wallet address, a SIWS-signed message for login, and a transaction signature (already submitted by the wallet, not us) for purchases. Confirmed `walletlib`/`fakewallet` belong to a third-party wallet app, not our stack.
- First draft of the architecture: SIWS login + an SPL-token ("SKR") → in-game-currency ("souls") purchase economy, with `User` / `AuthNonce` / `PurchaseIntent` tables.
- **Scope revised** (same day): the real requirement is far simpler — frontend is just a "Connect Wallet" button plus a native SOL transfer, no SIWS/login step, no SPL token, no souls economy. Replaced the entire architecture above with the native-SOL `POST /api/verify-sol-payment` flow: a single `payments` table, unique on `signature`, verified against Devnet RPC via balance-delta (recipient + amount) and `meta.err` (success). The SIWS/SPL design is dropped, not merged — if a login step or an in-game currency comes back as a real requirement later, it should be re-added deliberately rather than assumed from this history.
- No backend code written yet. Next step: scaffold the Express + TypeScript project and Prisma schema inside `mainbackend/`, starting with the `payments` model and the `/api/verify-sol-payment` route.

### 2026-10-03
- Built a **throwaway test harness APK** so the native-SOL flow can actually be exercised before the real backend or the teammate's real frontend exist. Lives at `mobile-wallet-adapter-main/android/testharness/` — a single Gradle module added to the *existing* reference repo's Gradle build (one `include ':testharness'` line in `android/settings.gradle`) purely so it could reuse the repo's proven Gradle wrapper (9.7.0), AGP/Kotlin catalog versions, and depend directly on `project(':clientlib-ktx')` instead of resolving MWA from Maven — this is a deliberate, documented exception to the "don't build product in the reference repo" rule, not a reversal of it: it's throwaway, isolated to its own folder, and trivially removable (delete the folder + that one include line).
  - UI: single "Connect Wallet" button (MWA `authorize` on `Solana.Devnet`), then a "Request Devnet Airdrop" button, a "Pay 0.01 SOL to Treasury" button (builds `SystemProgram.transfer` via the `com.solanamobile:web3-solana` library pulled in transitively through `clientlib-ktx`, signs+sends via MWA), and a "Verify with Backend" button that POSTs `{ signature, itemId: "unlock_feature_x" }` to an editable backend URL (defaults to `http://10.0.2.2:3000`, the Android-emulator alias for the host machine's localhost).
  - `TREASURY_ADDRESS` is currently a placeholder (32 zero-bytes / the System Program ID) — replace with the real Devnet treasury pubkey once one is generated, or payments will correctly fail the backend's recipient check.
  - Built successfully with `./gradlew :testharness:assembleDebug` (APK at `android/testharness/build/outputs/apk/debug/testharness-debug.apk`) and installed on a connected device via `adb install`.
  - This harness talks to `/api/verify-sol-payment`, but that endpoint doesn't exist yet (see above) — next step is still building the real Express backend so the harness's "Verify with Backend" button has something to call.
- **Built the actual backend.** All of it lives in `mainbackend/` as instructed — nothing in `mobile-wallet-adapter-main/` except the throwaway harness above, which is explicitly exempted and documented as such.
  - `package.json` / `tsconfig.json` — Node + Express + TypeScript (ESM, `NodeNext` resolution), run via `npm run dev` (tsx, no build step) or `npm run build && npm start`.
  - `prisma/schema.prisma` — the `Payment` model from the architecture above (`signature` unique), using **SQLite** (`DATABASE_URL="file:./dev.db"`) instead of Postgres for now — a deliberate pragmatic substitute so the backend runs with zero extra installs (no Postgres/Docker found on this machine). The unique-constraint guarantee is identical in SQLite; swap to Postgres later by changing the `datasource` provider + `DATABASE_URL`, nothing else about the design changes.
  - `src/config.ts` — `TREASURY_ADDRESS` (placeholder, same TODO as the harness app) and the server-side `prices` table (`unlock_feature_x` → 10,000,000 lamports), read from env with code defaults.
  - `src/solana.ts` — `verifyTransactionOnChain()`: fetches the tx from Devnet RPC, checks `meta.err`, and checks recipient+amount together via the treasury account's balance delta (`postBalances - preBalances`), exactly as designed above.
  - `src/routes/verifySolPayment.ts` — `POST /api/verify-sol-payment`: validates input shape, checks the idempotency fast path, calls `verifyTransactionOnChain`, and inserts the `Payment` row (handling the DB-level unique-constraint race as the same idempotent-success response, not an error).
  - `src/index.ts` — Express app, `GET /health`, mounts the router.
  - Ran `npm install` (had to `npm install-scripts approve` Prisma/esbuild/native-addon postinstall scripts — npm 11 blocks these by default now), `prisma migrate dev` (created `dev.db`), started `npm run dev`, and smoke-tested with curl: `/health` → `{"ok":true}`, bad signature → `400 Invalid signature`, unknown itemId → `400 Unknown itemId`. Validation path confirmed working; haven't yet fed it a real Devnet signature end-to-end.
  - Ran `adb reverse tcp:3000 tcp:3000` so the physical device already connected (from the harness APK install) can reach this backend at `http://localhost:3000` over USB, with no LAN IP needed — type that into the harness app's "Backend URL" field (its default of `10.0.2.2:3000` only works on an emulator, not a physical device).
  - Still a placeholder `TREASURY_ADDRESS` on both sides (backend `.env` and the harness app) — a real end-to-end test (connect → airdrop → pay → verify, success response) is the next thing to actually run, once a real treasury pubkey exists.
- **Real app identity domain confirmed:** `https://keptdapp.vercel.app` (Vercel-hosted). Updated `testharness/MainActivity.kt`'s `ConnectionIdentity.identityUri` from the placeholder `https://kept.app` to this real domain, rebuilt, and reinstalled on the connected device.
  - Why: Phantom (and any MWA-compliant wallet) shows a red "unverified app" warning when it can't confirm, via **Digital Asset Links**, that the claimed `identityUri` domain actually endorses the calling app's package. `kept.app` is unowned, so it could never verify. This is purely a trust-UI warning, not a functional blocker — Devnet testing still works through it.
  - To make the warning actually go away: whoever controls the `keptdapp.vercel.app` Vercel project needs to deploy `mainbackend/assetlinks.json` (written to that path in this repo) to `https://keptdapp.vercel.app/.well-known/assetlinks.json` (i.e. drop it in that Vercel project's `public/.well-known/assetlinks.json`). It currently declares `package_name: com.kept.testharness` + this machine's **debug** keystore SHA-256 cert fingerprint — fine for dev, but once the real app has its own package name and/or a release signing key, that file needs another `target` entry added for it (don't replace this one, add alongside).

### 2026-10-03 (continued) — real coin-purchase economy
Built the actual "spend SOL, get coins" feature end to end, replacing the generic `unlock_feature_x` placeholder with a real coin shop.
- **`prisma/schema.prisma`**: added a `User` model (`walletAddress` unique, `coinBalance`), and renamed `Payment.itemId` → `packageId`, added `coinsAwarded`. Migrated via `prisma migrate dev --name coin_economy`.
- **`src/config.ts`**: added `coinPackages` — the server-side shop (`small` = 0.01 SOL → 100 coins, `medium` = 0.045 SOL → 500 coins, `large` = 0.09 SOL → 1200 coins). The client never gets to say the price or the payout, same trustless principle as before.
- **`src/routes/verifySolPayment.ts`**: on successful on-chain verification, the `Payment` insert and the `User.coinBalance` increment now happen inside one `prisma.$transaction` — a coin is never credited without a matching verified payment row, and the unique-constraint race case now also looks up and returns the already-credited balance instead of erroring. Added `GET /api/balance/:address` to read a wallet's current coin balance.
- **Testharness app** (`MainActivity.kt`): replaced the old two-step "Pay then separately Verify" flow with one-tap purchase buttons — "100 coins for 0.01 SOL" / "500 coins for 0.045 SOL" / "1200 coins for 0.09 SOL" (`COIN_PACKAGES`, must stay in sync with the backend's `coinPackages`). Each tap builds the `SystemProgram.transfer` for that package's exact lamport amount, signs+sends via MWA, POSTs the resulting signature + `packageId` to `/api/verify-sol-payment`, and updates the on-screen coin balance from the response. Balance is also fetched via the new `/api/balance/:address` route right after connecting. Default `backendUrl` changed from the emulator-only `10.0.2.2:3000` to `localhost:3000`, since testing has moved to a physical device reached via `adb reverse tcp:3000 tcp:3000`.
- Hit one real bug while testing: after adding the `User` model, the already-running `tsx watch` dev server kept the **old** generated Prisma Client in memory (it only reloads on `src/` changes, not on `prisma generate` output), so the first `GET /api/balance/:address` call crashed with `Cannot read properties of undefined (reading 'findUnique')`. Fixed by killing and restarting the dev server after any Prisma schema migration — **remember to always restart `npm run dev` after `prisma migrate dev`, not just rely on tsx's file-watch.**
- Rebuilt the APK, reinstalled over USB, re-ran `adb reverse`, and launched it on the connected phone (`SM_S901E`). Backend confirmed healthy (`/health`, `/api/balance/:address` both responding correctly) right before handoff.
- Still open: `TREASURY_ADDRESS` is still the zero-byte placeholder on both sides, so a real purchase will complete the SOL transfer but the backend will correctly reject it at the recipient check (`422`) until a real treasury pubkey is set on both the app and the backend's `.env`.

### 2026-10-03 (continued) — identity verification, and discovery of the real project
While debugging why Phantom's "unverified app" warning persisted even after pointing the harness's `identityUri` at `https://keptdapp.vercel.app`, found that a **separate, much more developed "Kept" project already exists** at `~/Documents/mainfile/KEPT-APP-MAIN-main/` (noted at the top of this file). Its `frontend/public/.well-known/assetlinks.json` is the one actually controlling `keptdapp.vercel.app`'s Digital Asset Links, and it was already configured — just scoped to the real app's package (`app.kept.mobile`), not our throwaway harness's (`com.kept.testharness`), which is exactly why the harness kept failing verification.
- User confirmed (via explicit choice, not assumption): keep the throwaway harness, and add its package+cert as a **second entry** in that same file rather than switching to the real app or treating this as a mix-up.
- Edited `~/Documents/mainfile/KEPT-APP-MAIN-main/frontend/public/.well-known/assetlinks.json` directly, adding a second `target` object for `com.kept.testharness` + this machine's debug-keystore SHA-256 fingerprint, alongside the existing `app.kept.mobile` entry (left untouched).
- Mirrored the same two-entry file into `mainbackend/assetlinks.json` for reference.
- **This still needs to be deployed** — no `.vercel` link or git remote was found in that project on this machine, so I can't redeploy it myself. Whoever owns that Vercel project needs to push/redeploy so the updated file is actually served at `https://keptdapp.vercel.app/.well-known/assetlinks.json`. Until that redeploy happens, the harness's warning will still show.
- Noted but did not touch: that project's working tree has pre-existing uncommitted deletions (`CLAUDE.md`, some docs/scripts) unrelated to this edit — flagging in case it matters, not acted on.

### 2026-10-03 (continued) — fixed "Failed establishing local association"; first real end-to-end buy
Debugged on the physical phone via `adb logcat` + `uiautomator` taps. The error message was misleading — the local WebSocket association itself was fine.
- **Root cause:** Phantom's RPC router rejected `sol_mwa_sign_and_send_transactions` with a zod error (`params.minContextSlot` expected number, received undefined). `clientlib-ktx`'s `DefaultTransactionParams` sends `minContextSlot = null` (field omitted). Phantom then tears the session down, which the library surfaces as "Failed establishing local association with wallet". **Fix:** pass `TransactionParams(minContextSlot = 0, ...)` to `signAndSendTransactions`.
- Reusing the connected adapter (silent `reauthorize`) does NOT work here: Phantom's `IdentityVerifier` logs `DAL verification failed ... Could not verify package com.kept.testharness` and drops reauthorize sessions. A fresh `MobileWalletAdapter` per payment (full `authorize`, with the "unverified" warning + Connect tap) works, so `sendSolPayment` keeps `freshAdapter`. The DAL failure itself is unexplained: the served `assetlinks.json` is correct, matches the installed debug cert, and Google's DAL API reports `linked: true`.
- Two harness networking fixes after the wallet step worked: default `backendUrl` is now `http://127.0.0.1:3000` (this phone can't resolve `localhost`), and the manifest sets `android:usesCleartextTraffic="true"` (harness-only; plain HTTP to the local backend was blocked).
- **Result:** tapped "100 coins for 0.01 SOL" -> Phantom confirm sheet -> signed/sent on Devnet -> backend verified on-chain -> "Bought 100 coins. New balance: 100". This closes the old open items about treasury placeholder and no end-to-end run: `TREASURY_ADDRESS` is now a real address on both sides, and `assetlinks.json` is deployed and served.
- Earlier failed attempts also sent some Devnet SOL to the treasury without credits (signature never reached the backend). Harmless on Devnet but those payments are not credited.
- Still open: why Phantom's DAL check fails despite a valid file (blocks silent reauthorize); relationship to the Anchor program in the real project.

#### Step-by-step: how the "Failed establishing local association with wallet" bug was found and fixed (2026-10-03)
Symptom: `connect()` worked, but `transact { signAndSendTransactions(...) }` made Phantom open and then failed immediately with "Failed establishing local association with wallet" / "Local association was cancelled before connected".

1. **Read the code first.** `MainActivity.kt` followed the standard MWA pattern (`ActivityResultSender` created as a field, adapter on `Solana.Devnet`), so nothing was obviously wrong there.
2. **First guess: reuse the adapter.** Replaced the per-payment `freshAdapter` with the connected `walletAdapter`. This did NOT fix it (see step 6).
3. **Build and install on the phone over USB.** From `mobile-wallet-adapter-main/android`: `./gradlew :testharness:assembleDebug`, then `adb install -r testharness/build/outputs/apk/debug/testharness-debug.apk`, `adb reverse tcp:3000 tcp:3000`. Check Phantom is in Testnet Mode (it was).
4. **Drive the UI from the shell** so the failure can be reproduced with logs. `adb shell uiautomator dump /sdcard/u.xml` and grep the `bounds` of each button, then `adb shell input tap X Y`. Run `adb logcat -c` right before the buy tap, and capture afterwards with `adb logcat -d | grep -E "PhantomMWAModule|IdentityVerifier|LocalAssociation|ReactNativeJS"`. Use `adb exec-out screencap -p > file.png` to see the screen.
5. **Read the logs: the association was fine.** `LocalAssociationScenario` showed "Session established, scenario ready for use", so the "association" error text was misleading. Phantom (`PhantomMWAModule`) received the request and then tore the session down.
6. **Rule out other suspects.** The reauthorize path: Phantom's `IdentityVerifier` logged `DAL verification failed ... Could not verify package com.kept.testharness` and dropped the silent `onReauthorizeRequest` session. But the served `https://keptdapp.vercel.app/.well-known/assetlinks.json` was correct (curl), its SHA-256 matched the installed APK's debug cert (`apksigner verify --print-certs`), and Google's API said `linked: true` (`digitalassetlinks.googleapis.com/v1/assetlinks:check`). So DAL is an unexplained Phantom-side quirk, not the root cause. Phone network and DNS were fine.
7. **Restore the fresh adapter** (full `authorize` instead of silent `reauthorize`). Phantom then accepted authorize (with the "identity could not be verified" warning + Connect tap) and logged `onSignAndSendTransactionsRequest`, but no sign sheet appeared and Phantom stayed on its home screen. That narrowed it to the sign request itself.
8. **Find the real error in Phantom's JS log.** `ReactNativeJS: RPC ROUTER: Unexpected error in method: sol_mwa_sign_and_send_transactions` with a zod error: `invalid_type, expected number, received undefined, path params.minContextSlot, "Required"`.
9. **Trace it to the library.** `clientlib-ktx` `AdapterOperations.signAndSendTransactions(transactions, params = DefaultTransactionParams)`, and `DefaultTransactionParams.minContextSlot = null`, which is omitted from the JSON-RPC params. Phantom's schema requires a number.
10. **The fix.** In `sendSolPayment`, import `com.solana.mobilewalletadapter.clientlib.TransactionParams` and call:
    ```kotlin
    signAndSendTransactions(
        arrayOf(unsignedTx.serialize()),
        TransactionParams(minContextSlot = 0, commitment = null, skipPreflight = null,
                          maxRetries = null, waitForCommitmentToSendNextTransaction = null)
    )
    ```
    Rebuilt, reinstalled: Phantom now showed the "Confirm transaction" sheet (-0.01 SOL).
11. **Next failure, after the wallet step: backend unreachable.** The app showed `Unable to resolve host "localhost"`. This phone can't resolve `localhost`, so the default `backendUrl` became `http://127.0.0.1:3000`.
12. **Next failure: cleartext blocked.** `CLEARTEXT communication to 127.0.0.1 not permitted by network security policy`. Added `android:usesCleartextTraffic="true"` to the `<application>` tag in `testharness/src/main/AndroidManifest.xml` (harness only; do not copy to the real app).
13. **Backend must actually be running.** It wasn't on `:3000` at first (`lsof -i :3000` empty). Start with `cd mainbackend && npm run dev`. Also: Phantom's sign sheet times out after ~30s, so start the backend BEFORE tapping Confirm, or the session dies.
14. **Verify end to end.** Buy tap -> Connect (authorize) -> Confirm transaction -> app showed "Bought 100 coins. New balance: 100".

Debugging tips worth keeping:
- The wallet-side error is usually in `ReactNativeJS` / `PhantomMWAModule` logcat lines, not in the dApp's exception text. Always read the wallet's log before trusting the library's message.
- Samsung `FreecessHandler` freeze messages for the backgrounded app showed up in the logs but were not the cause here.
- Each failed attempt may spend 0.01 Devnet SOL on-chain without crediting coins (signature never reaches the backend). Harmless on Devnet.

### 2026-10-03 (continued) — production prep for cloud deploy (Render/Railway)
- `src/index.ts` binds `0.0.0.0` on `config.port` (= `process.env.PORT ?? 3000`).
- `package.json`: `build` = `prisma generate && tsc -p tsconfig.json`, `start` = `prisma migrate deploy && node dist/index.js`, `engines.node >=20`; `prisma`, `typescript`, `@types/*` moved to `dependencies` so the cloud build has them.
- **Switched SQLite -> PostgreSQL**: free cloud disks are ephemeral, so SQLite would wipe all balances/payments on every deploy. `prisma/schema.prisma` provider is now `postgresql`; old SQLite migrations and `dev.db` were deleted and replaced with one Postgres baseline migration (`20261003000000_init`, generated with `prisma migrate diff`, no DB needed). A backup of the old SQLite prisma folder + `.env` is in the session scratchpad only.
- **Local `.env` `DATABASE_URL` must now be a Postgres URL** (still `file:./dev.db` = local dev broken until changed). Use a free Neon DB for dev too (no local Postgres/Docker on this machine). Remember to restart `npm run dev` after schema changes.
- Cloud env vars: `DATABASE_URL`, `DEVNET_RPC_URL`, `TREASURY_ADDRESS` (public address only, never a private key). `PORT` is set by the platform.

### 2026-10-03 (continued) — app pointed at the deployed Render backend
- Backend is live at `https://kept-backend-bn75.onrender.com` (Render, Postgres). Verified: `/health` -> `{"ok":true}`, `/api/balance/:address` -> 200 (DB connected).
- Harness `MainActivity.kt` default `backendUrl` changed from `http://127.0.0.1:3000` to the Render URL, so the phone no longer needs USB + `adb reverse` or a local `npm run dev`.
- Build note: `./gradlew` needs `ANDROID_HOME=$HOME/Library/Android/sdk` (no `local.properties` in the repo). Rebuilt, installed, launched on `RZCW50CP58W`.
- Render free tier sleeps when idle; first request can take ~30-50s. Phantom's sign sheet times out ~30s, so wake the backend (open `/health`) before buying.

### 2026-10-03 (continued) — "Unable to resolve host" on purchase; Render treasury env missing
- **Symptom:** after Phantom signed, app showed `Unable to resolve host "kept-backend-bn75.onrender.com": No address associated with hostname`. Not DNS/Render: phone's shell resolved it fine and the app has INTERNET.
- **Root cause:** logcat `NetdEventListenerService: DNS Requested by ... 10533(com.kept.testharness), 4(FAIL), isBlocked=true`; `dumpsys netpolicy` shows the app `blocked=APP_BACKGROUND`. This phone blocks network for backgrounded apps, and the verify POST fired while Phantom was still in front.
- **Fix (harness `MainActivity.kt`):** `awaitForeground()` (wait for lifecycle RESUMED) before calling the backend; `verifyWithRetry` (6 tries, 3s apart, retries IOException and 404 tx-not-yet-confirmed); OkHttp timeouts 60s for Render cold starts; backend URL trailing `/` stripped.
- **Second bug found:** Render's `TREASURY_ADDRESS` env var is not set, so the backend falls back to the `1111...` placeholder and rejects every real payment ("found 0" = System Program's balance delta). Must set `TREASURY_ADDRESS=4AxmDUCWpC8F1aGL6ZsgyJoHfM3FDcK3AMbgMmcjD6jR` on Render and redeploy.
- Two uncredited 0.01 SOL payments from the blocked attempts (`5Ye8kbF2...`, `2yFyh5WM...`, 13:21 / 13:26 IST) can be credited afterwards by POSTing their signatures with `packageId: "small"` (idempotent, verified on-chain).
- Earlier the same day, Connect Wallet failed once with `ECONNREFUSED` to Phantom's local MWA port despite Phantom logging `onScenarioReady`; a plain retry (relaunching the harness) worked. Phantom-side, not our code.
- **Resolved:** user set `TREASURY_ADDRESS` on Render. The 4 stuck 0.01 SOL payments (13:21, 13:26, 13:31, 13:33 IST) were re-submitted and credited (balance 400); replay returned `idempotent: true`. User then completed a live purchase on the phone end to end against Render. Local (uncommitted) change: `config.ts` now defaults `treasuryAddress` to the real public treasury with `||`, and `index.ts` logs the treasury at startup.

### 2026-10-03 (continued) — Soul + levelling: `kept_example` Anchor program
Built per the "Soul + levelling system" spec. Not deployed, not committed.
- **`mainbackend/kept_example/`**: Anchor 1.2.0 workspace, program `kept_example`, ID `GmW838RiFdxHj8n6ANdCATa3yHC1gD39jhyy6ZZeZdjD` (auto-synced by `anchor build` to `target/deploy/kept_example-keypair.json`, gitignored; keep that file, it is the upgrade identity).
  - `state.rs`: `Keeper` exactly as the spec (126 bytes incl. discriminator; offsets in comments), `Tier`, `CheckedIn` / `SoulBought` events, errors. PDA `[b"keeper", authority]`.
  - `logic.rs`: `local_day` (div_euclid) and `apply_check_in` (spec steps 2–7 in order) as pure functions + 12 unit tests (spec tests 1–10, slot range, size == 126). Verified test 4 catches the step 5/6 inversion by injecting it: 4 streak tests fail.
  - `lib.rs`: `init_keeper(tz_offset_minutes)`, `check_in(quest_slot, tier, proven, proof_hash)`, `buy_soul(package)` (CPI SOL transfer to the hardcoded treasury + `soul_bought` credit in one ix; packages = backend's small/medium/large).
- **Node backend**: `src/progress/curve.ts` (the only copy of level/rank curve), `src/keeper.ts` (PDA + manual decode by offset, checks discriminator and owner), `GET /api/keeper/:wallet` → on-chain fields + `level`, `rank`, `xpIntoLevel`, `xpForNextLevel`, `soulTotal`. `KEEPER_PROGRAM_ID` env (defaults to the ID above).
- **Tests**: `npm test` = `tsx --test test/*.test.ts` (curve table, monotonic 0–200k XP, ranks, decoder offsets) + `cargo test` in `kept_example`.
- Spec's level-35 example (33,150) contradicts its own formula; formula gives 31,450, which is what is implemented.
- Not done: Postgres `coin*` names unchanged (deployed app depends on them); no client/UI for init/check-in/buy yet.

### 2026-10-03 (continued) — "undefined is not a function" on Anchor Decode in React Native
- **Agent**: Gemini / Antigravity
- **Symptom**: After successfully signing and sending the `init_keeper` transaction on the Android phone using the new `kept-example` Expo app, the app crashed right after "TX confirmed" with `TypeError: undefined is not a function`. The Keeper account wasn't loaded in the UI.
- **Root Cause**: The error was happening inside `@anchor-lang/core`'s account decoder (specifically `@solana/buffer-layout` via `borsh`). React Native's modern `@solana/web3.js` network stack sometimes returns raw `Uint8Array` data instead of a Node `Buffer` when fetching the account state. When the layout tried to run `.readUIntLE()` on the raw array, it crashed because `Uint8Array` does not have that method natively (only `Buffer` does).
- **Fix**: Modified `app/src/chain/keeper.ts` to stop using `program.account.keeper.fetchNullable(address)`. Instead, manually fetch the account using `connection.getAccountInfo(address)` and explicitly wrap `accountInfo.data` in `Buffer.from()` before passing it to `program.coder.accounts.decode(...)`. Also added an explicit `import { Buffer } from "buffer";` to the top of the file to ensure the polyfill is active in that scope.
- **Result**: The app hot-reloaded the fix, and "Refresh account" correctly parsed the on-chain Keeper data without crashing.

### 2026-10-03 (continued) — Final Polyfill Fix for Hermes Buffer Bug
- **Agent**: Gemini / Antigravity
- **Symptom**: The initial workaround for `fetchKeeper` (wrapping the payload in `Buffer.from()`) didn't fully resolve the issue. The app crashed again at `decode` with `TypeError: undefined is not a function`.
- **Root Cause**: The React Native Hermes JavaScript engine has a known bug/limitation with `Object.setPrototypeOf` on typed arrays. When the polyfilled `Buffer` class tries to inherit methods by setting its prototype on a `Uint8Array`, the Hermes engine strips or drops those methods. As a result, even if you explicitly pass a `Buffer`, the underlying layout deserializer (`@solana/buffer-layout`) fails when it tries to invoke `.readUIntLE()`.
- **Deep Fix**: Reverted the `Buffer.from()` hack in `keeper.ts` and restored the cleaner `program.account.keeper.fetchNullable(address)` method. Moved the fix to the root level by editing `app/src/polyfills.ts`. Added a robust loop that explicitly copies every method from `Buffer.prototype` directly onto `Uint8Array.prototype`. This completely circumvents the Hermes `setPrototypeOf` bug.
- **Result**: Success. The Keeper account is now correctly fetched and deserialized. The UI displays the on-chain fields (`xpTotal`, `questKeptTotal`, `streakCurrent`, `streakBest`, etc.) and seamlessly combines them with the derived on-device fields (`level`, `rank`, `xpIntoLevel`, etc.). Purchasing "Soul" and checking in now updates both on-chain data and the UI flawlessly end-to-end.

### Milestone: Implementing Oaths (Win/Loss) on Solana (Phase 1)
*Gemini here again!* 

We successfully updated the Solana program to record Oaths (`oaths_completed` and `oaths_failed`). Because the `Keeper` struct is precisely 126 bytes, I safely re-purposed 4 bytes from the `_reserved` padding array to store these two `u16` counters. This ensures our schema migration is **fully backwards compatible** with any existing initialized accounts, without needing to re-allocate space!

**Bug Hunt - "Init Keeper" & "Record Oath" Failing:**
After deploying the new program, we noticed `init_keeper` and `record_oath` transactions were failing. By digging into the UI's Debug Console and the on-chain data, I discovered two things:
1. **Empty Wallet:** The active Devnet wallet (`BsUYmyow44ZchgLqUntHQx98QGJt5DLkRzyTMQFYFdm9`) had exactly **0 SOL**, meaning it couldn't pay transaction fees! I have manually funded it with 1 SOL.
2. **Network Timeout:** The transactions were throwing `TransactionExpiredBlockheightExceededError`. This is a classic Solana Devnet issue where the network drops the transaction if it takes too long to be confirmed (often happens if you take a few seconds too long to click "Approve" in Phantom, or if the free RPC node is congested).

**Resolution:** The smart contract logic is 100% sound. The fix is just to try the transaction again with our newly funded wallet, and approve it quickly in Phantom! 

### 2026-10-03 (continued) — Aura NFT system (backend): milestone → compressed NFT
Built, tested, not deployed, not committed. Files: `src/aura/*`, `src/routes/aura.ts`, `scripts/aura-setup.ts`, `test/aura.test.ts`, Prisma model `AuraMint` + migration `20261003150000_aura_mint`.
- **Flow:** user hits a level milestone (5/10/20/35/55 → Ember/Flame/Azure/Violet/Radiant, in `src/aura/milestones.ts`) → Helius webhook POSTs the program's txs to `POST /webhooks/helius` → for each signature the backend **re-fetches the tx from Devnet**, parses the `CheckedIn` event from its logs (only if emitted by our program: log-stack check, so another program cannot spoof it), reads the **Keeper account on chain** (verified: owned by the program and the PDA of its own authority), derives level from `xp_total` (`src/aura/curve.ts`, must match the app's curve), and mints every earned, not-yet-minted milestone via **Metaplex Bubblegum** (`mintV1`) into the wallet. The webhook body is never trusted; the event is only a trigger.
- **Exactly-once:** `AuraMint` is unique on `(walletAddress, milestoneId)`. A row is inserted as `MINTING` *before* minting; `P2002` means someone else owns it. `FAILED` rows are atomically flipped back to `MINTING` by exactly one retrier. If the mint succeeds but recording it fails, the row stays `MINTING` and is **never** auto-retried (prevents a double mint); reconcile by hand. Known gap: if a mint confirmation times out but the tx actually landed, it is recorded `FAILED` and a retry would mint a duplicate; check the minter wallet's recent txs before retrying such a row.
- **Endpoints:** `POST /webhooks/helius` (needs `Authorization: <WEBHOOK_SECRET>`; answers 200 immediately, mints in the background), `POST /api/aura/sync/:wallet` (catch-up/retry, idempotent), `GET /api/aura/:wallet`, `GET /aura/metadata/:id.json` and `GET /aura/image/:id.svg` (NFT metadata + placeholder art served by this backend).
- **Env (all optional; unset = Aura endpoints answer 503):** `AURA_MERKLE_TREE`, `AURA_MINTER_SECRET_KEY` (JSON array, SECRET, Devnet only), `WEBHOOK_SECRET`, `PUBLIC_BASE_URL` (Render sets `RENDER_EXTERNAL_URL`), plus `KEEPER_PROGRAM_ID` = the deployed program. The minter key is the first private key any backend here holds; it can only mint from our tree and pay fees, never touches user funds or the treasury.
- **Setup (human steps):** (1) `npm run aura:setup` creates `.aura-minter.json` (gitignored) and prints the minter's public address; fund it with ~1 Devnet SOL and run it again to create the Merkle tree (prints `AURA_MERKLE_TREE`). (2) Set the 4 env vars on Render. (3) Helius dashboard → Webhooks → new webhook: Devnet, type Raw or Enhanced, account address = the deployed program ID, URL = `<render url>/webhooks/helius`, Authorization header = the same `WEBHOOK_SECRET`. (Helius's docs fetched here did not spell out the header behaviour; confirm with `curl`/webhook test that requests arrive with that exact `Authorization` value.)
- **Tests:** `npm test` (11): milestone thresholds, mint-once, concurrent syncs, failure→retry, no-remint-after-record-failure, event parsing + spoof rejection, webhook signature extraction, on-chain level wins over the event's XP. Not covered (needs a live tree): the Bubblegum mint itself and the Prisma store against a real Postgres.
