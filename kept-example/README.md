# KEPT V4 Devnet prototype

KEPT is a wallet-connected daily-commitment app. A person creates a Solo or group Oath around a goal, chooses an activity object and a 3, 7, or 14-day duration, and checks in once per day by matching a daily object-and-gesture target. Group Oaths stake test SKR on Solana Devnet; successful members recover their stake and share broken members’ stakes, while the configured fee and rounding dust go to the treasury.

The repository includes an Anchor program, an Express/Prisma backend, and an Expo Android app. This is a prototype/test harness, not a production launch.

## What it can do now

- Connect an Android wallet through Mobile Wallet Adapter and sign in with a signed wallet challenge. The backend issues a short-lived bearer session.
- Gate backend features on Genesis Token eligibility. Real checking uses Token-2022 group membership; `SGT_MOCK` plus `SGT_MOCK_ALLOWLIST` is available for local Devnet prototyping.
- Create Solo or group Oaths, with 3/7/14 days, an activity object, goal hash, and optional SKR stake. Invite links and QR codes let other eligible wallets join before the creator starts the Oath.
- Start/cancel Oaths, view membership and daily check-in grids, submit verifier-authorized proof transactions, settle Oaths, and claim refunds or payouts.
- Run a single-use 5,000 SKR test faucet, register Android push tokens, nudge a group member, and view member proof photos while the Oath is available.
- Migrate legacy V3 Keeper PDAs in place. Existing XP/Soul fields are not part of V4 product behavior.
- Inspect API calls, wallet transactions, forced debug detections, and settlement previews in the app’s persistent debug console.

Oath terms and token custody are enforced by the program. Goal text is stored by the backend after its SHA-256 is matched against the Oath’s on-chain goal hash. Photos are stored privately by the backend and cleaned up after settlement; only their hash is passed to the program.

## Current limitations

- There are no bundled on-device object-detection or gesture-recognition model weights. A development-only “Force detection pass” fabricates a target match so the verifier flow can be exercised. Release builds do not produce detections, so end-to-end camera proof requires adding and validating real models.
- Genesis eligibility can be mocked for an explicit allowlist. Real deployments need the correct Token-2022 group address and eligible Genesis assets.
- Push delivery requires a valid Firebase service-account JSON and device setup. FCM delivery has not been validated against a configured production project.
- `npm run v4:setup` creates the Devnet Token-2022 mint and initial faucet supply, or updates an existing config’s treasury ATA; it spends the config admin’s Devnet SOL. No external Devnet deployment or setup transaction is performed by this repository change.
- The app targets Android/Mobile Wallet Adapter. Set a reachable backend URL (for an Android emulator, `10.0.2.2`; for a phone, your machine/server LAN URL).

## Prerequisites

- Node.js 20+, npm, Rust stable, Solana CLI, and Anchor 1.2.0.
- PostgreSQL for the backend.
- Android Studio/SDK and a physical Android device or emulator with a Mobile Wallet Adapter wallet. Expo Go is not sufficient because the wallet adapter needs a native development build.
- A Devnet RPC endpoint and a funded Devnet upgrade-authority/admin wallet. A private RPC is recommended.

## Build and test the program

```bash
cd kept-example/program
npm install
rm -f target/deploy/kept_test.so
cargo build-sbf --tools-version v1.57 --arch v3 --sbf-out-dir target/deploy
npm test
cargo test -p kept_test
```

The release profile optimizes for smaller bytecode (`opt-level = "z"`). The
SBPFv3 target matches the architecture currently running on Devnet. For a
build that rejects the short-day debug setting:

```bash
rm -f target/deploy/kept_test.so
cargo build-sbf --tools-version v1.57 --arch v3 --sbf-out-dir target/deploy --no-default-features --features init-if-needed
```

The checked-in program ID is `6iXXBqsdiCnUTSVf8CW3Uuw8c7iYvZSj5haz64QMuMUh`. Preserve the existing `target/deploy/kept_test-keypair.json`; it must resolve to this program ID. Upgrade using the on-chain upgrade authority. Do not generate a replacement program keypair.

## Create Devnet token/config

From the repository root, configure `.env` from `.env.example`, set `ADMIN_KEYPAIR` if the admin is not `~/.config/solana/id.json`, and supply the existing program upgrade authority. Then:

```bash
npm run v4:setup
```

The treasury owner defaults to `52eWttmzYBJn4awLjEMB42bw5oTFvL4XC1gDqFAQgPxJ`. The script creates that wallet’s associated token account (ATA), routes protocol fees and rounding dust there, and prints `TREASURY_TOKEN_ACCOUNT`; put the printed token-account address in the backend and app environments. The initial 5,000,000 test SKR supply goes into the admin wallet’s separate faucet ATA, so faucet funds are not placed in the treasury. Initial config creation sets the fee at 10%; updating an existing config changes only the treasury and requires its configured admin. For an existing deployment, first build and upgrade the program to include `update_treasury`, then run `npm run v4:setup` with that admin keypair. This changes future fees only; already settled funds remain in the prior treasury. The setup script does not send or move any real-world money: SKR here is a Devnet test token.

## Start the backend

From the repository root:

```bash
cp .env.example .env
# Edit DATABASE_URL, secrets, RPC, mint, treasury token account, Genesis settings, and proof storage.
npm install
npx prisma migrate deploy
npm run build
npm run dev
```

`SESSION_SECRET` must be a long random secret. `VERIFIER_SECRET_KEY` and `FAUCET_SECRET_KEY` are JSON arrays for Solana keypairs: verifier authority and faucet token owner respectively. Never commit these values. Keep `PROOF_STORAGE_DIR` on persistent private storage with enough room for incoming photos; the service deletes photos after settlement. `FCM_SERVICE_ACCOUNT_JSON` is the complete service-account JSON value. If testing with mocked Genesis eligibility, configure `SGT_MOCK=true` and a comma-separated `SGT_MOCK_ALLOWLIST`.

## Run the Android app

```bash
cd kept-example/app
cp .env.example .env
# Set the backend URL, program ID, stake mint, treasury account, and app identity.
npm install
npm run sync-idl
npm run typecheck
npx expo run:android
```

The app uses the backend for sign-in, Genesis gating, invites, proof verification, photos, nudges, push registration, and faucet. Wallet-signed Anchor transactions perform Oath creation/join/start/cancel/settlement/claims directly on Devnet.

## Main components

- `kept-example/program/programs/kept_test`: Anchor V4 Oath program and Keeper migration.
- `src`: authenticated API, Genesis eligibility, verifier transactions, proof storage, invites, nudges, FCM reminders, settlement watcher, and faucet.
- `kept-example/app/src`: Expo Android client, Solana instructions, wallet integration, product harness, and debug console.
- `legacy/` and `kept-example/legacy-app/`: retained V3/Aura implementation for reference; not mounted by the V4 backend/app.
