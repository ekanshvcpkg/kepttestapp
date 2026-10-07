# KEPT — Backend, Part 1 (handoff document)

> **Written for: another AI (or engineer) who must understand and continue the KEPT backend, and merge it with a separately built UI.**
> **Written by: the AI that built the backend, on 2026-10-04.** Everything below was built, run and verified on a real Android phone against Solana **Devnet** unless a line says *"unverified"*.
> **Rule for reading:** this file is the source of truth. Where it disagrees with `kept_backend.md` (the older build log), **this file wins.** `kept_backend.md` is history.

---

## 0. TL;DR (read this if you read nothing else)

1. **KEPT** is a mobile "real-life level-up" game on Solana. A user (a **Keeper**) keeps small daily promises (**Quests**), earns **XP** (permanent) and **Soul** (currency), builds a **streak**, gains a **Level** and **Rank** (E→S), and at milestone levels is gifted an **Aura** (a compressed NFT).
2. The backend has **two halves** that you must not confuse:
   - **On-chain program** (`kept_test`, Rust/Anchor, deployed on Devnet) — the *source of truth* for XP, streak, Soul and oath counters. It enforces the rules.
   - **Node backend** (Express + Prisma + Postgres, deployed on Render) — does what a blockchain cannot: re-verifies payments, **mints Aura NFTs**, serves NFT metadata.
3. **Level and Rank are never stored.** They are pure functions of `xp_total`, computed on the device (and again in the Node backend for Aura). One formula: `XP to BE level n = 25·(n−1)·(n+2)`.
4. The **client** (the Android app) holds no rules. It builds transactions, asks **Phantom** to sign them, reads the Keeper account back, and *derives* Level/Rank/progress for display.
5. **Working end to end (verified on a phone, 2026-10-04):** connect Phantom → check in → XP/streak/Soul update on chain → at level 5 a webhook triggers the Node backend → an **Ember Aura** compressed NFT is minted into the wallet (confirmed on-chain).
6. **Three things are deliberately fake/unsafe in this test build and MUST change before real users** (details in §16):
   - `buy_soul` on chain takes **no payment** (anyone can credit themselves Soul).
   - `debug_shift_day` lets a user move their own day (farm streaks) — must be compiled out.
   - `record_oath` is self-reported and unguarded; there is no real Oath system yet.
7. **Secrets exist.** §4 lists every key, where it lives, and who may hold it. **Never print, commit or paste secrets.** Devnet only; no real money anywhere.

---

## 1. How to use this document

| If you are… | Read |
|---|---|
| New to the project | §0, §2, §3, then §6 (program) and §12 (Aura) |
| Building the real UI | §7 (level math), §8 (wallet), **§9 (client computations + contract — required)**, §10 (Soul), §16 (risks) |
| Changing the on-chain program | §6, §13.1 (deploy/upgrade), §15 (problems), §16 |
| Operating Render / Aura | §4 (keys/env), §11 (Node backend), §12 (Aura), §13 (runbook) |
| Debugging something broken | §15 (every problem we hit, with fixes), §14 (what was verified), §13.5 |

Conventions: *"on chain"* = Solana Devnet. *"the app"* = `kept-example/app` (the test client). *"the Node backend"* = `mainbackend/` (the Express server). Addresses and IDs in this file are **public** and safe to copy. Secrets are **never** written here.

---

## 2. Project context

### 2.1 The idea
Most people break promises to themselves constantly and nothing happens. KEPT makes it cost something:

- A **Keeper** sets small daily **Quests** ("20 push-ups", "read 10 pages").
- They **prove** a quest by photographing the object involved. The photo is matched **on the device**, hashed **on the device**, and **never leaves the phone** — only a 32-byte hash goes on chain.
- They may instead **declare** a quest done without proof. Allowed, but worth **half the XP**. "Honesty is cheaper than dishonesty; the system never calls anyone a liar."
- Keeping promises earns **XP** (permanent, never spent) → **Level** → **Rank** (E…S). Consecutive days build a **streak**.
- Keeping promises also earns **Soul**, the in-app currency. Soul can also be **bought**. Soul is **spent**; XP never is.
- **Why a blockchain:** a promise you can quietly edit later is not a promise. On chain the history is signed, timestamped and cannot be rewritten — not by the user, not by us. That is the whole argument, and it is why the **proof hash** matters more than the photo.

### 2.2 The core design principle (governs every schema decision)
> **Store only what cannot be recomputed. Derive everything else.**

- Level, Rank, "XP into level", "XP to next level" → **derived** from `xp_total`. Never stored. Storing a derived value creates two sources of truth that drift, and retuning the curve would force a migration of every account.
- The **photo** and any **text the user writes** → never stored, never transmitted. Hashed together on the device; only the hash is sent.
- The proof hash itself → goes in the transaction arguments and the `CheckedIn` **event** only, never in account state (one slot would just overwrite the last one; a list means unbounded rent; and the transaction is already a permanent signed record).

### 2.3 The team split
Two people: **(a)** one builds the **UI** (the real app); **(b)** one builds the **backend** (this work). The UI person's real app lives elsewhere. This document exists so the two halves can be merged without re-discovering anything.

> **Merge warning (unverified, read carefully):** early in the session, a *separate* project was spotted on the same machine at `~/Documents/mainfile/KEPT-APP-MAIN-main/` (an Expo frontend with Android package `app.kept.mobile`, domain `keptdapp.vercel.app`, plus its **own** Anchor program named `kept_system`, a different program ID, and a different `Keeper` layout that appeared to **store level/rank on chain**). It was **not** examined in this work stream and may have changed. **If the UI is built against a different on-chain program than `kept_test`, the two are not compatible.** The first merge decision is: *which program is canonical?* (§16, decision D1).

### 2.4 What "Backend Part 1" covers
Everything below the UI: wallet connection mechanics, Keeper creation, the on-chain schema and rules, level/rank math, the client-side computations the UI must perform, Soul purchase (both implementations), the Node backend, Aura NFT minting, deployment, keys, problems and fixes. **Part 2** (to be written after discussion) is the merge with the UI and the production hardening.

---

## 3. System map and naming

```
 ┌───────────────────┐   sign+send    ┌──────────────────────────────┐   webhook    ┌───────────────────────────┐
 │  CLIENT (phone)   │ ─────────────► │  ON-CHAIN PROGRAM            │ ───────────► │  NODE BACKEND (Render)    │
 │  Expo/React Native│   via Phantom  │  kept_test (Rust / Anchor)   │   (Helius)   │  Express + Prisma         │
 │  + Phantom wallet │ ◄───────────── │  Solana Devnet               │              │  verifies, mints Aura     │
 └───────────────────┘   read account └──────────────────────────────┘              └─────────────┬─────────────┘
          │  Helius RPC                          ▲                                                │
          └──────────────────────────────────────┘                                    Postgres (Neon) + Merkle tree
                                                                                      + minter wallet (Bubblegum cNFTs)
```

| Name | What it is | Responsibility | Lives at |
|---|---|---|---|
| **Client** (a.k.a. frontend, "the app") | Expo (React Native) Android app | Buttons/UI, builds transactions, derives display values, debug console. **No rules.** | `kept-example/app` |
| **Wallet** | Phantom (via Mobile Wallet Adapter) | Holds the user's private key; signs. The app never sees the key. | Phantom app |
| **On-chain program** ("on-chain backend", smart contract) | `kept_test`, Rust/Anchor | Source of truth. Enforces XP/streak/cap/Soul rules. History is immutable. | Devnet `6iXXBq…` |
| **Node backend** ("the backend", off-chain backend) | Express + TypeScript + Prisma | Payment verification (legacy), **Aura minting**, NFT metadata, DB. | `mainbackend/` → Render |
| **Database** | Postgres (Neon) | Off-chain memory: legacy coin purchases, Aura mint records. | Neon |
| **Infrastructure** | Helius (RPC + webhooks), Render (hosting), GitHub (code→deploy), Neon (DB) | Third-party plumbing. | — |
| **Aura infrastructure** | A Bubblegum **Merkle tree** + a **minter wallet** | The "shelf" cNFTs are stored on and the wallet that pays for minting. | Devnet |

> **Naming rule the owner asked for:** the *Android/phone side* is the **client**; the *Node server* is **"the backend"**; the *Rust program* is the **on-chain program**. Do not call the Android app "the backend".

### 3.1 Repository / folder map (on the owner's machine)

```
~/mainweb3/kept_backend/
├── mainbackend/                      ← THE GIT REPO pushed to GitHub (origin: ekanshvcpkg/kept_backend, branch main)
│   ├── src/                          Node backend source (index.ts, config.ts, db.ts, solana.ts, routes/, aura/)
│   ├── prisma/                       schema.prisma + migrations (Postgres)
│   ├── scripts/aura-setup.ts         one-time Aura bootstrap (creates minter wallet + Merkle tree)
│   ├── test/aura.test.ts             Node tests (13 passing)
│   ├── .aura-minter.json             🔐 minter secret key file (gitignored, mode 600)
│   ├── .env                          🔐 local env (gitignored)
│   ├── kept_backend.md               older build log (history; see banner)
│   ├── BACKEND_PART_1.md             THIS FILE
│   ├── assetlinks.json               reference copy of the Digital Asset Links file (served by the UI team's Vercel site)
│   └── kept-example/                 ⚠ inside the repo folder but UNTRACKED (never pushed). Contains:
│       ├── program/                  the Anchor workspace (Rust program + LiteSVM tests)
│       ├── app/                      the Expo test client
│       └── README.md                 how to build/test/deploy/run kept-example
├── mobile-wallet-adapter-main/       Solana Mobile's reference repo; contains a LEGACY Kotlin test app (`android/testharness`)
├── patch.diff, patch_mwa.diff        legacy patches (see §15, Android entries)
```

**Important:** `kept-example/` (the Rust program source and the app source) is **not in any pushed repository**. The Rust source for the *deployed* program exists only on the owner's laptop. **First housekeeping task: give `kept-example/` its own git repo** (or move it out of `mainbackend/`). When doing so, confirm the `.gitignore` files cover `app/.env`, `app/android/` (contains a debug keystore), `program/target/` (contains the program keypair) — they currently do.

### 3.2 What is deployed where (snapshot 2026-10-04)

| Thing | Where | Version / identity |
|---|---|---|
| Node backend | Render (free tier) `https://kept-backend-bn75.onrender.com` | GitHub `main`, last commit `ba9ce43` |
| On-chain program | Solana **Devnet** | Program ID `6iXXBqsdiCnUTSVf8CW3Uuw8c7iYvZSj5haz64QMuMUh` |
| Database | Neon Postgres | tables `Payment`, `User`, `AuraMint` |
| Aura Merkle tree | Devnet | `CZc39EjxtD5PQ8Pj4mv8buPuJj2KVSyXeAj4vn58dVBe` |
| Helius webhook | Helius dashboard (devnet, enhanced, tx type *Any*) | POSTs to `…/webhooks/helius` |
| Test client | Owner's Android phone (dev build `com.kept.backendtest`) | served by Metro from the laptop |

---

## 4. Inventory: IDs, keys, secrets, environment

### 4.1 Public identifiers (safe to share and commit)

| What | Value |
|---|---|
| On-chain program ID (`kept_test`) | `6iXXBqsdiCnUTSVf8CW3Uuw8c7iYvZSj5haz64QMuMUh` |
| Program data account | `DLn8CfhiRvNrTPt1cFe6SVp2fthnjoRms2LRXKkknwUJ` |
| Upgrade authority (the deployer's CLI wallet) | `FFAZTtBd1c6kSJh3SUHMzJBNnpFHhz9iroVDu8GnZkkj` |
| Treasury (receives legacy SOL purchases; public key only) | `4AxmDUCWpC8F1aGL6ZsgyJoHfM3FDcK3AMbgMmcjD6jR` |
| Aura minter wallet (public) | `D546uXiG5Q55awYxxoKTQefmppztr7sxdiVbh5ZJBTsb` |
| Aura Merkle tree | `CZc39EjxtD5PQ8Pj4mv8buPuJj2KVSyXeAj4vn58dVBe` (depth 14, buffer 64 ⇒ 16,384 leaves; owned by SPL Account Compression `cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK`) |
| Render backend URL | `https://kept-backend-bn75.onrender.com` |
| GitHub repo | `https://github.com/ekanshvcpkg/kept_backend` (branch `main`) |
| Wallet identity URI used in the wallet connect sheet | `https://keptdapp.vercel.app` (owned by the UI team's Vercel project) |
| Android packages | `com.kept.backendtest` (our client), `com.kept.testharness` (legacy Kotlin harness), `app.kept.mobile` (UI team's real app, per `assetlinks.json`) |
| Abandoned program (never deployed) | `GmW838RiFdxHj8n6ANdCATa3yHC1gD39jhyy6ZZeZdjD` — *ignore; confirmed absent on Devnet* |

**Test fixtures (real Devnet data):**

| Fixture | Value |
|---|---|
| Owner's Phantom test wallet | `BsUYmyoW44ZchgLqUntHQx98QGJt5DLkRzyTMQFYFdm9` |
| Its Keeper PDA | `3FwaKRhs4gK3yfPEkkbpZ92XkUzB9yUzMdo8S7vNtk9X` (bump 255) |
| Its Keeper state at last check | 775 XP, level 5, rank D, streak 2, soul_earned 77, soul_bought 200, oaths 0/0 |
| First Aura minted | "Ember Aura", asset id `8kGmAzBTGAcyKRc3riDnA57YQ4FPfGHhYk9ZAcs89cQG` |
| Its mint signature | `4UpkVrGUrcAj1SEHWc1NVjVWo6SrnjRRBXLmguUb3jLdL53ngWwDkokRXmFdNbW4CZ7Zzec6HvyytK8Cmx4Udjvf` |
| Explorer | `https://explorer.solana.com/address/8kGmAzBTGAcyKRc3riDnA57YQ4FPfGHhYk9ZAcs89cQG?cluster=devnet` |
| Legacy coin balance of the same wallet (Postgres) | 500 coins |
| A throwaway wallet used in tests | `6YVjr9zszrPMKnDngYt4qYWEHLS1U4DPQNa2HeyVeLNb` (key not kept) |

### 4.2 Secrets (🔐 never print, paste, commit)

| Secret | What it is | Where it lives | Who needs it | Notes |
|---|---|---|---|---|
| **Deployer / upgrade-authority key** | The Solana CLI wallet `FFAZ…` | `~/.config/solana/id.json` (laptop) | Whoever deploys/upgrades the program | **Losing it = cannot upgrade the program.** It currently holds only ~0.004 SOL; top up from https://faucet.solana.com before deploying. |
| **Program keypair** | Defines the program ID `6iXX…` | `kept-example/program/target/deploy/kept_test-keypair.json` (gitignored) | Only for the *first* deploy | Back it up. Upgrades are authorised by the upgrade authority, not by this file. |
| **Aura minter secret key** | Signs Aura mints; is the Merkle-tree creator/delegate | `mainbackend/.aura-minter.json` (gitignored, 600) **and** Render env `AURA_MINTER_SECRET_KEY` | The Node backend only | Devnet only. It can mint from our tree and pay fees; it cannot touch user funds or the treasury. Part of it was visible in a screenshot — rotate before anything real. |
| **Helius API key** | RPC + webhook access | `kept-example/app/.env` (`EXPO_PUBLIC_RPC_URL`), Solana CLI config, possibly Render `DEVNET_RPC_URL` | Client, deployer, backend | It was pasted in a chat. Treat as exposed; **rotate before production.** ⚠ `EXPO_PUBLIC_*` values are compiled **into the app bundle** — an RPC key in a shipped app is extractable. Use a proxy in production. |
| **Webhook secret** | Shared password: Helius → backend | Render env `WEBHOOK_SECRET` **and** the Helius webhook's *Authentication Header* | Backend + Helius | Appeared in a screenshot; rotate (change both places together). A leak cannot cause a wrong mint (the backend re-verifies on chain) but allows spamming the endpoint. |
| **Database URL** | Neon Postgres connection string | Render env `DATABASE_URL`, `mainbackend/.env` | Backend | Contains the DB password. |
| **Android debug keystore** | Signs the dev build | `~/.android/debug.keystore`, `kept-example/app/android/app/debug.keystore` | Dev builds | Its SHA-256 goes into `assetlinks.json` to clear the wallet's "unverified app" warning (§8.6). |
| **Treasury private key** | Whoever owns `4Axm…` | Not held by any code here | The owner | The backend only needs the *public* address and **must never be given the private key.** |

### 4.3 Environment variables

**Node backend** (`mainbackend/.env`, and Render → Environment). Names are exact.

| Var | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | Neon Postgres URL (`postgresql://…?sslmode=require`). |
| `DEVNET_RPC_URL` | recommended | RPC for reading transactions/accounts and minting. Default is the public RPC (rate-limited). *Which value Render currently uses was not visible to the author — verify it is a Helius URL.* |
| `TREASURY_ADDRESS` | yes (has code default) | Public key that must receive legacy SOL payments. Code falls back to `4Axm…` (also if the env var is *empty*). |
| `KEEPER_PROGRAM_ID` | yes (has code default) | Program Aura watches. Default `6iXXBq…`. Was the wrong (abandoned) ID until commit `e6810d3`. |
| `AURA_MERKLE_TREE` | for Aura | Tree address from `npm run aura:setup`. |
| `AURA_MINTER_SECRET_KEY` | for Aura | 64-number JSON array (the contents of `.aura-minter.json`); brackets optional. |
| `WEBHOOK_SECRET` | for Aura | Must equal the Helius webhook's Authentication Header. |
| `PUBLIC_BASE_URL` | for Aura | Public URL used inside NFT metadata. **Render provides `RENDER_EXTERNAL_URL` automatically**, which is used if this is unset (this is what is in effect). |
| `PORT` | auto | Set by Render. Server binds `0.0.0.0:$PORT`. |

*If any `AURA_*`/`WEBHOOK_SECRET`/`PUBLIC_BASE_URL` is missing, all Aura endpoints answer **503** "Aura minting is not configured". Nothing else is affected.*

**Client** (`kept-example/app/.env`; copy from `.env.example`; Expo inlines `EXPO_PUBLIC_*` at **build/bundle** time — restart `npm start` after changes):

| Var | Meaning |
|---|---|
| `EXPO_PUBLIC_RPC_URL` | Solana RPC (use a private Devnet RPC). |
| `EXPO_PUBLIC_CLUSTER` | `devnet` \| `testnet` \| `mainnet-beta` (wallet chain id `solana:<cluster>` + explorer links). |
| `EXPO_PUBLIC_PROGRAM_ID` | `6iXXBq…` |
| `EXPO_PUBLIC_APP_IDENTITY_NAME` / `_URI` | What the wallet shows when asked to connect (`https://keptdapp.vercel.app`). |

### 4.4 Bootstrap order for a brand-new environment
1. Install toolchain (§5). 2. `solana config set --url <private devnet rpc>`; fund the CLI wallet. 3. Build + deploy the program (§13.1). 4. Put the program ID in `app/.env` and Render `KEEPER_PROGRAM_ID`. 5. `npm run aura:setup` (twice: create wallet → fund it → create tree). 6. Set the Aura env vars on Render. 7. Create the Helius webhook (§12.5). 8. `cd app && npm run sync-idl && npx expo run:android`. 9. Run the end-to-end test (§13.3).

---

## 5. Toolchain and versions (what actually worked)

| Tool | Version |
|---|---|
| Anchor CLI | **1.2.0** (`anchor-lang` 1.2.0; JS package is **`@anchor-lang/core` 1.2.0**, *not* `@coral-xyz/anchor`) |
| Solana CLI | 3.1.10 (Agave); SBF platform-tools v1.52 (rustc 1.89.0 for the on-chain build) |
| Rust (host) | 1.98.1 |
| Node / npm | 24.21.0 / 11.19.0 (**engines: node ≥ 20**) |
| Prisma | 6.19.3 (Postgres) |
| Express | 4.x; TypeScript 5.x; ESM (`"type": "module"`, `NodeNext` — **relative imports must end in `.js`**) |
| Metaplex | `mpl-bubblegum` 6.0.0, `umi` 1.6.0 |
| Expo SDK | ~57.0.26; React Native 0.86.3; React 19.2.3; TypeScript ~6.0 |
| Wallet adapter | `@solana-mobile/mobile-wallet-adapter-protocol(-web3js)` ^2.3.0; `@solana/web3.js` ^1.99 |
| Tests | LiteSVM 1.5 (`litesvm`), mocha/chai, `tsx --test` (Node runner), `cargo test` |
| Java (Android build) | OpenJDK 17; `ANDROID_HOME=$HOME/Library/Android/sdk` |

**Gotchas that cost time** (details in §15): npm 11 blocks dependency install scripts (approve them / `allowScripts`); Devnet currently needs **`anchor build --arch v2`**; the public Devnet RPC rate-limits (HTTP 429) — use a private RPC; Expo Go **cannot** run this app (native wallet module) — a **development build** is required.

---

## 6. The on-chain program (`kept_test`, Rust / Anchor 1.2)

Source: `kept-example/program/programs/kept_test/src/` — `lib.rs` (wiring only), `constants.rs`, `state.rs`, `errors.rs`, `events.rs`, `day.rs`, `instructions/{init_keeper,check_in,buy_soul,record_oath,debug_shift_day}.rs`.
Rules of the codebase: **`lib.rs` contains wiring only**; all logic lives in `instructions/`; **every number lives in `constants.rs`** (no number appears twice); the day index is computed in **one** function (`day.rs`).

### 6.1 The `Keeper` account

One per wallet. **PDA seeds:** `[b"keeper", authority_pubkey]` under program `6iXXBq…`. Created by `init_keeper`; **cannot be created twice** (Anchor `init` fails with "account already in use").
Size: **126 bytes** = 8-byte Anchor discriminator + 118 bytes. Rent-exempt minimum ≈ **0.00129 SOL** (paid by the user at init).

| Offset | Size | Field | Type | Meaning |
|---:|---:|---|---|---|
| 0 | 8 | *discriminator* | — | `[127,221,194,46,120,73,144,77]` (= first 8 bytes of sha256("account:Keeper")) |
| 8 | 32 | `authority` | Pubkey | The wallet that owns this Keeper |
| 40 | 8 | `xp_total` | u64 | **Lifetime XP. Never decreases.** Level and Rank derive from this and nothing else |
| 48 | 4 | `quests_kept_total` | u32 | Lifetime kept promises. Increments even if the daily cap paid 0 XP |
| 52 | 2 | `streak_current` | u16 | Current streak (see §9.1 — may be *stale* until the next check-in) |
| 54 | 2 | `streak_best` | u16 | Best streak ever |
| 56 | 8 | `last_checkin_day` | i64 | Local day index of the last first-check-in-of-the-day; `i64::MIN` = never |
| 64 | 1 | `today_mask` | u8 | One bit per quest slot (bit *n* = slot *n* kept on `xp_today_day`) |
| 65 | 2 | `xp_today` | u16 | XP earned on `xp_today_day` |
| 67 | 8 | `xp_today_day` | i64 | The local day `xp_today`/`today_mask` refer to; `i64::MIN` initially |
| 75 | 8 | `soul_earned` | u64 | Soul earned by keeping promises (**only this is ever stakeable**) |
| 83 | 8 | `soul_bought` | u64 | Soul purchased (**never stakeable**) |
| 91 | 2 | `tz_offset_minutes` | i16 | Local offset from UTC in minutes (330 = UTC+5:30). Set at init; fixed except via the debug instruction |
| 93 | 1 | `bump` | u8 | PDA bump (stored so instructions can skip the search) |
| 94 | 2 | `oaths_completed` | u16 | Oaths recorded as kept |
| 96 | 2 | `oaths_failed` | u16 | Oaths recorded as failed/left |
| 98 | 28 | `_reserved` | [u8;28] | Room for future fields **without a migration/resize** |

**Why the deliberate choices:**
- `soul_earned` and `soul_bought` are **separate**. Later, Soul can be staked on shared commitments (Oaths) and **only earned Soul may ever be staked** — otherwise someone buys their way into a stake and the feature becomes gambling. Splitting a single balance later is a painful migration; keeping them apart costs 8 bytes.
- `tz_offset_minutes` exists because "today" is a *local* question. Computed from raw UTC, a user at UTC+5:30 would see their day roll at 5:30 am and lose a streak they never broke.
- `_reserved` shrank from 32 to 28 bytes to fit the two oath counters without changing the account size (the pattern for adding fields; §6.13).
- **No Level, no Rank, no proof hash, no photo, no text** in the account. Ever.

### 6.2 Constants (`constants.rs` — the only place numbers live)

| Constant | Value | Meaning |
|---|---|---|
| `KEEPER_SEED` | `b"keeper"` | PDA seed |
| `QUEST_SLOTS` | 8 | Slots per Keeper (bits of `today_mask`) |
| `TIER_XP` | `[50, 100, 150, 250]` | Base XP: Easy, Normal, Hard, Epic (enum order) |
| `DECLARED_XP_DIVISOR` | 2 | Declared (unproven) = base ÷ 2 (integer division) |
| `DAILY_XP_CAP` | 600 | Max XP per local day |
| `SOUL_PER_XP` | 10 | 1 Soul per 10 XP *awarded* (integer division **per check-in**) |
| `NEVER_DAY` | `i64::MIN` | "never" sentinel |
| `SECONDS_PER_DAY` / `_MINUTE` | 86 400 / 60 | |
| `MIN/MAX_TZ_OFFSET_MINUTES` | −720 / +840 | UTC−12:00 … UTC+14:00 |
| `MINUTES_PER_DAY` | 1 440 | Debug shift unit |
| `KEEPER_RESERVED_BYTES` | 28 | |

### 6.3 The day index (one helper, used everywhere)

```rust
pub fn local_day(now_unix: i64, tz_offset_minutes: i16) -> i64 {
    (now_unix + (tz_offset_minutes as i64) * 60).div_euclid(86_400)
}
```
- **`div_euclid`, not `/`.** Plain integer division rounds toward zero: `-1 / 86400 == 0`, but second −1 belongs to day **−1**. Tested.
- Local midnight at UTC+5:30 is 18:30 UTC of the previous UTC day. Tested (`local_day(midnight-1, 330) == 9`, `local_day(midnight, 330) == 10`; 05:29 UTC does **not** roll the day).
- Time source is the chain's `Clock::unix_timestamp` (validator time, not the phone's).
- The same formula must be used by the client (§9.1) so UI "today" equals chain "today".

### 6.4 Instruction: `init_keeper(tz_offset_minutes: i16)`
- **Accounts:** `keeper` (writable, `init`, PDA), `authority` (writable signer, pays rent), `system_program`.
- **Validates:** `−720 ≤ tz ≤ 840` else `InvalidTimezoneOffset`.
- **Sets:** `authority`, `tz_offset_minutes`, `bump`; `last_checkin_day = xp_today_day = i64::MIN`; everything else 0; `_reserved` zeroed.
- **Fails** if the Keeper already exists (the client should check first — see §9.3).

### 6.5 Instruction: `check_in(quest_slot: u8, tier: Tier, proven: bool, proof_hash: [u8;32])`
- **Accounts:** `keeper` (writable, PDA, `has_one = authority`), `authority` (signer).
- `Tier` is an enum: `0 Easy, 1 Normal, 2 Hard, 3 Epic` (one byte in Borsh).
- **The steps, in exactly this order** (the order is part of the spec; step 5 before 6 is critical):

```
1. today = local_day(Clock.unix_timestamp, keeper.tz_offset_minutes)

2. Roll the daily counters if the day changed:
     if keeper.xp_today_day != today {
         keeper.xp_today = 0;  keeper.today_mask = 0;  keeper.xp_today_day = today;
     }

3. require!(quest_slot < 8, InvalidSlot);
   require!(keeper.today_mask & (1 << quest_slot) == 0, AlreadyKeptToday);

4. base      = TIER_XP[tier]                    // 50 | 100 | 150 | 250
   gross     = proven ? base : base / 2
   remaining = DAILY_XP_CAP.saturating_sub(keeper.xp_today)
   awarded   = min(gross, remaining)

5. STREAK — read the mask BEFORE writing to it:
     first_today = (keeper.today_mask == 0)
     if first_today {
         if keeper.last_checkin_day == today - 1      { streak_current += 1 }
         else if keeper.last_checkin_day != today     { streak_current = 1 }   // broken, or first ever
         keeper.last_checkin_day = today
         keeper.streak_best = max(streak_best, streak_current)
     }

6. NOW set the bit:   keeper.today_mask |= 1 << quest_slot

7. Apply (checked arithmetic):
     xp_today          += awarded
     xp_total          += awarded
     quests_kept_total += 1                          // even when awarded == 0
     soul_earned       += awarded / 10               // from `awarded`, NOT `gross`

8. emit!(CheckedIn { keeper, day, quest_slot, tier, proven, xp_awarded,
                     xp_total_after, streak_after, proof_hash })
```
- **Why step 5 must precede step 6:** if the mask bit is set first, `first_today` is *always* false and the streak never advances. This exact inversion shipped once in this project; test #4 exists for it, and a deliberate re-introduction of the bug makes 6 tests fail (mutation-verified).
- **Deliberate details:** `quests_kept_total` counts *promises*, not points, so it increments even when the cap pays 0. Soul is computed from `awarded`, so the cap limits Soul too (max 60 Soul/day from XP at a full 600). `soul_earned` uses integer division **per check-in** (a declared Easy = 25 XP → 2 Soul, not 2.5).
- **A rejected check-in changes nothing** (the transaction reverts atomically).
- **Soul at the cap:** a check-in at the cap still marks the slot kept, increments `quests_kept_total`, and awards 0 XP / 0 Soul.
- **Worked example (from a real run, 2026-10-04):** Keeper at 325 XP, last day 20729 → check-in on day 20730, slot 0 Epic proven → `xp_total 325→575`, `streak 1→2`, `last_checkin_day →20730`, `today_mask 0x11→0x01`, `xp_today 325→250`, `xp_today_day →20730`, `soul_earned 32→57`. Second check-in same day (slot 1, Normal) → `xp_total 575→675`, `today_mask 0x01→0x03`, streak **unchanged** at 2.
- **The proof hash** is only in the instruction data and the `CheckedIn` event. The chain **cannot** verify a photo; `proven` is a **client-asserted** flag (see §16, risk R4).

### 6.6 Instruction: `buy_soul(amount: u64)` — **DEVNET STAND-IN, NO PAYMENT**
- **Accounts:** `keeper` (writable), `authority` (signer). **No treasury, no system program.**
- Requires `amount > 0` (`ZeroAmount`); adds to `soul_bought` only (checked add); emits `SoulBought`. **Never touches `soul_earned`, XP or the streak** (tested).
- ⚠ **Takes no payment.** Any wallet can credit itself unlimited Soul. This is a placeholder so the pipeline can be exercised. Production design: §10.4.

### 6.7 Instruction: `record_oath(success: bool)`
- **Accounts:** `keeper` (writable), `authority` (signer).
- `success = true` → `oaths_completed += 1`; `false` → `oaths_failed += 1` (checked). Touches nothing else (tested). **No event is emitted.**
- ⚠ Self-reported and unguarded: a wallet can bump its own counters at will. There is no Oath account, no stake, no verification. It is a *record*, not a system (§16, risk R3).
- *Provenance note:* the deployed program has this instruction (verified by simulation, 2026-10-04); the **source file in this repo was re-written by the author from the deployed behaviour** (it overwrote an earlier hand-written version by another contributor, which may have differed in details such as events). Behaviour matches on-chain probes. See §6.12.

### 6.8 Instruction: `debug_shift_day(days: i16)` — **DEBUG ONLY**
- Behind cargo feature **`debug-tools`** (on by default in this test build). Shifts `tz_offset_minutes` by `days × 1440` (checked), emits `DayShifted`. It lets a tester cross a real day boundary on a device to exercise the streak logic.
- ⚠ **A user-settable day offset lets anyone farm streaks and the daily XP cap.** Production build: `anchor build --arch v2 -- --no-default-features` (verified: the IDL then has only 4 instructions). **The currently deployed program still has it.**

### 6.9 Errors and events

| Error | Code | Message |
|---|---:|---|
| `InvalidSlot` | 6000 | Quest slot must be 0-7 |
| `AlreadyKeptToday` | 6001 | This quest slot was already kept today |
| `InvalidTimezoneOffset` | 6002 | Timezone offset must be between -720 and +840 minutes |
| `ZeroAmount` | 6003 | Soul amount must be greater than zero |
| `Overflow` | 6004 | Arithmetic overflow |

Anchor framework errors that matter: **`custom program error: 0x0` on `init_keeper` = account already in use** (Keeper exists); `0x65` (101) = unknown instruction (`InstructionFallbackNotFound`); 3012 `AccountNotInitialized` (no Keeper yet).

**Events** (Anchor `emit!` → a log line `Program data: <base64>`; first 8 bytes = discriminator):

| Event | Discriminator | Layout after the 8 bytes |
|---|---|---|
| `CheckedIn` | `[211,80,198,244,196,84,212,150]` | keeper Pubkey(32) · day i64 · quest_slot u8 · tier u8 · proven bool · xp_awarded u16 · xp_total_after u64 · streak_after u16 · proof_hash [u8;32] = **95 bytes total** (offsets: keeper 8..40, xp_total_after 53..61) |
| `SoulBought` | `[169,228,80,202,92,153,50,168]` | keeper · amount u64 · soul_bought_after u64 |
| `DayShifted` | `[66,133,68,164,209,140,55,126]` | keeper · days i16 · tz_offset_minutes_after i16 |

### 6.10 Raw client interface (for any non-Anchor client, e.g. Kotlin)
Instruction data = 8-byte discriminator + Borsh args (little-endian). Account order is fixed.

| Instruction | Discriminator | Args (Borsh) | Data bytes | Accounts (in order) |
|---|---|---|---:|---|
| `init_keeper` | `[157,247,141,221,166,211,227,101]` | `i16` | 10 | keeper (W), authority (W, signer), system_program |
| `check_in` | `[209,253,4,217,250,241,207,50]` | `u8` slot, `u8` tier, `u8` proven (0/1), `[u8;32]` hash | 43 | keeper (W), authority (signer) |
| `buy_soul` | `[131,166,212,188,145,190,179,38]` | `u64` | 16 | keeper (W), authority (signer) |
| `record_oath` | `[130,182,112,5,82,200,102,104]` | `u8` success (0/1) | 9 | keeper (W), authority (signer) |
| `debug_shift_day` | `[240,220,241,236,116,155,161,204]` | `i16` | 10 | keeper (W), authority (signer) |

(W = writable.) Keeper PDA = `findProgramAddress([ "keeper", authority ], programId)`. In the Anchor JS client use `.accountsPartial({ keeper, authority })` and **`BN` for u64 arguments**.

### 6.11 Tests (what protects the rules)
- **Rust unit tests** (`cargo test`, 3): `local_day` negative timestamps; midnight at +330; account size = 126.
- **LiteSVM integration tests** (`cd program && npm test`, **14 passing**) — an in-process Solana VM with a **settable clock**, so day boundaries are crossed instantly: init (zeroed state, can't run twice) · #1 first check-in sets streak 1 · #2 consecutive days → streak 2 · #3 skipped day resets, `streak_best` keeps high · #4 two check-ins same day don't move the streak (the 5/6 ordering test) · #5 same slot twice → `AlreadyKeptToday`, state unchanged · invalid slot · #6 cap truncation (xp_today stops at exactly 600, `quests_kept_total` still counts, slot still marked, Soul 60) · #7 declared = exactly half for all tiers · #8 daily counters reset when the day index changes and only then · #9 `local_day` negative timestamp and midnight at +330 · #10 `buy_soul` touches `soul_bought` only (+ zero amount rejected) · `record_oath` bumps only the matching counter · `debug_shift_day` crosses a day.
- **Mutation check:** placing the mask write before the streak step makes 6 tests fail; restored → all 14 pass.
- **Not covered:** the deployed binary byte-for-byte (see §6.12), concurrent transactions, mainnet behaviour, any payment logic (none exists).

### 6.12 Deployed binary vs source (be careful)
- The **deployed** program (Devnet, last deployed slot 507024240, 150,040 bytes) is **not byte-identical** to a local build — build toolchains (Anchor vs `cargo build-sbf`, flags) give different sizes and the exact original build is unknown.
- **Behaviour was verified on the real deployment** (2026-10-04) with a throwaway wallet: `init_keeper` (126-byte account owned by the program), `check_in` (xp 250, streak 1, soul 25, `today_mask` 1), the backend's own event parser decoded the **real** `CheckedIn` log, `debug_shift_day` is **present**, `record_oath` is **present** (simulated: bumps byte 94 for success, byte 96 for failure).
- **Recommendation:** rebuild from source with `--arch v2`, upgrade the deployment, and from then on treat the repo source as canonical (§13.1).

### 6.13 Evolving the account layout
- **Adding a field without migration:** carve it from `_reserved` (reduce `KEEPER_RESERVED_BYTES`, add the field *before* `_reserved`, keep total 126). This is how `oaths_completed/failed` were added (offsets 94/96).
- **Never** reorder or resize existing fields — every deployed account would mis-decode. There is **no realloc/migration instruction**. If more than 28 bytes are ever needed, a migration instruction (realloc) must be written first.
- After any change: `anchor build --arch v2` → run tests → upgrade → `cd app && npm run sync-idl` → restart Metro. **Restart the Node backend if you change offsets it reads** (it decodes `authority@8`, `xp_total@40`).

---

## 7. Level and Rank math (derived, never stored)

Level and Rank are pure functions of `xp_total`. Nothing on chain reads them.

```
XP to go from level n to n+1       = 100 + 50·(n − 1)
Cumulative XP required to BE level n = 25·(n − 1)·(n + 2)

levelFromXp(xp)   = the largest n such that 25·(n−1)·(n+2) ≤ xp
rankFromLevel(n)  = E: 1–4 · D: 5–9 · C: 10–19 · B: 20–34 · A: 35–54 · S: 55+
xpIntoLevel(xp)   = xp − 25·(L−1)·(L+2)            where L = levelFromXp(xp)
xpForNextLevel(xp)= 100 + 50·(L − 1)               (size of the current step; progress-bar denominator)
```

| Level | XP to BE this level | Step to next | Days at the 600 XP/day cap |
|---:|---:|---:|---:|
| 1 | 0 | 100 | 0 |
| 2 | 100 | 150 | 0.2 |
| 3 | 250 | 200 | 0.4 |
| 4 | 450 | 250 | 0.8 |
| **5** | **700** | 300 | 1.2 |
| 6 | 1 000 | 350 | 1.7 |
| 8 | 1 750 | 450 | 2.9 |
| **10** | **2 700** | 550 | 4.5 |
| 15 | 5 950 | 800 | 9.9 |
| **20** | **10 450** | 1 050 | 17.4 |
| 25 | 16 200 | 1 300 | 27.0 |
| 30 | 23 200 | 1 550 | 38.7 |
| **35** | **31 450** | 1 800 | 52.4 |
| 45 | 51 700 | 2 300 | 86.2 |
| **55** | **76 950** | 2 800 | 128.2 |
| 99 | 247 450 | 5 000 | 412.4 |

Bold rows are the **Aura milestones** (§12). *Game-design note:* at the daily cap, S rank takes ~128 days; level 5 takes ~2 days.

> ⚠ **Spec discrepancy:** the original brief listed "level 35 → 33,150 XP". Its own formula gives `25·34·37 = **31,450**`. The formula is what is implemented everywhere; the brief's number was a typo. Don't "fix" the code to match it.

**Where this lives — two copies that MUST stay identical:**
1. `kept-example/app/src/progress/curve.ts` — the client's display curve (also exports `derive(xp)`), tunable constants `LEVEL_BASE_STEP_XP=100`, `LEVEL_STEP_GROWTH_XP=50`, `RANK_FLOORS`.
2. `mainbackend/src/aura/curve.ts` — the backend's copy, used only to decide which Auras a wallet has earned.
There is **no Rust copy.** To retune: edit both TS files (and the milestone levels in `src/aura/milestones.ts`), nothing on chain changes, no migration. (Decision D4: share one source, §16.)

```ts
// client (curve.ts) — exact integer math, no float sqrt
export function xpToReachLevel(n: number) {            // closed form of the step sum
  const steps = n - 1;
  return steps * 100 + (50 * steps * (steps - 1)) / 2;  // == 25·(n−1)·(n+2)
}
export function levelFromXp(xp: number | bigint) {      // doubling + binary search
  const total = Math.max(0, Number(xp));
  let hi = 2; while (xpToReachLevel(hi) <= total) hi *= 2;
  let lo = Math.max(1, hi / 2);
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2);
    if (xpToReachLevel(mid) <= total) lo = mid; else hi = mid - 1; }
  return lo;
}
```
Verified: the table above, a sweep of every XP value 0…300,000 (consistent and monotonic), all rank boundaries, and the progress helpers (e.g. 130 XP → level 2, 30 into level, step 150).

---

## 8. Wallet connection (Mobile Wallet Adapter)

### 8.1 What it is
The client never holds keys. It uses Solana **Mobile Wallet Adapter (MWA)**: the app opens a *local WebSocket association* with a wallet app (Phantom) installed on the same phone. The wallet shows approval sheets and signs. Two operations are used: **`authorize`** (connect → get the account) and **`signAndSendTransactions`** (wallet signs **and submits** to the cluster, returns the signature).

### 8.2 Prerequisites on the phone
- **Phantom installed**, with **Testnet Mode ON** and the network set to **Solana Devnet** (Settings → Developer Settings). The wallet needs a little Devnet SOL (rent for the Keeper ≈ 0.0013 SOL + ~0.00008 SOL per transaction). Faucet: https://faucet.solana.com or `solana airdrop`.
- The app must be a **development build** (`npx expo run:android`). **Expo Go cannot run it** (native wallet module). The phone and laptop must be on the same network for Metro (dev server on port 8082 in our setup).

### 8.3 Connect (`chain/wallet.ts → connectWallet`)
```ts
const identity = { name: config.appIdentity.name, uri: config.appIdentity.uri };   // from .env
const auth = await transact((wallet) => wallet.authorize({ chain: "solana:devnet", identity }));
const account = auth.accounts[0];                       // address is base64
const publicKey = new PublicKey(Buffer.from(account.address, "base64"));
await waitForForeground();                              // see 8.5
```
Result: the user's public key. The UI then reads their SOL balance and Keeper.

### 8.4 Sign and send one instruction (`chain/wallet.ts → signAndSend`)
1. `getLatestBlockhash("confirmed")`; build a legacy `Transaction` with `feePayer = user` and the one instruction.
2. **Pre-simulate** with `connection.simulateTransaction(tx)`. If it fails, throw immediately with the program's error and logs (**never** open the wallet for a transaction the program will reject — see §15, P22).
3. `getSlot("confirmed")` → pass as **`minContextSlot`** (Phantom rejects the request without it).
4. `transact(async wallet => { authorize (fresh); verify the authorized account equals the expected payer; return wallet.signAndSendTransactions({ transactions:[tx], minContextSlot }) })`.
5. `waitForForeground()` (up to 60 s).
6. `connection.confirmTransaction({signature, blockhash, lastValidBlockHeight}, "confirmed")`; throw if `value.err`.
7. Return the signature (the caller then re-reads the Keeper and builds the diff).

### 8.5 The quirks that make this work (each one was a real bug)
| Quirk | Why |
|---|---|
| **Remembered session, with a fallback to a full `authorize`** (`wallet.ts`: `restoreWallet`, `authorizeInSession`, AsyncStorage key `kept-test/wallet-session/v1`) | The app reopens already connected (no wallet popup) and tries a silent re-authorize with the saved `auth_token`. **Phantom currently refuses the silent path** for this app (§8.6, P40), so each signing still falls back to a full authorize and Phantom shows a *Connect* sheet before the *Confirm* sheet. The fallback is automatic. |
| **`minContextSlot` must be a number** | Phantom's RPC schema rejects the request if it is missing; the library's default omits it and the user sees the misleading *"Failed establishing local association with wallet"*. |
| **`waitForForeground()` after the wallet** | On the test phone (Samsung, Android) the OS **blocks network for a backgrounded app** (`netpolicy blocked=APP_BACKGROUND`, DNS fails with `isBlocked=true`); right after signing, Phantom is still in front. Any RPC/HTTP call then fails with *"Unable to resolve host"*. Wait until `AppState === "active"`. |
| **Pre-simulation** | A transaction the program rejects is **silently dropped** by the wallet's send; the only symptom is a fake `TransactionExpiredBlockheightExceededError` after ~90 s. |
| **Phantom's sign sheet times out at ~30 s** | Don't make the user wait on a cold backend before signing (Render free tier cold start is 30–50 s). |
| **Transient `ECONNREFUSED 127.0.0.1:<port>`** on the first connect after an install | Phantom logs "scenario ready" but its local server isn't listening yet. Relaunch both apps and retry. |
| **Read the wallet's own logs, not the library's exception** | Filter `adb logcat` for `PhantomMWAModule`, `ReactNativeJS`, `LocalAssociationScenario`, `IdentityVerifier` (exact command in §13.5). |

### 8.6 The red "identity could not be verified" banner
The connect sheet shows *"This app's identity could not be verified. It may be impersonating another app."* Cause: Phantom checks **Digital Asset Links** — the domain in `identityUri` (`https://keptdapp.vercel.app`) must serve `/.well-known/assetlinks.json` listing the calling app's **package name** and **signing-certificate SHA-256**. The file served there (reference copy: `mainbackend/assetlinks.json`) lists `app.kept.mobile` and the legacy `com.kept.testharness` — **not `com.kept.backendtest`**. It is a **warning only** (everything works on Devnet) and the sheet still has a Connect button.
To clear it: add a target for `com.kept.backendtest` with the SHA-256 of the signing cert (`keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`, or `apksigner verify --print-certs <apk>`) to the file **deployed on that Vercel project (owned by the UI team — human action)**. For release builds, add the **release** keystore fingerprint too (keep both entries). **Status (2026-10-04): still unsolved.** Everything below was tried against Phantom on the real phone; see P40 for the full experiment log. In short: the file is correct and Google's checker says `linked:true`, **Phantom does download it** (we saw its request), yet it logs `DAL verification failed … Could not verify package`. Consequence: Phantom refuses silent re-authorization for this app, so every wallet action shows a **Connect** sheet (with the red warning) and then a **Confirm** sheet.

### 8.7 Client-side failure → plain-language mapping (already implemented in `chain/errors.ts`)
| Signal in the raw error | Meaning shown to the user |
|---|---|
| `Error Code: AlreadyKeptToday` | slot already kept today (pick another slot / wait for next local day) |
| `Error Code: InvalidSlot` / `InvalidTimezoneOffset` / `ZeroAmount` / `Overflow` | the matching message from §6.9 |
| `custom program error: 0x0` or "already in use" | this wallet already has a Keeper |
| `AccountNotInitialized` / 3012 | no Keeper yet — Init first |
| "no record of a prior credit" / "insufficient" | wallet has no/too little SOL on this cluster |
| `429` / "too many requests" | RPC is rate-limiting → use a private RPC |
| "blockhash not found" / "block height exceeded" / "expired" | never landed in time (slow approval **or the program rejected it**) |
| "declined" / "rejected" / "authorization_failed" | declined in the wallet; nothing sent |
| "wallet_not_found" | no MWA wallet installed |
| "network request failed" / "unable to resolve host" | no connectivity (or app was backgrounded) |
| "foreground" | app didn't come back after the wallet |

---

## 9. Client-side computations and the client contract  *(the UI developer must read this)*

The chain stores raw facts. **Everything a screen shows beyond raw fields is computed on the device.** The client implementation lives in `kept-example/app/src/` (`chain/`, `progress/curve.ts`, `debug/`, `screens/`). A real UI should reuse `chain/` unchanged and replace only `screens/`.

### 9.1 The computations (with code)

**(a) Timezone offset (sent once, at `init_keeper`).** Minutes east of UTC, from the device clock; **fixed for the account's life**:
```ts
const tzOffsetMinutes = -new Date().getTimezoneOffset();   // India → 330
```
*Limitation:* DST changes or travel are **not** tracked (there is no instruction to update it, except the debug one) — see R6.

**(b) "Today" — must equal the chain's `local_day`:**
```ts
const localDay = (nowUnixSec: number, tzMin: number) => Math.floor((nowUnixSec + tzMin * 60) / 86_400);
const today = localDay(Math.floor(Date.now() / 1000), k.tzOffsetMinutes);   // use the KEEPER's tz, not the device's current one
```
`Math.floor` (not truncation) matches `div_euclid` for negatives. The phone clock can differ from validator time by seconds/minutes; near local midnight the UI and chain may disagree briefly — let the chain decide, never hard-block on the UI's guess.

**(c) Stale-counter detection.** The chain only *resets* `today_mask`/`xp_today` **when the next check-in happens**. So a screen must not show yesterday's numbers as today's:
```ts
const dayIsCurrent = k.xpTodayDay === BigInt(today);
const keptMaskToday = dayIsCurrent ? k.todayMask : 0;        // which slots are done today
const xpToday       = dayIsCurrent ? k.xpToday   : 0;
const xpRemaining   = 600 - xpToday;                          // DAILY_XP_CAP
```

**(d) Streak display.** `streak_current` is also only updated at check-in. Show it only if it is still alive:
```ts
const NEVER = -(2n ** 63n);
const sinceLast = BigInt(today) - k.lastCheckinDay;
const streakShown = k.lastCheckinDay === NEVER ? 0 : sinceLast <= 1n ? k.streakCurrent : 0;
const streakAtRisk = k.lastCheckinDay !== NEVER && sinceLast === 1n;   // kept yesterday, nothing yet today
```

**(e) Level, Rank, progress bar** — `derive(k.xpTotal)` → `{level, rank, xpIntoLevel, xpForNextLevel}` (§7). Bar = `xpIntoLevel / xpForNextLevel`; "to next" = `xpForNextLevel − xpIntoLevel`.

**(f) Award preview (what a check-in *will* pay)** — display only; the chain is authoritative:
```ts
const TIER_XP = { easy: 50, normal: 100, hard: 150, epic: 250 };
function preview(tier, proven, xpTodayEffective) {
  const base = TIER_XP[tier], gross = proven ? base : Math.floor(base / 2);
  const awarded = Math.min(gross, 600 - xpTodayEffective);
  return { awarded, soul: Math.floor(awarded / 10) };       // Soul floors per check-in
}
```

**(g) Seconds until the local day rolls over** (for a "resets in 4h 12m" label):
```ts
const sec = Math.floor(Date.now() / 1000) + k.tzOffsetMinutes * 60;
const untilReset = 86_400 - (((sec % 86_400) + 86_400) % 86_400);
```

**(h) The proof hash** *(client responsibility, not yet implemented — the test app sends 32 random bytes as a stand-in).* Design: `proof_hash = sha256(photo_bytes ‖ comment_utf8 ‖ timestamp)` computed **on the device**; exactly 32 bytes; **fix and document the timestamp encoding** (e.g. 8-byte big-endian ms) so the hash can be re-derived later; **keep the original photo+comment locally** (a hash proves nothing if the inputs are gone). Neither photo nor text is ever transmitted.

**(i) Proven vs declared.** The on-device matcher decides `proven`. Declared = no photo possible/available, worth half XP. The chain trusts the flag (R4).

**(j) Quest ↔ slot mapping.** The chain knows 8 anonymous **slots (0–7)**; **quest names, descriptions and the slot assignment live only in the client.** One check-in per slot per local day. Also the **tier** (Easy/Normal/Hard/Epic) is chosen by the client at check-in; the chain does not know a quest's real difficulty (R5).

**(k) BN → bigint.** Anchor returns `BN` for u64/i64. `chain/keeper.ts` converts to `bigint` (`BigInt(v.toString())`); keep `xpTotal`, `soul*`, and the two day fields as `bigint` in state; compare with `BigInt(...)`/`NEVER`.

**(l) Diffs and derived changes (debug).** `diffKeeper(before, after)` lists only changed fields; `logDerived` shows level/rank/bar before→after. Useful as a dev tool, not product UI.

### 9.2 Keeper initialisation flow
1. User connects (§8.3). 2. `fetchKeeper(wallet)` (a `fetchNullable` on the PDA). 3. **If a Keeper exists → do not call init** (it can never succeed: "account already in use"). `initKeeper()` already short-circuits and logs *"Keeper already exists, init skipped"*. 4. Otherwise `initKeeper(wallet, tzOffsetMinutes)` → pre-simulate → wallet → confirm → re-read → state shown. Cost: rent ≈ 0.0013 SOL + fee, paid by the user.

### 9.3 Check-in flow
1. UI collects `slot (0–7)`, `tier`, `proven`, and (real UI) the real `proofHash`. 2. Optionally preview (9.1f). 3. `checkIn(wallet, {questSlot, tier, proven})` → build `check_in` ix → **pre-simulate** (catches `AlreadyKeptToday`, `InvalidSlot` before the wallet opens) → wallet signs/sends → confirm → re-read Keeper → diff + derived level/rank logged. 4. (Backend, async) Helius notifies the Node backend; at a milestone level an Aura is minted (§12). The UI can poll `GET /api/aura/:wallet`.

### 9.4 Reading state
```ts
const raw = await program.account.keeper.fetchNullable(keeperPda(wallet), "confirmed");  // null if no Keeper
```
`keeperPda(wallet)` = `findProgramAddressSync([Buffer.from("keeper"), wallet.toBuffer()], programId)`. The Anchor `Program` is built from `chain/idl/kept_test.json` with `address` overridden by `config.programId` (the IDL's own address is never trusted). **Polyfills** (`src/polyfills.ts`: `react-native-get-random-values`, global `Buffer`) must load **before** web3.js/Anchor — `index.ts` imports them first.

### 9.5 The client API surface (`app/src/chain/`)
| Function | Notes |
|---|---|
| `connectWallet()` / `solBalance(owner)` | wallet.ts |
| `fetchKeeper(authority)` → `KeeperState \| null` | pure read |
| `refreshKeeper(authority)` | read + update the shared snapshot + log |
| `initKeeper(authority, tzOffsetMinutes)` | skips if a Keeper exists |
| `checkIn(authority, {questSlot, tier, proven})` | **currently generates a random proof hash internally — change the signature to accept the real `proofHash: Uint8Array(32)`** |
| `buySoul(authority, amount: bigint)` | the stand-in (no payment) |
| `recordOath(authority, success)` | self-reported counter |
| `shiftDay(authority, days)` | **DEBUG ONLY** |
| `derive(xpTotal)` | level/rank/progress (curve.ts) |
| `keeperPda`, `explorerTxUrl`, `explorerAddressUrl` | helpers |
| `KeeperState`, `KEEPER_FIELDS`, `formatField` | typed state; field order/labels |

Every write goes through `runWrite`: logs `TX <name> sent` (full args) → signAndSend → `TX confirmed` (signature + explorer link) → `ACCOUNT Keeper updated` (field diff) → `DERIVE` (level/rank change). Errors are logged **in full** with a plain-language line (§8.7), never swallowed.

### 9.6 The debug console (reusable dev tool)
`app/src/debug/`: categories `WALLET`, `TX`, `ACCOUNT`, `DERIVE`, `ERROR`; newest first; a **ring buffer of the last 500 entries persisted** in AsyncStorage (`kept-test/debug-log/v1`) so a crash never loses evidence; **Copy all** → plain-text log; **Clear**; a pinned panel showing every stored field (labelled *STORED ON CHAIN*) separately from the derived values (*DERIVED ON DEVICE*). Keep it in the real app behind a dev flag — it is how backend problems get diagnosed on real devices.

### 9.7 Notes for the UI developer
- **Don't hardcode** program ID / RPC / cluster — they come from `config.ts` (`.env`). All tunables are in `constants.ts`; keep `QUEST_SLOTS`, `TIERS`, `TIER_XP_LABEL`, `DAILY_XP_CAP_LABEL` in sync with `constants.rs` (they are display-only copies).
- The harness keeps selections (slot/tier/proven) in component state; switching tabs unmounts it and **resets them to defaults** (slot 0, "normal", proven). Use a store in the real UI.
- Show a progress state while a transaction is pending (approval + confirmation can take 5–20 s); never double-submit.
- A wallet with 0 SOL fails with a "no record of a prior credit" error — guide the user to fund the wallet.
- `src/chain/idl.ts` is a **stale, unused** hand-copied IDL; the real one is `chain/idl/kept_test.json` (+ `.ts` types) produced by `npm run sync-idl`. Delete `idl.ts` to avoid confusion.

---

## 10. Soul: earning, buying, spending

### 10.1 The rules
| | **XP** | **Soul** |
|---|---|---|
| Earned by | keeping promises (`check_in`) | keeping promises (1 per 10 XP *awarded*, floor per check-in) **and** buying |
| Spent? | **Never.** Permanent, only grows | Yes (spending/staking is **not built yet**) |
| Stored | `xp_total` (u64) | `soul_earned` (u64) + `soul_bought` (u64), **kept separate** |
| Drives | Level → Rank → Auras | the in-app economy |

**Hard rule:** only `soul_earned` may ever be staked on an Oath. If bought Soul could be staked, a rank/stake could be bought and the feature becomes gambling. Therefore the two balances are separate fields from day one. *Suggestion for the spend instruction (decision D3):* when a Keeper **spends** Soul, deduct from `soul_bought` first so earned Soul stays available for staking.

### 10.2 Earning
Inside `check_in` (§6.5): `soul_earned += awarded / 10`. The daily cap (600 XP) therefore caps earned Soul at **60/day**. A declared quest earns half.

### 10.3 Buying — there are **two implementations** today (decision D2: pick one)

#### Path A — legacy "coins": real Devnet SOL, verified by the Node backend (works, deployed, tested)
This is the original flow; it moves **real SOL** to the treasury and credits a **Postgres** balance. It is *independent of the on-chain Soul fields.*

```
Client                              Phantom                 Devnet                Node backend             Postgres
  │  build SystemProgram.transfer      │                      │                        │                       │
  │  (payer → TREASURY, lamports)      │                      │                        │                       │
  ├──────── signAndSend ─────────────► │ ── signs + submits ─►│                        │                       │
  │ ◄──────── signature ───────────────┤                      │                        │                       │
  │  waitForForeground(); POST /api/verify-sol-payment {signature, packageId} ───────► │                       │
  │                                                           │ ◄─ getTransaction ─────┤ (re-derive everything)│
  │                                                           │                        ├─ insert Payment + ───►│
  │ ◄───── {success, coinsAwarded, coinBalance} ──────────────────────────────────────┤   bump User.coinBalance│
```
**Server-side price table (the client never sends a price):** `mainbackend/src/config.ts`

| `packageId` | SOL | lamports | coins |
|---|---:|---:|---:|
| `small` | 0.01 | 10 000 000 | 100 |
| `medium` | 0.045 | 45 000 000 | 500 |
| `large` | 0.09 | 90 000 000 | 1 200 |

**The backend never trusts the client.** It accepts only `{signature, packageId}`; the payer, amount and recipient are **re-derived from the transaction on chain** (§11.3).
**Client requirements for Path A:** build the transfer for the package's *exact* lamports; sign with `minContextSlot`; **wait for the app to be foreground**; POST with a ≥ 60 s timeout; **retry on network errors and on HTTP 404** (the transaction may not be visible yet — we used 6 tries × 3 s); don't retry on 400/422; strip a trailing `/` from the base URL. In the Expo client the existing `signAndSend(payer, ix)` already accepts any instruction:
```ts
const ix = SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(TREASURY), lamports });
const signature = await signAndSend(payer, ix);                        // pre-simulates, signs, confirms
const res = await fetch(`${BACKEND}/api/verify-sol-payment`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ signature, packageId: "small" }),
});                                                                    // + retry on 404 / network error
```
*Where the working code is:* the legacy Kotlin harness only (`mobile-wallet-adapter-main/android/testharness`, §3.1). The Expo client has **no** Path A UI. ⚠ The Kotlin source currently on disk is an **older snapshot** (default backend URL `http://localhost:3000`) that lacks the P12/P13 fixes (foreground wait, retry, `minContextSlot`); a built APK that included them existed on 2026-10-03. Treat the harness as a reference for the flow, not as maintained code.
*Result observed:* the owner's wallet holds 500 coins in Postgres (from real purchases).

#### Path B — on-chain `buy_soul` (stand-in, **no payment**)
`buy_soul(amount)` just adds to `soul_bought` (§6.6). It exists to exercise the on-chain pipeline. **It is unsafe as-is** — anyone can call it for any amount.

### 10.4 What production should do (recommended)
**Make `buy_soul` take the payment inside the same instruction** (atomic: you cannot get Soul without paying, and no server is involved). Sketch (an earlier prototype compiled this against Anchor 1.2; note `CpiContext::new` takes the program's `Pubkey` in 1.x):
```rust
// constants.rs
pub const TREASURY: Pubkey = pubkey!("4AxmDUCWpC8F1aGL6ZsgyJoHfM3FDcK3AMbgMmcjD6jR");
pub const SOUL_PACKAGES: [(u64 /*lamports*/, u64 /*soul*/); 3] =
    [(10_000_000, 100), (45_000_000, 500), (90_000_000, 1_200)];

#[derive(Accounts)]
pub struct BuySoul<'info> {
    #[account(mut, seeds=[KEEPER_SEED, authority.key().as_ref()], bump=keeper.bump, has_one=authority)]
    pub keeper: Account<'info, Keeper>,
    #[account(mut)] pub authority: Signer<'info>,
    /// CHECK: only receives lamports; pinned to the treasury address.
    #[account(mut, address = TREASURY)] pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
pub fn buy_soul(ctx: Context<BuySoul>, package: u8) -> Result<()> {
    let (lamports, soul) = *SOUL_PACKAGES.get(package as usize).ok_or(KeptError::InvalidPackage)?;
    system_program::transfer(
        CpiContext::new(ctx.accounts.system_program.key(),
            Transfer { from: ctx.accounts.authority.to_account_info(), to: ctx.accounts.treasury.to_account_info() }),
        lamports)?;
    let k = &mut ctx.accounts.keeper;
    k.soul_bought = k.soul_bought.checked_add(soul).ok_or(KeptError::Overflow)?;
    Ok(())
}
```
Other options: **(2)** pay in an **SPL token (e.g. SKR)** with `anchor_spl::token::transfer` (needs token accounts + a mint constant). **(3)** keep Path A and have the backend *credit* Soul through an admin-signed instruction — needs a backend-held authority key plus an admin check in the program (more trust, more keys); only worth it if off-chain/fiat payment is required.
Rules for any option: **prices live on chain/server, never in client input**; consider making the treasury a config PDA so it can be rotated; update `idl`, tests (add a "payment actually moved" test and an "underpay is impossible" test), the client (`accountsPartial` gains `treasury` + `systemProgram`), and remove Path A or migrate its balances.

### 10.5 Spending and staking (not built)
There is **no instruction to spend Soul** and **no Oath staking.** Design constraint to carry forward: staking may only debit `soul_earned`.

---

## 11. The Node backend (`mainbackend/`)

### 11.1 What it is and how it is structured
Express 4 + TypeScript (ESM/NodeNext) + Prisma 6 (Postgres) + `@solana/web3.js` + Metaplex Bubblegum/Umi. Deployed on Render from GitHub `main`.

```
src/index.ts                  app: JSON body limit 5 MB, GET /health, mounts routers, binds 0.0.0.0:$PORT
src/config.ts                 ALL env-derived config + the coin price table (single place)
src/db.ts                     PrismaClient
src/solana.ts                 verifyTransactionOnChain(): the trustless payment check
src/routes/verifySolPayment.ts  POST /api/verify-sol-payment, GET /api/balance/:address  (wrapped: errors → 502)
src/routes/aura.ts            Helius webhook, manual sync, list, NFT metadata + art
src/routes/assetlinks.ts      GET /.well-known/assetlinks.json (Digital Asset Links for the wallet's identity check; see P40)
src/aura/{milestones,events,chain,curve,process,service,store,minter}.ts   Aura (see §12)
prisma/schema.prisma + migrations/     Payment, User, AuraMint
scripts/aura-setup.ts         one-time Aura bootstrap
test/aura.test.ts             13 tests
```
`package.json` scripts: `dev` (tsx watch) · `build` (= `prisma generate && tsc -p tsconfig.json`) · `start` (= `prisma migrate deploy && node dist/index.js`, so **migrations apply on every boot**) · `test` (`tsx --test test/*.test.ts`) · `aura:setup`.

### 11.2 Endpoints
| Method / path | Purpose | Auth |
|---|---|---|
| `GET /health` | liveness → `{"ok":true}` | none |
| `POST /api/verify-sol-payment` | legacy: verify a SOL payment and credit coins (§10.3A, §11.3) | none (trustless by construction) |
| `GET /api/balance/:address` | legacy coin balance → `{address, coinBalance}` (0 if unknown) | none |
| `POST /webhooks/helius` | Aura trigger (§12) | `Authorization: <WEBHOOK_SECRET>` else 401; 503 if Aura unconfigured |
| `POST /api/aura/sync/:wallet` | re-check one wallet and mint what it has earned (idempotent; retries FAILED) | none (public) |
| `GET /api/aura/:wallet` | list a wallet's Auras from the DB | none |
| `GET /aura/metadata/:id.json` | NFT metadata JSON (Metaplex standard) | none |
| `GET /aura/image/:id.svg` | placeholder artwork | none |
| `GET /.well-known/assetlinks.json` | Android Digital Asset Links (package `com.kept.backendtest` + signing-cert SHA-256), served uncompressed | none |

`POST /api/verify-sol-payment` body `{ "signature": "<base58>", "packageId": "small|medium|large" }`:
| Case | Status | Body |
|---|---:|---|
| Bad signature shape (base58, 64–90 chars) | 400 | `{"error":"Invalid signature"}` |
| Unknown package | 400 | `{"error":"Unknown packageId"}` |
| Already credited (retry/replay) | 200 | same success body + `"idempotent":true` — **no extra coins** |
| Transaction not found / not yet confirmed | 404 | `{"error":"Transaction not found or not yet confirmed"}` → **client retries** |
| Failed on chain / treasury absent / wrong amount | 422 | `{"error":"Transaction failed on-chain"}` / `"Treasury address was not involved in this transaction"` / `"Expected N lamports to the treasury, found M"` (⚠ **"found 0" means the *backend's* treasury config is wrong**, not that the user underpaid — see §15, P5) |
| RPC/DB failure | 502 | `{"error":"Temporary upstream error, please retry"}` (added in commit `5869c06`; previously this **crashed the process**) |
| Success | 200 | `{"success":true,"payerAddress","packageId","lamports","coinsAwarded","coinBalance"}` |

### 11.3 How a payment is verified (never trust the client)
1. Validate shape **before** spending an RPC call. 2. **Idempotency fast path:** if a `Payment` row with this signature exists, return it (200, `idempotent:true`). 3. `connection.getTransaction(sig, {commitment:"confirmed", maxSupportedTransactionVersion:0})`; `null` → 404. 4. `meta.err` must be null. 5. Find the **treasury** in `message.getAccountKeys().staticAccountKeys`; `received = postBalances[i] − preBalances[i]` must **equal** the package lamports (the balance delta can't be spoofed; instruction data could). 6. Payer = `accountKeys[0]` (the fee payer), **never** from the request. 7. One DB transaction: `Payment.create` (unique `signature`) **and** `User.upsert` with `coinBalance += coins` — atomic. 8. A concurrent duplicate hits Prisma `P2002` on the unique key and returns the idempotent success. *Limit:* transactions that reach the treasury only through an **address lookup table** are rejected (only static keys are read) — fine for a plain transfer.

### 11.4 Database (Neon Postgres via Prisma)
| Table | Columns | Notes |
|---|---|---|
| `Payment` | id, `signature` **unique**, payerAddress, packageId, lamports (BigInt), coinsAwarded, treasuryAddress, verifiedAt | the unique key is what makes a payment creditable exactly once |
| `User` | id, `walletAddress` **unique**, coinBalance, updatedAt | legacy coin balance |
| `AuraMint` | id, walletAddress, milestoneId, levelAtMint, `status` (MINTING\|MINTED\|FAILED), assetId?, mintSignature?, error?, createdAt, updatedAt; **`@@unique([walletAddress, milestoneId])`** | the unique key is what makes an Aura mint exactly-once |

Migrations: `20261003000000_init` (Postgres baseline; **SQLite was abandoned** — free hosts have ephemeral disks) and `20261003150000_aura_mint`. They run automatically at start. Local dev needs a Postgres URL (Neon works); **restart `npm run dev` after any schema change** (tsx watch keeps the old generated client in memory — P1).

### 11.5 Deployment on Render
- Web Service from GitHub `ekanshvcpkg/kept_backend`, branch `main`, **auto-deploy on push**. Build command `npm install && npm run build`; start command `npm start`; Node ≥ 20; **do not set `PORT`**. Set the env vars of §4.3. Health URL `/health`.
- **Free tier sleeps when idle; the first request takes ~30–50 s.** Wake it before demos/tests (`curl /health`) — a Phantom sign sheet times out at ~30 s, and clients need ≥ 60 s timeouts.
- Every push to `main` redeploys. (Settings above were configured by the owner and are *as intended*; the author could not see the Render dashboard.)

### 11.6 Run and test locally
```bash
cd mainbackend
npm install                       # npm 11 blocks dependency install scripts: approve Prisma/esbuild (package.json "allowScripts")
cp .env.example .env              # fill DATABASE_URL etc.
npm run dev                       # http://localhost:3000   (restart after prisma schema changes)
npm test                          # 13 passing
npx tsc --noEmit
```
Smoke: `curl localhost:3000/health` · `curl -X POST localhost:3000/api/verify-sol-payment -H 'content-type: application/json' -d '{"signature":"bad","packageId":"small"}'` → 400.

### 11.7 Security notes
- The **only private key** any server code holds is the Aura minter key (Devnet, mint-and-fees only). The treasury private key must **never** be given to the backend.
- All endpoints are public; there is **no rate limiting** (R8). `POST /api/aura/sync/:wallet` is idempotent and only mints what the chain says is earned, but each call performs RPC reads.
- No CORS is configured (native app). A web client would need it.
- Webhook auth is a shared secret compared in constant time (`timingSafeEqual`).

---

## 12. Aura: milestone NFTs

### 12.1 What it is
When a Keeper's **level** reaches a milestone, the backend **gifts a compressed NFT (cNFT) — an "Aura"** — into their wallet. cNFTs (Metaplex **Bubblegum**) are ~1000× cheaper than normal NFTs: they live as leaves in a **Merkle tree** account. Level is *derived* from on-chain XP, so Aura is a pure consequence of chain state; **the Node backend only reacts, it decides nothing.**

### 12.2 Milestones (`src/aura/milestones.ts` — the one place to edit)
| id | Name | Level | XP needed | Colour |
|---|---|---:|---:|---|
| `ember` | Ember Aura | 5 | 700 | #d98a3d |
| `flame` | Flame Aura | 10 | 2 700 | #e5533d |
| `azure` | Azure Aura | 20 | 10 450 | #3d8be5 |
| `violet` | Violet Aura | 35 | 31 450 | #9b5de5 |
| `radiant` | Radiant Aura | 55 | 76 950 | #f5c542 |

Symbol `AURA`, 0 % royalties. Same floors as ranks D…S. **Adding/changing a milestone:** edit the array; a *new* milestone is minted for already-eligible wallets on their **next check-in or sync**. Changing the **level curve** changes who is eligible (§7: keep both TS curves in sync).

### 12.3 The flow (exactly what happens)
```
user check_in (on chain) ──► Helius sees a tx touching the program ──► POST /webhooks/helius  (Authorization: secret)
   Node backend (answers 200 immediately, works in the background):
   1. signaturesFromWebhook(body)            — enhanced: item.signature ; raw: item.transaction.signatures[0]
   2. getTransaction(signature)              — RE-FETCH from Devnet; ignore the webhook body; skip if failed on chain
   3. parseCheckedInEvents(logs, programId)  — decode "Program data:" lines; ONLY lines emitted while OUR program is
                                               the innermost running program (log-stack check ⇒ no spoofing by other programs)
   4. fetchKeeperAt(keeperPda)               — read the Keeper ACCOUNT on chain; verify owner == program AND
                                               PDA == derive(authority); take xp_total from the ACCOUNT (not the event)
   5. level = levelFromXp(xp_total)          — backend curve copy
   6. for every milestone with level ≤ current: claim(wallet, milestone) → mint → record
```
The event is only a **trigger**; level comes from the chain account. Test: an event claiming 99,999,999 XP while the account says level 5 mints only Ember.

### 12.4 Exactly-once and failure semantics (`service.ts`, `store.ts`)
- **Claim first.** A row `(wallet, milestone)` is inserted as `MINTING` *before* minting. The unique key means a concurrent/duplicate request fails with `P2002` and **does not mint**.
- **Mint fails** (nothing minted) → row `FAILED` with the error text. The next sync/event **atomically flips FAILED→MINTING for exactly one caller** and retries.
- **Mint succeeds but recording fails** → the row **stays `MINTING` and is never auto-retried** (a retry would double-mint). Reconcile by hand (§12.8).
- **`assetId` is best-effort:** the mint signature is recorded; reading the asset id back (`parseLeafFromMintV1Transaction`) can fail right after confirmation and then stays `null` (this happened for Ember — the real id is known, §4.1). It must not fail the mint.
- **Known gap:** if the mint *confirmation times out* but the transaction actually landed, the row is `FAILED` and a retry would **mint a duplicate**. Before retrying such a row, check the minter wallet's recent transactions.

### 12.5 Setup (human steps, one time)
1. **Create the minter wallet and tree:** `cd mainbackend && npm run aura:setup`. ⚠ *Each run with a funded wallet creates another tree, so run it exactly twice in total (create wallet → fund → create tree).* First run creates `.aura-minter.json` (mode 600, gitignored) and prints the **public** address; it never prints the key. **Send it ~1 Devnet SOL** (`solana transfer <addr> 1 --url devnet --allow-unfunded-recipient`), run `npm run aura:setup` again → creates the Merkle tree (depth 14, buffer 64 ⇒ 16,384 mints; ≈ 0.16 SOL rent) and prints `AURA_MERKLE_TREE`.
2. **Render → Environment:** `AURA_MERKLE_TREE`, `AURA_MINTER_SECRET_KEY` (paste the file's contents; do **not** paste it into chat), `WEBHOOK_SECRET` (any long random string, e.g. `openssl rand -hex 32`), `KEEPER_PROGRAM_ID`. **Save** — Render redeploys.
3. **Helius dashboard → Webhooks → New webhook:** Network **devnet** · Type **enhanced** (raw also works) · Transaction type(s) **Any** (our program's txs don't match Helius' named types; a narrower filter would silently drop everything) · URL `https://kept-backend-bn75.onrender.com/webhooks/helius` · **Authentication Header = the exact `WEBHOOK_SECRET` value** (no `Bearer`) · **Account address = the program ID `6iXXBq…`**. Each push costs 1 Helius credit (free plan limits apply).
4. **Verify:** `curl -X POST …/api/aura/sync/<wallet>` returns `404 No Keeper` or a JSON result (**not** 503) ⇒ Aura is configured. `curl -X POST …/webhooks/helius` without the header ⇒ 401.

### 12.6 NFT metadata and art
Served **by the Node backend** (zero external hosting): `GET /aura/metadata/<id>.json` → `{name, symbol, description, image, seller_fee_basis_points, attributes:[{Milestone},{Level}], properties.files}`; `image` = `GET /aura/image/<id>.svg` — a generated **placeholder SVG** (a coloured circle + label). The on-chain NFT's `uri` points at this metadata URL (so the **Render URL is baked into every minted NFT** — changing hosts later means NFTs point to a dead URL unless metadata is updated or re-hosted). For production: host **PNG** art on durable storage (Arweave/IPFS/S3+CDN) and change `metadataUri()` in `minter.ts`.

### 12.7 Seeing an Aura
- **Solana Explorer** (verified): `https://explorer.solana.com/address/<assetId>?cluster=devnet` → "Metaplex Compressed NFT", name, symbol, owner, attributes.
- **API:** `GET /api/aura/<wallet>` → `[ {milestoneId, level, status, assetId, mintSignature, error} ]`.
- **DAS (Helius RPC):** JSON-RPC `getAssetsByOwner {ownerAddress, page, limit}` lists a wallet's assets incl. cNFTs (verified: returned the Ember Aura with `compressed:true`, tree `CZc39E…`).
- **Phantom:** the Aura is **not visible** in Phantom's home screen in Testnet Mode (only Tokens/Perps/Predictions shown). *Unverified cause:* Phantom likely doesn't index Devnet cNFTs and/or doesn't render SVG images. On mainnet with PNG art it should appear. Don't promise users it shows in Phantom on Devnet.

### 12.8 Operations / runbook
| Task | How |
|---|---|
| Is Aura on? | §12.5 step 4 |
| Re-check/retry one wallet | `curl -X POST <backend>/api/aura/sync/<wallet>` |
| See what a wallet has | `GET /api/aura/<wallet>` |
| A row is `FAILED` | Read its `error`; fix the cause (usually RPC/funds); call sync. If the error was a confirmation *timeout*, first check the minter wallet's history for a landed mint. |
| A row is stuck `MINTING` | The mint likely happened but recording failed (or the process died mid-mint). Check the minter's recent txs/DAS. If it minted: `UPDATE "AuraMint" SET status='MINTED', "assetId"='<id>', "mintSignature"='<sig>' WHERE id=<n>;` If it did **not**: `DELETE FROM "AuraMint" WHERE id=<n>;` then sync. |
| Backfill a missing `assetId` | Look it up with DAS `getAssetsByOwner`, then `UPDATE "AuraMint" SET "assetId"='…' WHERE …`. (Currently the Ember row has `assetId = null`.) |
| Minter out of SOL | Check `solana balance D546uX…`; top up (each mint costs a few thousand lamports + the tree already exists). Last seen 4.11 SOL. |
| Tree full | 16,384 leaves. `npm run aura:setup` creates a **brand-new tree on every run once the minter wallet holds ≥ 0.5 SOL** (≈ 0.16 SOL each) — so run it **only** when you actually need a new tree, never "just to check". Then update `AURA_MERKLE_TREE` on Render. Existing NFTs stay in the old tree and remain valid. |
| Rotate the webhook secret | Change `WEBHOOK_SECRET` in Render **and** the Helius webhook header together. |

### 12.9 Tests (`test/aura.test.ts`, 13 passing — in-memory store + fake minter, no DB/Solana needed)
level table matches the curve · milestones earned at their level, lowest first · **mints each milestone once, repeat mints nothing** · **concurrent syncs mint exactly once** · failed mint → FAILED → retried on next sync · **record-failure never causes a re-mint** · event parsing accepts only our program (spoof from another program and from an inner invoke rejected) · webhook signature extraction (enhanced/raw/junk) · **on-chain level wins over the event's XP** · failed/unknown tx mints nothing · `syncKeeper` reports derived level · secret-key parsing (with/without brackets, rejects bad input) · `assetlinks.json` lists our package with a well-formed fingerprint.
**Not covered by tests:** the real Bubblegum mint (proven by the live run, §14), the Prisma store against a real Postgres, the HTTP routes beyond a manual smoke test.

### 12.10 Why Bubblegum directly
Helius' hosted "Mint API" was **not documented** in the docs available during the build, so minting uses Metaplex **Bubblegum `mintV1`** through Umi with our own tree. The minter wallet is the tree creator/delegate and fee payer. Compile/run notes: Node ESM interop was verified by running the compiled `dist/` under plain Node (not just `tsx`).

---

## 13. Deploy and operate (runbook)

### 13.1 The on-chain program: build, test, deploy, upgrade
```bash
cd mainbackend/kept-example/program
npm install                       # test deps (litesvm, @anchor-lang/core, mocha, …)
anchor build --arch v2            # ⚠ v2: the sBPF version Devnet currently accepts (default build is rejected)
npm test                          # 14 passing  (needs target/deploy/kept_test.so from the build above)
cargo test                        # 3 passing
```
Deploy / upgrade (the signer must be the **upgrade authority** `FFAZ…` = the CLI wallet):
```bash
solana config set --url "<private devnet RPC url>"       # contains an API key: don't echo it
solana balance                                           # deploy needs ≈ 1–1.6 SOL (the temporary buffer rent is refunded; the program account keeps ≈ 0.76 SOL)
solana program deploy target/deploy/kept_test.so --program-id target/deploy/kept_test-keypair.json
anchor keys list                                         # prints the program ID
```
- If a deploy is interrupted the half-written **buffer keeps your SOL**: `solana program show --buffers`, then `solana program close <BUFFER_ADDRESS>`. (The current state: no leftover buffers.)
- **Production build** (no debug instruction): `anchor build --arch v2 -- --no-default-features`.
- If `anchor build` reports a **program ID mismatch**, run `anchor keys sync`, then build again.
- After a deploy: `cd ../app && npm run sync-idl`, restart Metro; set `KEEPER_PROGRAM_ID` on Render **only if the program ID changed**.
- `anchor build` creates `target/deploy/kept_test-keypair.json` — **back it up**; it is the identity of ID `6iXXBq…`.
- Mainnet note: use a **multisig** as upgrade authority (today it is a single laptop wallet).

### 13.2 The Node backend: deploy and roll back
- **Deploy:** `git push origin main` → Render builds (`npm install && npm run build`) and starts (`npm start`, which also applies Prisma migrations). Takes ~45–90 s; the first request after a deploy may be slow.
- **Verify:** `curl <backend>/health`; `curl <backend>/api/balance/<wallet>` (200 ⇒ DB connected); `curl -X POST <backend>/webhooks/helius` ⇒ 401.
- **Roll back:** revert the bad commit and push (Render redeploys), or use Render's dashboard to redeploy a previous build. Migrations are **additive** so far; a rollback of code does not drop tables.
- **Add a migration:** edit `schema.prisma`; generate SQL **without a database** using `npx prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql`; commit; the next boot applies it.

### 13.3 The end-to-end test on a phone (the exact procedure that proved the system)
Prereqs: §8.2 (Phantom on Devnet with SOL), backend awake, Aura configured (§12.5), program deployed.
```bash
cd mainbackend/kept-example/app
npm install && cp .env.example .env     # set EXPO_PUBLIC_RPC_URL (private), EXPO_PUBLIC_PROGRAM_ID
npm run sync-idl                        # copies program/target/idl into src/chain/idl
npx expo run:android                    # first time only: builds + installs the dev client on the USB phone
npm start                               # Metro; open the app on the phone and pick the server
```
In the app: **Connect wallet** → **Init Keeper** (skips if one exists) → **Check in** slot 0 / **epic** / proven ×3 on slots 0,1,2 (600 XP cap) → **Shift day +1** → check in again (slot 0 epic). Expected for a fresh wallet: 250 → 500 → 600 XP (cap), then +250 on the next day ⇒ **850 XP = level 5, rank D**, streak 2. Within ~20–60 s: `curl <backend>/api/aura/<wallet>` shows `ember … MINTED`; the Explorer link shows the cNFT owned by the wallet. (The owner's wallet was already at 325 XP; three more check-ins on a new day took it to 775 XP = level 5.)

### 13.4 Rotating secrets (do this before anything real)
1. **Helius key** → create a new key in the Helius dashboard; update `app/.env`, the Solana CLI config, Render `DEVNET_RPC_URL`; delete the old key.
2. **Webhook secret** → new random string in Render `WEBHOOK_SECRET` **and** the Helius webhook header (same time).
3. **Aura minter** → delete `.aura-minter.json`; run `aura:setup` (new wallet, fund, new tree); update `AURA_MERKLE_TREE` + `AURA_MINTER_SECRET_KEY` on Render. (Old NFTs stay valid.)
4. **Neon password** if the connection string was ever exposed.
5. Production: never ship an RPC key inside the app (use a backend proxy).

### 13.5 Handy debugging on the phone (what the author used)
```bash
adb devices
adb logcat -s ReactNativeJS:V                                   # JS logs from the app
adb logcat | grep -E "PhantomMWAModule|IdentityVerifier|LocalAssociationScenario"   # wallet-side truth
adb reverse tcp:3000 tcp:3000                                   # let the phone reach a local backend over USB
adb shell uiautomator dump /sdcard/u.xml && adb shell cat /sdcard/u.xml   # read on-screen text / button bounds (also lets you script taps)
adb shell dumpsys netpolicy | grep "UID=<app uid>"              # is Android blocking the app's network (APP_BACKGROUND)?
adb logcat | grep "NetdEventListenerService: DNS"               # DNS failures with isBlocked=true
```
Tip: never copy long base58 strings from screenshots — characters get misread; read text via `uiautomator` or the app's **Copy all** button.

---

## 14. Verified results (evidence)

| # | What was verified | How | When |
|---|---|---|---|
| 1 | Legacy purchase end-to-end: connect → pay 0.01 SOL → backend verifies on chain → "Bought 100 coins. New balance: 100" | real phone + Phantom + local then Render backend | 2026-10-03 |
| 2 | Render deployment healthy; Postgres connected | `/health`, `/api/balance/…` | 2026-10-03 |
| 3 | 4 payments stuck by P5/P12 recovered by re-POSTing signatures (balance 400); **replay returned `idempotent:true`, no double credit**; a later live purchase brought it to 500 | curl | 2026-10-03 |
| 4 | Program tests: **14/14** (LiteSVM) + **3/3** Rust; mutation (mask-before-streak) → 6 fail, restore → 14 pass | `npm test`, `cargo test` | 2026-10-03 |
| 5 | **Deployed program behaviour** (throwaway wallet): `init_keeper` (126-byte account, owner = program), `check_in` (xp 250 / streak 1 / soul 25 / mask 1), the **backend's event parser decoded the real log** (keeper matches PDA, `xp_total_after`=250), `debug_shift_day` present, `record_oath` present | scripts against Devnet via Helius | 2026-10-04 |
| 6 | **Phone run (owner's wallet):** Init skipped correctly; check-ins: XP 325→575 (streak 1→2, level 4), →675 (streak unchanged 2), →775 (**level 5, rank D**); the debug console showed exact field diffs; `oaths_completed/failed` rendered `0/0` after the IDL sync | adb-driven on the real device | 2026-10-04 |
| 7 | **Aura minted automatically** after the level-5 check-in: `GET /api/aura/<wallet>` → `{ember, level 5, MINTED, mintSignature …}`; Helius DAS `getAssetsByOwner` → "Ember Aura", compressed, tree `CZc39E…`, owner = the wallet; Solana Explorer shows "Metaplex Compressed NFT" | curl + browser | 2026-10-04 |
| 8 | Payment route no longer crashes on a dead RPC (502, process alive, 400/200 paths unchanged) | local run against `DEVNET_RPC_URL=http://127.0.0.1:1` | 2026-10-04 |
| 9 | Backend: `tsc` clean, `npm run build`, compiled `dist/` runs under plain Node, Bubblegum minter constructs (throwaway key), **13/13** tests | local | 2026-10-04 |
| 10 | App: `npx tsc --noEmit` clean; Metro bundles 750 modules | local | 2026-10-04 |

Backend commits on `main`: `4ea04e9` (Aura + treasury default) · `d80dc07` (bracket-tolerant secret key) · `e6810d3` (default program ID, duplicate test script) · `5869c06` (payment routes 502) · `8350e29`…`ba9ce43` (assetlinks route and the Phantom identity experiments, P40). *Render auto-deploys each push; the author confirmed `/health` and the unchanged routes after the last push but cannot see Render's build log.*

---

## 15. Problems we hit, and how each was fixed

> Format: **Symptom → Cause → Fix → Lesson.** IDs (`P#`) are referenced elsewhere in this file. Read this section before you debug anything — most failures here look like something else.

### A. Node backend and Render

**P1 — Server crashes `Cannot read properties of undefined (reading 'findUnique')` right after a schema change.**
Cause: `tsx watch` reloads only on `src/` changes. After `prisma migrate dev` regenerated the client, the running process still held the **old** Prisma Client without the new model. Fix: kill and restart `npm run dev` after **any** schema/migration change. Lesson: file-watch ≠ regenerated-client-watch.

**P2 — Balances would vanish on every cloud deploy.** Cause: the first version used SQLite (`file:./dev.db`); free Render/Railway disks are ephemeral. Fix: switched Prisma to **Postgres (Neon)**, deleted the SQLite migrations, created one Postgres baseline migration (SQL generated without a DB via `prisma migrate diff`). Lesson: Prisma migrations are provider-specific; they can't be reused across providers.

**P3 — Cloud build lacked `prisma`/`tsc`, or the Prisma client wasn't generated.** Fix: `prisma`, `typescript`, `@types/*` are in **`dependencies`**; `build` = `prisma generate && tsc`; `start` = `prisma migrate deploy && node dist/index.js` (tables exist before the server listens).

**P4 — Platform couldn't reach the server.** Fix: listen on `process.env.PORT`, bind **`0.0.0.0`**.

**P5 — *(the big one)* Every real purchase rejected: `422 "Expected 10000000 lamports to the treasury, found 0"` — while the SOL had left the wallet.**
Diagnosis: on chain the transaction clearly paid `4Axm…D6jR`. A plain SOL transfer has three accounts (payer, treasury, System Program `1111…`); "found 0" means the backend matched an account whose balance never changes — **the System Program** — i.e. its configured treasury was the placeholder `1111…`. Cause: **`TREASURY_ADDRESS` was not set in Render's Environment**, and `config.ts` fell back to the placeholder; `.env` is gitignored and never reaches Render. Fix: set the variable on Render and redeploy; hardened `config.ts` to default to the real public treasury and to treat an *empty* value as unset (`||`), log the treasury at startup, correct `.env.example`. Lesson: **every env var must be set on the host; check the startup log line `treasury …`.** "found 0" = server misconfiguration, not an underpayment.

**P6 — Paid but not credited.** Cause: while P5/P12 were active, transfers landed on chain but the backend never credited them. Fix: after the server was correct, **re-POST the signatures** (safe: the backend re-verifies on chain and the signature is unique). Find them with `getSignaturesForAddress(treasury)`. Recovered 4 × 100 coins; a repeat returned `idempotent:true`.

**P7 — Render free-tier cold start (30–50 s) vs Phantom's ~30 s sign-sheet timeout.** Fix: 60 s HTTP timeouts + retries on the client; ping `/health` before a demo. Lesson: never make the user wait on a sleeping backend inside a wallet approval.

**P8 — Trailing slash in the backend URL** (`…onrender.com/` → requests to `//api/…`). Fix: client trims `/` before appending paths.

**P9 — `npm install` skipped postinstall scripts (npm 11 blocks them by default); Prisma/esbuild misbehaved.** Fix: approve them (`npm install-scripts approve`), recorded in `package.json` → `allowScripts`.

**P10 — The payment route crashed the whole server process on any RPC/DB error** *(found while writing this document, 2026-10-04)*. Cause: Express 4 does not catch errors thrown in `async` handlers → unhandled rejection → Node exits (a Devnet HTTP 429 was enough). Reproduced with `DEVNET_RPC_URL=http://127.0.0.1:1`: the request got no response and the process died. Fix: wrap both handlers (`safe()`): log, answer `502 {"error":"Temporary upstream error, please retry"}`. Verified: 502, process alive, 400/200 paths unchanged. Commit `5869c06`. Lesson: **every async Express 4 handler needs a catch** (the Aura routes already had one).

**P11 — Repo hygiene: two `"test"` scripts in `package.json` (the second ran a deleted cargo suite) and a default `KEEPER_PROGRAM_ID` pointing at the abandoned, never-deployed `GmW838…` program.** Found while documenting; fixed in `e6810d3`. Lesson: when abandoning an approach, grep for its leftovers.

### B. Android and the wallet (Mobile Wallet Adapter)

**P12 — After Phantom confirmed, the app showed `Unable to resolve host "…onrender.com": No address associated with hostname`.** The host resolved fine from the phone's shell and the app had `INTERNET`. Real cause (from logcat): `NetdEventListenerService: DNS Requested by … (com.kept.testharness), 4(FAIL), isBlocked=true` and `dumpsys netpolicy` → `blocked=APP_BACKGROUND`. This phone **blocks network for backgrounded apps**, and Phantom was still in front when the app tried to call the backend. Fix: wait until the app is foreground (`AppState==='active'` / lifecycle `RESUMED`) before any network call after the wallet, and retry. Lesson: "can't resolve host" can be an OS policy, not DNS.

**P13 — `Failed establishing local association with wallet`** right after Phantom opened. Real cause (Phantom's JS log): zod error `params.minContextSlot — expected number, received undefined`. The library's default transaction params omit it. Fix: pass `minContextSlot` (a number) to `signAndSendTransactions`. Lesson: read the **wallet's** logs, not the library's exception text.

**P14 — Transient `ECONNREFUSED 127.0.0.1:<port>` for ~10 s on connect; Phantom opened but never prompted.** Phantom logged "scenario ready" but its local server wasn't actually listening (first run after an install). Not our code. Fix: relaunch app and Phantom, retry. Observed once; the second attempt connected.

**P15 — Red "This app's identity could not be verified. It may be impersonating another app."** Cause: Digital Asset Links — `identityUri`'s domain must serve `assetlinks.json` listing the package + signing-cert SHA-256 (§8.6). The served file lists `app.kept.mobile` and `com.kept.testharness`, **not `com.kept.backendtest`**. It's a warning only. Fix (human, owned by the UI team's Vercel): add the package + cert. *Unexplained:* even with a correct file and Google's API reporting `linked:true`, Phantom's check logged `DAL verification failed` for the legacy harness.

**P16 — Silent `reauthorize` dropped by Phantom for unverified apps.** Fix: do a **fresh `authorize` for every signing call** (§8.5). Cost: a connect sheet per transaction.

**P17 — *(legacy Kotlin harness only)* phone couldn't resolve `localhost`; plain HTTP blocked.** Fix: `adb reverse tcp:3000 tcp:3000` + `http://127.0.0.1:3000`, `android:usesCleartextTraffic="true"` — **test harness only, never in a real app.**

### C. Solana / Anchor: build, deploy, tests

**P18 — Public Devnet RPC rate-limit (HTTP 429 "Connection rate limits exceeded") stalled deploys and app reads.** Fix: use a **private Devnet RPC (Helius)** — `solana config set --url …`, `EXPO_PUBLIC_RPC_URL`, Render `DEVNET_RPC_URL`. Lesson: the free public endpoint is unusable for deploys from a shared/busy network.

**P19 — `Error: ELF error: Detected sbpf_version required by the executable which are not enabled` when deploying.** Cause: the default build targets an sBPF version Devnet hasn't enabled. Fix: **`anchor build --arch v2`** (also `cargo build-sbf --arch v2`). Verified that tests pass on both.

**P20 — An interrupted deploy left a half-written buffer holding ~0.79 SOL.** Fix: `solana program show --buffers` → `solana program close <buffer>` (the owner recovered it).

**P21 — `Program ID mismatch … Keypair file has X / Source code has Y`.** Fix: `anchor keys sync` (rewrites `declare_id!` and `Anchor.toml`), then rebuild.

**P22 — `TransactionExpiredBlockheightExceededError` after ~90 s on a transaction the program would reject (clicking **Init Keeper** on a wallet that already had a Keeper).** Cause: simulation says `Allocate: account … already in use` / `custom program error: 0x0`; the wallet's send is **silently dropped** (signature never on chain — `getSignatureStatuses` → `null`), so the app waited out the blockhash and reported a fake "expired". Fix: (1) `initKeeper` checks for an existing Keeper first and skips; (2) `signAndSend` **pre-simulates every transaction** and throws the real error before opening the wallet; (3) the "expired" message now says a program-rejected tx looks the same. Lesson: **"expired" can mean "rejected"** — always simulate first.

**P23 — Anchor 1.x API differences.** JS package is `@anchor-lang/core` (not `@coral-xyz/anchor`); `.accountsPartial({...})`; **u64 args must be `BN`** (a plain number throws `src.toArrayLike is not a function`); in Rust `CpiContext::new` takes the program's `Pubkey` (not an `AccountInfo`).

**P24 — Testing day logic without waiting a day.** Fix: **LiteSVM** (`litesvm` 1.5) — in-process VM with `setClock`. It is built on `@solana/kit`, not web3.js v1, so the test harness builds transactions with kit helpers and decodes accounts with `BorshCoder`.

**P25 — Spec bugs.** (a) The brief's "level 35 → 33,150 XP" contradicts its formula (=31,450); the formula is implemented. (b) The streak/mask **step 5/6 ordering** bug (mask written before the streak read ⇒ streak never advances) had shipped once; guarded by a dedicated test and verified by mutation (6 tests fail if reintroduced). It also proved itself on real hardware (same-day check-ins left the streak unchanged; the next day advanced it).

**P26 — Debug console showed `oaths_completed undefined`.** Cause: the app's IDL copy predated the oath fields (and Metro served a cached bundle). Fix: `anchor build` → `npm run sync-idl` → restart/reload Metro; the app's decode was verified against the live account (`oaths 0/0`). A stray hand-copied `src/chain/idl.ts` also exists; it is **unused and differs** from the real IDL — delete it.

**P27 — Deployed binary ≠ repo source.** The deployed program has `record_oath`; the repo source did not at the time, and a re-write of `record_oath.rs` from the deployed behaviour **overwrote another contributor's earlier file** (read-before-write was skipped). Behaviour matches on-chain probes (simulated post-state: byte 94 ↔ success, byte 96 ↔ failure). Lesson: put the program in git; **read a file before overwriting it**; rebuild from source and redeploy to make source canonical.

**P28 — The Expo template injected files nobody asked for** (`AGENTS.md`, `CLAUDE.md`, `LICENSE`, `.claude/settings.json` enabling a plugin). Removed.

### D. Aura

**P29 — Helius' hosted "Mint API" couldn't be found in its docs** → minting is done with **Bubblegum directly** (own Merkle tree + minter wallet).

**P30 — Double-mint hazard found by writing a test.** The first draft marked a row `FAILED` if *recording* a successful mint failed — a retry would mint again. Fix: separate the two steps; a successful mint whose record write fails leaves the row `MINTING` (never auto-retried). Documented known gap: confirmation timeout on a mint that actually landed (§12.4).

**P31 — `AURA_MINTER_SECRET_KEY` pasted into Render without its `[ ]`** (it appeared as a bare comma-separated list of numbers instead of a bracketed JSON array). `JSON.parse` would have thrown at first mint. Fix: tolerant parser (brackets optional) + validation (exactly 64 bytes 0–255) + test.

**P32 — Helius webhook form pitfalls.** *Transaction type must be "Any"* (our program's txs have no Helius-named type); *Authentication Header* must be exactly `WEBHOOK_SECRET` (no `Bearer`); *Account Addresses* must contain the **deployed program ID** (so the webhook can't be completed before the program exists); each push costs a credit.

**P33 — `AuraMint.assetId` is `null` for the first mint.** Reading the leaf back right after confirmation failed (best-effort by design). The NFT exists (DAS/Explorer). Backfill by SQL (§12.8) or add a retry in `minter.ts`.

**P34 — The Aura doesn't show in Phantom (Devnet / Testnet Mode).** Likely Phantom doesn't index Devnet cNFTs and/or doesn't render SVG art. Verified via Explorer + DAS instead. Production: mainnet + PNG art.

**P35 — Render env changes only take effect after "Save" (which redeploys); Aura stays 503 until all four vars exist.**

### E. Process and collaboration

**P36 — Multiple contributors (and AI sessions) edited the same folders concurrently**, with no git for `kept-example/`: a prior program folder was deleted, a Kotlin harness was reverted to an older copy, one file was overwritten. Fix: **make `kept-example` a git repo**, small commits, re-read files before editing, one writer per file area.

**P37 — Secrets appeared in chat and screenshots** (a Helius key, the webhook secret, the first bytes of the minter key). Treat as compromised; rotate (§13.4). Prefer clipboard commands (`pbcopy < file`) over displaying secrets.

**P38 — Human-step slips.** Pasting env lines like `AURA_MERKLE_TREE=…` into a terminal → "command not found" (they are dashboard settings, not commands); zsh globbing breaks `grep --include=*.ts`; long signatures mistyped from screenshots → "WrongSize". Documented in §13.5.

**P40 — Phantom shows a Connect sheet before every transaction, and keeps saying "identity could not be verified", even though `assetlinks.json` is correct.** *(Investigated at length on 2026-10-04; UNSOLVED. Do not repeat these experiments.)*
- *Why the prompts happen:* Phantom refuses silent `reauthorize` for an app whose identity it cannot verify (log: `onReauthorizeRequest` immediately followed by `IdentityVerifier: DAL verification failed for <identity URI> (caller=com.kept.backendtest): Could not verify package com.kept.backendtest`). The app then falls back to a full `authorize` ⇒ Connect sheet.
- *Fixed on the way:* the app now **remembers the wallet** and restores it on launch (no popup when opening the app).
- *What was verified:* the signed app's cert is `FA:C6:17:45:…:3B:9C` (Expo's default debug keystore; `apksigner verify --print-certs` on the installed APK); the backend now serves `GET /.well-known/assetlinks.json` (package `com.kept.backendtest` + that fingerprint) and **Google's Asset Links API returns `linked:true`** for `https://kept-backend-bn75.onrender.com`; **Phantom does fetch the file** (a request with `User-Agent: Dalvik/2.1.0 … SM-S901E`, `Accept-Encoding: gzip, br` arrived at the exact second of each failure); Phantom's APK contains its own `AssetLinksJSONParser` with messages such as "At least one relation must be present", "Ill-formatted certificate fingerprint", "Invalid Android app certificate fingerprint", "package_name is invalid".
- *What was tried and did NOT help:* (1) pointing the identity at the Render domain instead of `keptdapp.vercel.app` (both fail, so it is not the domain); (2) serving the file uncompressed (`Cache-Control: no-transform`, `Content-Encoding: identity`) because the CDN answers Brotli to `gzip, br`; (3) listing the fingerprint in several spellings (this can actually *break* Phantom's strict parser — don't).
- *Not yet tried:* a **release-signed, non-debuggable build** and/or a **non-default keystore** (both failing apps so far — `com.kept.testharness` and `com.kept.backendtest` — were debug-signed with a publicly known debug key; a verifier may refuse those); testing whether Phantom verifies the UI team's `app.kept.mobile`; the same test on a different phone/Phantom version.
- *Practical conclusion:* do not depend on silent re-authorization. To stop asking the wallet for **XP-type actions**, use **session keys** (§16, decision D9): the user approves once, the app signs `check_in` with a temporary delegate key, and the wallet is only involved for payments.
- *Leftovers:* the route `src/routes/assetlinks.ts` stays (harmless, public data); the app's `.env` identity is back to `https://keptdapp.vercel.app`.

**P39 — The UI harness resets selections when switching tabs** (state lives in an unmounting component). Use a store in the real UI.

---

## 16. Known gaps, risks and open decisions

### 16.1 Risks (ranked; **R1–R3 block any real-user launch**)
| ID | Risk | Detail / mitigation |
|---|---|---|
| **R1** | **`buy_soul` takes no payment.** | Anyone can credit themselves unlimited Soul. Replace per §10.4 (payment inside the instruction). Until then do not treat `soul_bought` as money. |
| **R2** | **`debug_shift_day` exists in the *deployed* program.** | A user-settable day lets anyone farm streaks and the daily cap. Redeploy a build **without** the `debug-tools` feature; remove the UI button. |
| **R3** | **`record_oath` is unguarded and self-reported; there is no Oath system.** | The counters are meaningless as reputation until oaths are real accounts with stakes, members, resolution (and only `soul_earned` staking). |
| R4 | `proven` is **client-asserted**; the chain cannot verify a photo. | A modified client can claim full XP. Damage per wallet is bounded by the 600 XP/day cap, but wallets are free (sybil). Options: an off-chain verifier that signs an attestation the program checks (ed25519), spot audits using the stored hashes, social/oath layers. |
| R5 | `tier` is chosen by the client. | The chain doesn't know a quest's real difficulty; cap bounds abuse. Consider server-side quest definitions. |
| R6 | `tz_offset_minutes` is fixed at init. | No DST/travel handling; wrong tz is permanent. Consider a rate-limited `set_timezone` (e.g. once per 30 days). |
| R7 | The level curve exists in **two TS files** (app + Aura). | They must stay identical (D4). A drift would show a different level in the UI than the one Aura uses. |
| R8 | **No authentication / rate limiting** on the backend. | `POST /api/aura/sync/:wallet` and the legacy endpoints are public. Add rate limits (and optionally a signed-message proof for sync). |
| R9 | **Aura depends on webhook delivery; there is no reconciler.** | A missed webhook ⇒ no Aura until the user's next check-in or a manual sync. Add a scheduled sweep (`getProgramAccounts` filtered by the Keeper discriminator → `syncKeeper`), plus alerting on `FAILED`/stuck `MINTING`. |
| R10 | Free-tier fragility: Render sleeps (cold start), Helius free credits, Neon free limits. | Move to paid/always-on before launch; webhook retries are Helius' responsibility. |
| R11 | **NFT metadata is hosted on the Render backend and baked into each NFT's URI.** | If the host changes/sleeps, wallets may fail to load images. Host PNG art + JSON on durable storage; SVG is poorly supported. |
| R12 | **Secrets exposure history** (Helius key, webhook secret, part of the minter key). | Rotate (§13.4). `EXPO_PUBLIC_*` keys are inside the app bundle — use an RPC proxy in production. |
| R13 | **The Rust source of the deployed program is in no pushed repo**; deployed binary ≠ local build. | Put `kept-example` in git; rebuild with `--arch v2`; upgrade; make source canonical (§6.12). |
| R14 | Single laptop wallet is the **upgrade authority** (0.004 SOL). | Back up; use a multisig on mainnet; top up before deploys. |
| R15 | Duplicate-mint gap on confirmation timeout; `assetId` may be null; stuck `MINTING` rows need manual care. | §12.4, §12.8. |
| R16 | Soul cannot be **spent**; no shop/staking. | Economy is half-built. |
| R17 | Quests (names, slots) live only on the device. | Losing/reinstalling loses quest definitions; XP on chain survives. Decide whether to sync quests (encrypted) via the backend. |
| R18 | **Two purchase systems / two balances** (Postgres coins vs on-chain Soul). | D2. |
| R19 | No monitoring/metrics/alerts; only Render logs. | Add logging/alerting before launch. |
| R20 | Devnet only. | No mainnet readiness work has been done (program audit, upgrade policy, key custody, costs). |
| R21 | Identity warning remains for `com.kept.backendtest`. | Needs the UI team's `assetlinks.json` update (§8.6). |

### 16.2 Decisions the team must make
| ID | Decision | Notes |
|---|---|---|
| **D1** | **Which on-chain program is canonical for the merged app?** `kept_test` (this work) vs the UI team's `kept_system` (different program ID, different Keeper layout; appeared to store level/rank on chain). | The two are **not compatible**. Align on one before merging; this backend (Aura trigger, Node decoder, client chain layer) is written for `kept_test`. |
| **D2** | One Soul purchase path. | Recommended: on-chain atomic payment (§10.4); retire Postgres coins (migrate or drop). |
| **D3** | Soul spend/stake rules. | Suggest: spend `soul_bought` first; only `soul_earned` may be staked. |
| **D4** | One source for the level curve. | e.g. a tiny shared package, or have the backend expose `/api/progress` and the client fetch constants. |
| **D5** | Should Auras be transferable? | They are ordinary transferable cNFTs today. A milestone badge may need to be soulbound (non-transferable). Also: art, naming, rarity, and whether Devnet Auras carry over. |
| **D6** | Should `check_in` accept an off-chain attestation for `proven`? | See R4. |
| **D7** | Where do quest definitions live? | R17. |
| **D8** | Repo layout: where the Rust program, the client and the backend live; who owns `assetlinks.json`. | §3.1. |
| **D9** | **Stop prompting the wallet for XP actions: session keys (delegate signer).** | Every on-chain write needs the owner's signature, so each `check_in` currently opens Phantom (Connect + Confirm). Design: a `Session` PDA `[b"session", keeper]` holding `delegate` + `expires_at`; `start_session` (owner signs once, may also fund the delegate ~0.01 SOL for fees) / `end_session`; `check_in` accepts the owner **or** a valid, unexpired delegate; **never** `buy_soul`. The delegate key lives on the device (SecureStore in production). Breaking change to `check_in`'s accounts ⇒ upgrade the program + tests + client + docs. Payments (`buy_soul`/Path A) keep using the wallet. |

---

## 17. Suggested plan for Part 2 (merge + hardening)

1. **Decide D1** (canonical program). Everything else depends on it.
2. **Put `kept-example` under git** (or move `program/` and `app/` into proper repos); commit; protect secrets via `.gitignore` (already set for `.env`, `android/`, `target/`).
3. **Rebuild the program from source** (`anchor build --arch v2 -- --no-default-features` for a production-style build), **upgrade the Devnet deployment**, so source = deployed and `debug_shift_day` is gone (R2, R13). Keep a separate debug build for testers if needed.
4. **Real `buy_soul` with payment** (R1) + tests; update the client; decide the fate of Path A (D2).
5. **Real proof hash** in the client (§9.1h) and a plan for `proven` verification (D6).
6. **UI integration:** reuse `app/src/chain/` (wallet/keeper/errors/config/curve/debug) unchanged; build screens on `KeeperState` + the derivations of §9.1. Change `checkIn()` to take the real proof hash.
7. **Backend hardening:** rate limiting, a periodic Aura reconciler, alerting, retry for `assetId`, durable PNG art + metadata hosting, move the RPC key behind a proxy.
8. **Oaths and Soul spending** as real on-chain accounts (design with the earned-only staking rule).
9. **Mainnet checklist:** audit, multisig upgrade authority, key custody, cost model (rent, mint fees, RPC/webhook plans), data migration.

---

## 18. Appendix

### 18.1 Command cheat sheet
```bash
# --- program ---
cd mainbackend/kept-example/program
anchor build --arch v2 && npm test && cargo test
solana program deploy target/deploy/kept_test.so --program-id target/deploy/kept_test-keypair.json
solana program show 6iXXBqsdiCnUTSVf8CW3Uuw8c7iYvZSj5haz64QMuMUh
# --- client ---
cd ../app && npm run sync-idl && npx tsc --noEmit && npx expo run:android   # then: npm start
# --- backend ---
cd mainbackend && npm run dev | npm test | npx tsc --noEmit | npm run build
git push origin main                                  # deploys to Render
# --- aura ---
npm run aura:setup                                    # run exactly twice in total (§12.5)
```

### 18.2 curl examples (live backend)
```bash
B=https://kept-backend-bn75.onrender.com
curl -s $B/health                                              # {"ok":true}
curl -s $B/api/balance/BsUYmyoW44ZchgLqUntHQx98QGJt5DLkRzyTMQFYFdm9
curl -s $B/api/aura/BsUYmyoW44ZchgLqUntHQx98QGJt5DLkRzyTMQFYFdm9
curl -s -X POST $B/api/aura/sync/BsUYmyoW44ZchgLqUntHQx98QGJt5DLkRzyTMQFYFdm9
curl -s $B/aura/metadata/ember.json
curl -s -X POST $B/api/verify-sol-payment -H 'content-type: application/json' -d '{"signature":"bad","packageId":"small"}'   # 400
```
Example `sync` result (wallet at level 3, nothing due): `{"wallet":"6YVj…","level":3,"xpTotal":"250","outcomes":[]}`. Example list: `{"wallet":"BsUY…","auras":[{"milestoneId":"ember","level":5,"status":"MINTED","assetId":null,"mintSignature":"4UpkVr…","error":null}]}`.

### 18.3 File index of `kept-example`
```
kept-example/
├── README.md                              build / test / deploy / run
├── program/
│   ├── Anchor.toml  Cargo.toml  package.json  tsconfig.json
│   ├── programs/kept_test/Cargo.toml      features: default=["debug-tools"]
│   ├── programs/kept_test/src/            lib.rs constants.rs state.rs errors.rs events.rs day.rs instructions/*.rs
│   ├── tests/kept_test.ts                 14 LiteSVM tests
│   └── target/                            build output (gitignored): deploy/kept_test.so, deploy/kept_test-keypair.json 🔐, idl/kept_test.json, types/kept_test.ts
└── app/
    ├── App.tsx  index.ts  app.json  package.json  .env.example  .env 🔐(gitignored)
    ├── scripts/sync-idl.js                copies the IDL/types from program/target into src/chain/idl
    └── src/
        ├── config.ts  constants.ts  polyfills.ts
        ├── chain/ connection.ts program.ts pda.ts wallet.ts keeper.ts errors.ts idl/ (idl.ts = stale, unused)
        ├── progress/curve.ts              level + rank (client copy)
        ├── debug/ logStore.ts log.ts DebugConsole.tsx
        └── screens/ WalletScreen.tsx TestHarness.tsx      ← replace these with the real UI
```

### 18.4 Glossary
**Keeper** — a user's on-chain profile account. **Quest** — a daily promise (client-side; chain sees only a slot 0–7). **Check-in** — one kept promise. **Proven / declared** — photo-backed (full XP) vs self-declared (half XP). **XP** — permanent progress; never spent. **Soul** — currency; *earned* (stakeable) vs *bought* (not). **Level / Rank** — derived from XP (E…S). **Streak** — consecutive local days with ≥ 1 check-in. **Aura** — milestone cNFT gifted at a level. **PDA** — program-derived address. **Anchor / IDL** — Solana program framework / the generated interface description. **MWA** — Mobile Wallet Adapter. **cNFT / Bubblegum / Merkle tree** — compressed NFT standard and the tree that stores its leaves. **DAS** — Digital Asset Standard RPC (asset queries). **Helius** — RPC + webhook provider. **LiteSVM** — in-process Solana VM for tests.

### 18.5 Rules of engagement for the next AI
1. **Devnet only. No real money.** Never move funds you weren't asked to move.
2. **Never print, paste or commit secrets** (§4.2). Use `pbcopy`/env files; don't `cat` key files.
3. **Re-read a file before you edit it** — several contributors work in these folders (P27, P36). Prefer small, reviewable commits; get `kept-example` into git first.
4. **Don't claim what you didn't verify.** Test on the real device/Devnet; keep the *verified vs unverified* distinction used here.
5. **Run the tests after every change** (`program: npm test && cargo test` · `backend: npm test && npx tsc --noEmit` · `app: npx tsc --noEmit`).
6. **Respect the core principle:** store only what can't be recomputed; derive the rest; never store photos/text; keep `soul_earned` and `soul_bought` separate.
7. **Pushing to `main` deploys to production-ish Render.** Verify before pushing; check `/health` after.
8. **Update this file** when behaviour, addresses, env vars or decisions change, and add new problems to §15.

*End of Backend Part 1. Part 2 is the merge with the UI and the production hardening — start from §16 and §17.*
