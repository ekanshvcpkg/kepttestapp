# Kept Backend — Build Log

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
