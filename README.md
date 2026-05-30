# BrandBlitz — Stellar Edition

**The attention quality marketplace.** Brands pay for proof of understanding. Users earn USDC for demonstrating it.

---

## Table of Contents

- [The Problem](#the-problem)
- [The Insight](#the-insight)
- [What BrandBlitz Does](#what-brandblitz-does)
- [Value to Brands](#value-to-brands)
- [Value to Users](#value-to-users)
- [How It's Different](#how-its-different)
- [The Platform's Network Effect](#the-platforms-network-effect)
- [For Drips / Stellar Ecosystem](#for-drips--stellar-ecosystem)
- [Architecture Overview](#architecture-overview)
- [Monorepo Structure](#monorepo-structure)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start (Docker)](#quick-start-docker)
- [Quick Start (Local)](#quick-start-local)
- [Running Tests](#running-tests)
- [Environment Variables](#environment-variables)
- [Services & Ports](#services--ports)
- [E2E](#e2e)
- [Game Flow (Technical)](#game-flow-technical)
- [Stellar Integration](#stellar-integration)
- [Anti-Cheat](#anti-cheat)
- [Scoring](#scoring)
- [Deployment (Production)](#deployment-production)
- [Workspace Scripts](#workspace-scripts)
- [Packages](#packages)
- [Further Reading](#further-reading)
- [Operations Runbooks](#operations-runbooks)

---

## The Problem

### For Brands

Digital advertising is broken in two specific ways:

**1. You're paying for fraud and passivity.**
$140 billion in global ad spend is lost to fraud every year. Up to 50% of programmatic traffic is bots. Of the humans who do see an ad, 76% don't remember viewing it at all. The industry standard metric — the impression — measures whether a pixel loaded, not whether anyone cared.

**2. You can't advertise a brand people don't know.**
Platforms like Brave Ads reward users for viewing ads, but only for brands that already have recognition. If you're a new Stellar ecosystem project trying to reach your first 10,000 users, passive ad views teach nobody anything. You pay for exposure to people who scroll past.

### For Users

Every "earn crypto" product pays fractions of a cent for passive attention. Watch an ad: $0.001 BAT. Stare at a banner: near zero. The model treats users as eyeball inventory, not as people with skills worth rewarding.

---

## The Insight

**Active engagement generates 17x more purchase intent than passive ads** (YouGov / Neuro-Insight research). Interactive quiz formats produce **80–91% brand recall uplift**. Branded live trivia achieves **91% sponsor recall**.

The research is clear: *learn-then-test* is categorically better than *see-and-forget*. But no one has wired it to real money payouts — until now.

---

## What BrandBlitz Does

BrandBlitz is a **skill-validated attention marketplace** built on Stellar USDC. The mechanic has three steps:

```
1. WARM-UP (30–60s)
   User sees the full brand story: logo, tagline, product image,
   brand description, USP. The "Start Challenge" button is locked
   server-side for a minimum of 20 seconds — guaranteed exposure.

2. CHALLENGE (45s across 3 rounds × 15s each)
   Round 1 — Tagline recognition: show the logo, pick the correct tagline
   Round 2 — USP match: show the brand name, identify what makes it unique
   Round 3 — Product recognition: show the product image, name the brand
   Faster correct answers score higher (100 base + 0–50 speed bonus per round).

3. PAYOUT
   Top scorers receive proportional USDC shares from the brand's prize pool.
   Settlement is atomic on Stellar — 3–5 second finality, ~$0.0007 fee.
```

Any user who pays attention during warm-up has every answer they need. The challenge rewards **attention and recall speed** — both provably skill-based.

---

## Value to Brands

### What brands actually buy

BrandBlitz does not sell impressions, clicks, or views. It sells **verified attention seconds** — the emerging IAB/Adelaide AU measurement standard for 2025.

When a brand deposits $100 USDC:
- Every player completed the warm-up (minimum 20s, enforced server-side — not a client timer)
- Every player attempted all 3 rounds testing recall of brand content they just saw
- Scores objectively measure which parts of the brand message landed
- High scorers are self-identified, high-intent audience segments

**This is auditable, first-party data that no other ad format produces.**

### Brand lift benchmarks (research-backed)

| Format | Recall Uplift |
|---|---|
| Standard display ad | 4–8 percentage points |
| Standard video | Baseline |
| Interactive streaming ad | +36% vs standard video (BrightLine 2024) |
| Branded live trivia | **91% sponsor recall** (West Coast Fever / Komo) |
| Interactive quiz (YouGov FreeWall) | **80–86% brand recall uplift** |
| BrandBlitz warm-up + challenge | Architecturally comparable to interactive formats |

### What the brand dashboard shows

After a challenge ends, brands get real data on **attention quality** — not vanity metrics:

- Warm-up completion rate (% who stayed the full 20s+)
- Challenge completion rate (% who finished all 3 rounds)
- Round-by-round accuracy (which brand messages actually landed)
- Score distribution histogram (were the messages clear or confusing?)
- Cost per verified attention session = pool ÷ completions

### Cost comparison

| Ad format | Approx. CPM | What you get |
|---|---|---|
| Display | $2–10 | Passive view; ~50% bot traffic; no engagement proof |
| Premium video | $20–50 | Passive viewing; 50% skip rate |
| BrandBlitz | $20–50 equiv. | Verified engagement + first-party data + organic virality |

### First-party data and virality

Top scorers are self-identified brand enthusiasts — they chose to engage, proved comprehension, and competed. That's a qualified lead list that can't be bought anywhere else. **Research shows first-party behavioral data drives 83% improvement in customer acquisition cost** (AppsFlyer).

Every winner also generates a shareable result card: *"I earned $X knowing [Brand]."* That's organic brand reach through social proof, extending past the campaign end date at zero additional cost.

---

## Value to Users

### Real money, fast

- Earn USDC in 90 seconds: 30s warm-up + 45s challenge + results
- Instant settlement on Stellar (no withdrawal queue, no seed phrases)
- Top 10 in a $100 pool = potentially $15–50 USDC from a single session
- This is not $0.001 BAT for staring at a banner. These are competitive prizes with real stakes.

### Skills that compound

BrandBlitz is the only attention platform where the user actually gets better over time:

- **Recall speed** — the speed bonus rewards improvement. Practice mode lets users sharpen before competing.
- **Brand pattern recognition** — experienced players develop intuition for how brands communicate (color psychology, tagline structure) that transfers across all future challenges.
- **Brand knowledge** — users who play regularly develop genuine understanding of brands in the Stellar ecosystem.

### Status and on-chain credentials

- Public global leaderboard rank
- Weekly league tiers: Bronze → Silver → Gold (resets weekly — fresh start for everyone)
- Challenge streaks and achievement badges
- Non-transferable Stellar SBT credentials for tier milestones (verifiable on-chain proof of performance, embeddable in portfolio/LinkedIn)

### Brand perks for top performers

Top scorers earn exclusive access: brand Discord roles, early product access, invite-only high-prize rounds. This is a super-fan loyalty pipeline built from competition, not a sign-up form.

---

## How It's Different

| Platform | Model | Payout | Unknown Brand? | Active Learning? |
|---|---|---|---|---|
| Brave Ads | Passive attention | BAT | No — needs prior recognition | No |
| Adsgram | Dev monetisation | TON | No | No |
| Coinbase Earn | Educational | USDC | No — crypto only; discontinued 2025 | Yes |
| HQ Trivia (2018) | Branded trivia | USD | Yes — showed brand content | Partial |
| Pinterest Quiz Ads | Sponsored quiz | None | Yes | Yes |
| **BrandBlitz** | **Warm-up + challenge** | **USDC instant** | **Yes — core mechanic** | **Yes — core mechanic** |

The combination of warm-up → competition → instant USDC payout is unoccupied.

HQ Trivia proved the model: Warner Bros., Nike, and GM paid for branded challenge rounds in 2018. Warner Bros. alone paid ~$3M for three film promotions. Users engaged. Sponsors reported "strong impact on sales, not just engagement." BrandBlitz is HQ Trivia with USDC payouts, Stellar settlement, and a micro-learning warm-up that fixes the one documented weakness of gamified ads (cognitive recall drops without a learning component).

---

## The Platform's Network Effect

```
More brands → more challenges → more user sessions
                                        ↓
                            More score data → better brand ROI signals
                                        ↓
                            More brands willing to pay premium
                                        ↑
More users → higher competition → higher quality signals for brands
```

Both loops reinforce each other. The data moat deepens with every challenge — which brand messages land, which user segments know which brands, which formats drive highest completion. This makes the platform more valuable to brands over time.

---

## For Drips / Stellar Ecosystem

BrandBlitz is open-source infrastructure for skill-validated brand attention on Stellar. It demonstrates production-grade Stellar mechanics:

- Multi-winner batch USDC payouts (up to 50 Payment ops per transaction, ~$0.0007 total fee)
- Deposit detection via memo fields using Soroban RPC `getEvents`
- Muxed accounts — virtual sub-accounts per user with zero on-chain reserve cost (no 2 XLM minimum)
- Soroban escrow contract — trustless USDC holding with `settle()` / `refund()` functions
- Embedded wallet onboarding (no seed phrase, 30-second signup)

All patterns are documented, tested, and running in Docker.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                          Browser                            │
│              Next.js 16 (App Router, SSR)                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP via Nginx reverse proxy
           ┌───────────────┴───────────────┐
           │                               │
    /api/* → Express 5            /* → Next.js
           │
┌──────────▼──────────┐
│   Express 5 API     │  JWT auth · Redis rate limiting · anti-cheat
│   apps/api          │
└──────┬──────┬───────┘
       │      │
   pg Pool  Redis
       │      │
  PostgreSQL  BullMQ Worker ──→ Stellar Horizon
  (10 tables)                   Soroban RPC
                                USDC batch payouts
```

The API is **stateless** — all game state in PostgreSQL and Redis. The BullMQ worker runs as a separate process and handles async payout jobs after a challenge's end date passes.

---

## Monorepo Structure

```
brandblitz/
├── apps/
│   ├── api/          Express 5 REST API + BullMQ worker
│   └── web/          Next.js 16 frontend
├── contracts/
│   └── contracts/
│       └── escrow/   Soroban USDC escrow contract (Rust)
├── packages/
│   ├── stellar/      Stellar SDK helpers (payout, deposit, muxed accounts)
│   └── storage/      S3/MinIO client + WebP image optimisation
├── nginx/            Dev and prod reverse proxy configs
├── docker-compose.yml             8 services: web, api, worker, postgres,
├── docker-compose.override.yml    redis, nginx, minio, minio-setup
├── docker-compose.prod.yml
├── init.sql          Bootstrap entrypoint for the Postgres schema
├── apps/api/migrations/  Baseline snapshot + forward migration files
└── .env.example      All required environment variables with documentation
```

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | Next.js App Router | 16.2.1 |
| React | React | 19.2.4 |
| Styling | Tailwind CSS v4 (CSS-first) | 4.2.2 |
| Auth | next-auth (Google OAuth) | 4.24.13 |
| Backend | Express | 5.2.1 |
| Language | TypeScript | 6.0.2 |
| Database | PostgreSQL | 17 |
| Cache / queues | Redis + BullMQ | 7 / 5.71.1 |
| Object storage | MinIO (dev) / S3-compatible (prod) | — |
| Stellar SDK | @stellar/stellar-sdk | 14.6.1 |
| Smart contracts | Soroban (Rust, soroban-sdk 25) | — |
| Monorepo | Turborepo + pnpm workspaces | 2.8.21 / 10.33.0 |

---

## Prerequisites

- **Node.js** 22+
- **pnpm** 10.33.0 — `npm install -g pnpm@10.33.0`
- **Docker** + Docker Compose v2
- **Rust** + Stellar CLI (smart contract work only)
  - `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
  - `cargo install --locked stellar-cli@25 --features opt`

---

## Quick Start (Docker)

```bash
cd brandblitz

# Configure environment — minimum required:
# JWT_SECRET, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
# STELLAR_HOT_WALLET_SECRET
cp .env.example .env

# Start all 8 services (hot-reload enabled in dev)
docker compose up --build

# API container applies pending migrations before starting the watcher
# (use SEED_DEV=1 to seed after migrations)

# Verify
open http://localhost              # Next.js frontend
curl http://localhost/api/health   # {"status":"ok"}
open http://localhost:9001         # MinIO console (brandblitz / brandblitz123)
```

`docker compose up` auto-loads `docker-compose.override.yml` in development, which bind-mounts source directories for hot-reload and exposes direct service ports.

---

## Quick Start (Local)

```bash
# Infrastructure in Docker, apps native
docker compose up postgres redis minio minio-setup

pnpm install
cp .env.example .env  # update DATABASE_URL, REDIS_URL to localhost

pnpm dev  # Turborepo runs all packages in parallel
```

---

## Running Migrations

```bash
# Apply any pending API migrations
pnpm --filter @brandblitz/api migrate

# Check whether the database is already up to date
pnpm --filter @brandblitz/api migrate:dryrun
```

`init.sql` is a bootstrap wrapper for fresh databases. The canonical schema
snapshot is `apps/api/migrations/00000-initial.sql`, and new schema changes
should land as forward migrations in `apps/api/migrations/`.

---

## Local Dev — Seed Data

Starting from an empty database makes it hard to exercise any game flow. The seed script creates deterministic local fixtures so you can click through every page immediately.

```bash
# Seed once (idempotent — safe to re-run)
pnpm --filter @brandblitz/api seed

# Reset and re-seed from scratch
pnpm --filter @brandblitz/api seed -- --reset
```

What it creates:
- **50 users** — 1 admin (`seed-admin@brandblitz.test`), 3 brand owners, 46 players with varied leagues
- **3 brands** — Stellar Pay, NovaMint, AetherShop (with logo fixtures at `apps/api/scripts/fixtures/logos/`)
- **6 challenges** — 2 active, 2 completed, 2 draft (2 per brand)
- **200 game sessions** — mix of completed and flagged (≈10% flagged, including fraud flags)

**Auto-seed on `docker compose up`:**

```bash
SEED_DEV=1 docker compose up
```

Set `SEED_DEV=1` in your shell or `.env` and the API container will run the seed script before starting. This is a no-op if fixtures already exist.

---

## Environment Variables

See [`.env.example`](./.env.example) for all variables with inline documentation. Minimum to get running:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Sign API JWTs (64+ chars in prod) |
| `NEXTAUTH_SECRET` | next-auth session encryption |
| `NEXTAUTH_URL` | Public URL of the web app |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth credentials |
| `STELLAR_HOT_WALLET_SECRET` | Stellar keypair for payouts |
| `STELLAR_NETWORK` | `testnet` or `public` |
| `S3_*` | Storage endpoint, credentials, bucket (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) |
| `WEBHOOK_SECRET` | Protects `/webhooks/stellar` |
| `PHONE_HASH_SALT` | HMAC salt for phone-number hashing (32-byte random) |
| `SESSION_INTEGRITY_KEY` | HMAC key for session tamper-detection — generate with `openssl rand -hex 32` |
| `NEXTAUTH_API_URL` | Internal URL next-auth uses to reach the API (e.g. `http://localhost/api`) |

---

## Services & Ports

| Service | Port | Description |
|---|---|---|
| nginx | **80** | Reverse proxy; routes `/api/*` → Express |
| web | 3000 | Next.js frontend |
| api | 3001 | Express REST API |
| worker | — | BullMQ payout processor (no HTTP) |
| postgres | 5432 | PostgreSQL 17 |
| redis | 6379 | Redis 7 |
| minio | 9000 | MinIO S3 API |
| minio-console | 9001 | MinIO admin UI |

Only port 80 (and 443 in prod) is exposed externally in the Docker stack.

---

## E2E

The Playwright suite lives in [`e2e/`](./e2e) and targets the live Docker dev stack with `baseURL=http://localhost:3000`.

```bash
docker compose up -d --build
pnpm e2e
```

What it covers:

- Mocked Google OAuth sign-in to the real web app, ending on `/dashboard`
- Brand creation through the UI, followed by deposit instructions
- Full player golden path: warmup wait, challenge start, 3 rounds, results screen

Artifacts:

- Trace, video, and screenshots are retained on failure in `e2e/artifacts/`
- In CI, upload `e2e/artifacts/` as the job artifact directory

Notes:

- The Docker dev override enables the mocked Google OAuth path used by Playwright.
- The suite assumes the stack is already running; it does not start containers for you.

---

## Game Flow (Technical)

```
POST /sessions/:id/warmup-start        ← session row created (status=warmup)
POST /sessions/:id/warmup-complete     ← server validates ≥20s elapsed;
                                          returns challengeToken (5-min TTL)
POST /sessions/:id/start               ← validates token; status=active
POST /sessions/:id/answer/1            ← server validates + scores round 1
POST /sessions/:id/answer/2            ← round 2
POST /sessions/:id/answer/3            ← round 3; status=completed

[challenge.ends_at passes]
BullMQ job fires → rank all sessions → calculate proportional shares
→ build Stellar batch tx (≤50 Payment ops) → submit → record tx_hash
```

Correct answers **never leave the server**. The client only receives round scores.

---

## Stellar Integration

### Deposits
Brand sends USDC to the hot wallet with a unique memo (e.g. `BLITZ-A1B2C3`). The Stellar webhook endpoint or background polling detects the deposit via `getEvents` on the Soroban RPC. Challenge transitions `pending_deposit → active`.

### Payouts
Single hot wallet + muxed accounts. No per-user Stellar accounts (no 2 XLM minimum reserve per user). Payout job chunks winners into batches of ≤50 Payment ops, each batch submitted as one atomic transaction.

### Soroban Escrow (on-chain alternative)
For brands wanting full on-chain transparency, the escrow contract holds USDC trustlessly. `settle(recipients)` distributes to winners; `refund()` returns the pool to the brand. See [`contracts/README.md`](./contracts/README.md).

---

## Anti-Cheat

Five independent layers:

| Layer | Mechanism |
|---|---|
| Server authority | Correct answers and scores never sent to client |
| Warmup enforcement | Server rejects challenge start if < 20s since warmup began |
| Reaction time bounds | Answers < 150ms (physically impossible) or > 30s flagged |
| Device fingerprinting | FingerprintJS visitor ID; multi-account device detection via Redis |
| Rate limiting | Redis-backed: 5 challenge starts/hr, 100 API calls/15min per IP |

---

## Scoring

```
Per round (correct answer):   100 base + floor((timeLeft / 15s) × 50) speed bonus
Per round (wrong answer):     0  (no penalty — keeps engagement positive)
Maximum total:                450 points (3 rounds × 150)

Payout share:  userScore / sumOfAllWinnerScores × prizePool
```

Only users with at least one correct answer receive a payout share.

---

## Deployment (Production)

### 1. Prepare the server

```bash
git clone <repo> brandblitz && cd brandblitz
cp .env.example .env
```

### 2. Configure production environment

Edit `.env` with the following production-specific values:

```bash
NODE_ENV=production

# Use a real S3-compatible provider (Cloudflare R2, AWS S3) — remove MinIO vars
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=<r2-access-key>
S3_SECRET_ACCESS_KEY=<r2-secret-key>
S3_BUCKET=brandblitz-assets
S3_PUBLIC_URL=https://assets.yourdomain.com
# Remove S3_FORCE_PATH_STYLE for R2/AWS

# Switch to Stellar mainnet
STELLAR_NETWORK=public
STELLAR_HORIZON_URL=https://horizon.stellar.org
STELLAR_RPC_URL=https://mainnet.sorobanrpc.com
# Mainnet USDC issuer (Centre)
USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN

# Generate strong secrets (run each command separately)
# openssl rand -hex 64   → JWT_SECRET
# openssl rand -hex 64   → NEXTAUTH_SECRET
# openssl rand -hex 32   → WEBHOOK_SECRET

# Set your domain
NEXTAUTH_URL=https://yourdomain.com
NEXT_PUBLIC_API_URL=https://yourdomain.com/api
```

### 3. Configure Google OAuth for production

In the [Google Cloud Console](https://console.cloud.google.com/):
- Add `https://yourdomain.com/api/auth/callback/google` as an authorised redirect URI
- Add `https://yourdomain.com` as an authorised JavaScript origin

### 4. Configure Nginx for your domain

Edit `nginx/nginx.prod.conf` and replace `${DOMAIN}` with your domain, or set it as a shell variable before starting:

```bash
export DOMAIN=yourdomain.com
```

Ensure Let's Encrypt certificates exist at `/etc/letsencrypt/live/${DOMAIN}/`.

### 5. Deploy

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Verify all services are healthy
docker compose ps

# Check logs
docker compose logs -f api
docker compose logs -f web
```

Production differences from dev:
- No bind mounts — fully built images
- `restart: unless-stopped` on all services
- Nginx serves HTTPS with HSTS, X-Frame-Options, rate limiting
- API and web each run 2 replicas for zero-downtime deployments
- MinIO removed — use Cloudflare R2 or AWS S3
- Worker retries failed payout jobs with exponential back-off

---

## Running Tests

Vitest is configured at the monorepo root with per-workspace project configs.

```bash
# Run all workspace tests
pnpm test

# Run all workspace tests with v8 coverage
pnpm test:coverage

# Run tests for one workspace
pnpm --filter @brandblitz/api test
pnpm --filter @brandblitz/web test
pnpm --filter @brandblitz/stellar test
pnpm --filter @brandblitz/storage test
```

Shared test setup is in `tests/setup.ts` and includes reusable DB test helpers based on test schema prefixes.

---

## Workspace Scripts

```bash
pnpm dev          # Start all apps in parallel (Turborepo)
pnpm build        # Build all packages and apps
pnpm test         # Run all test suites
pnpm e2e          # Run Playwright end-to-end tests against docker-compose
pnpm test:coverage # Run all test suites with coverage
pnpm lint         # Lint all packages
pnpm type-check   # TypeScript type-check everything
pnpm format       # Prettier format all .ts/.tsx/.json files
pnpm clean        # Remove all build artifacts and node_modules
```

---

## Packages

### `packages/stellar`

Typed helpers for all Stellar network interactions. Imported by `apps/api`.

| File | What it does |
|---|---|
| `src/client.ts` | Factory for Horizon `Server` and Soroban `RPC.Server` instances; `getUsdcAsset()` |
| `src/deposit.ts` | Polls Soroban RPC `getEvents` to detect USDC deposits by memo; returns `DepositEvent[]` |
| `src/payout.ts` | `submitBatchPayout(recipients)` — builds a `TransactionBuilder` with up to 50 Payment ops and submits it atomically |
| `src/accounts.ts` | `createMuxedAddress(baseAddress, muxedId)` — virtual sub-accounts per user at zero reserve cost; `sponsorNewAccount()` for CAP-0033 sponsored reserves |
| `src/constants.ts` | Network configs, `MAX_OPS_PER_TX=50`, `WARMUP_MIN_SECONDS=20`, poll intervals |
| `src/index.ts` | Re-exports everything |

### `packages/storage`

S3-compatible object storage with image optimisation. Imported by `apps/api`. Works with MinIO in dev and Cloudflare R2 / AWS S3 in prod — same code, different env vars.

| File | What it does |
|---|---|
| `src/client.ts` | `S3Client` configured from env; `BUCKETS` constant; `getPublicUrl(key)` |
| `src/optimize.ts` | `optimizeImage(key, type)` — fetches from S3, runs `sharp` WebP resize, overwrites: logos → 400×400 contain, products → 800×600 inside, avatars → 200×200 cover |
| `src/index.ts` | Re-exports everything |

---

## Further Reading

- [`apps/api/README.md`](./apps/api/README.md) — Full API reference, all routes, middleware, services, database schema
- [`apps/web/README.md`](./apps/web/README.md) — Frontend pages, components, auth flow, game state machine, upload flow
- [`contracts/README.md`](./contracts/README.md) — Soroban escrow contract: build, test, deploy, full function reference

---

## Operations Runbooks

Incident-response playbooks for on-call engineers live in [`docs/runbooks/`](./docs/runbooks/README.md).

| Runbook | Summary |
|---|---|
| [horizon-outage](./docs/runbooks/horizon-outage.md) | Stellar Horizon degraded — payout queue paused |
| [hot-wallet-low-balance](./docs/runbooks/hot-wallet-low-balance.md) | USDC balance too low to process payouts |
| [payout-stuck-in-queue](./docs/runbooks/payout-stuck-in-queue.md) | BullMQ payout jobs not progressing |
| [leaked-secret](./docs/runbooks/leaked-secret.md) | Secret exposed in git or logs |
| [cdn-purge](./docs/runbooks/cdn-purge.md) | Force-invalidate a cached asset |
| [rotate-secrets](./docs/runbooks/rotate-secrets.md) | General secret rotation |

See [docs/runbooks/README.md](./docs/runbooks/README.md) for the full index.
