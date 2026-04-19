# Nexus Portfolio

Nexus Portfolio is a shared wealth tracker for families managing money across Canada and India.

It combines market-linked investments, manual assets, liabilities, and read-only connected broker snapshots in one cloud-backed workspace.

## Connected Accounts (Phase 1)

Nexus now includes a reusable **Connected Accounts** foundation with normalized cloud storage:

- `external_connections`
- `external_accounts`
- `external_holdings`
- `external_sync_runs`
- `external_asset_overrides`

### Live provider in this build

- **Upstox**: enabled (read-only)

### Intentionally deferred in this build

- **Groww**: not enabled (`requires paid Groww Trading API`)
- **Canada aggregation**: not enabled (`no live free production-safe aggregator in this build`)
- **Plaid**: intentionally not included

### Read-only behavior

Connected holdings are **source-managed**:

- quantity, cost, price, value, and currency come from Upstox snapshots
- those numeric fields are not freely editable in Nexus
- Nexus-only metadata stays editable via overrides:
  - custom label
  - owner assignment
  - category override
  - notes
  - hidden-from-dashboard toggle

Manual assets still work and are not auto-overwritten or auto-merged.

## What It Covers

- Canada and India holdings in one app
- Multiple family members in one shared portfolio
- Stocks, ETFs, mutual funds, gold, bank balances, PF/PPF/NPS/FD, real estate, and liabilities
- Live-priced and manual-priced assets side by side
- Cloud-backed connected holdings snapshots (Upstox)

## Core Features

- Shared portfolio access with Google sign-in
- Dashboard for total wealth, allocation, returns, and FX-aware views
- Assets ledger with filters, sorting, subtotals, and bulk refresh
- Import/export flows for Canada holdings, India holdings, and asset classes
- Integrations tab with Splitwise + Connected Accounts

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy envs:

```bash
cp .env.example .env.local
```

3. Fill in `.env.local` values.

4. Start app + API server:

```bash
npm run dev
```

## Upstox Setup (Connected Accounts)

1. Create an app in Upstox Developer Console.
2. Configure redirect URI:
   - local: `http://localhost:6868/api/connections/upstox/callback`
   - production: `https://nexus-phi-inky.vercel.app/api/connections/upstox/callback`
3. Set server env vars:

```bash
UPSTOX_CLIENT_ID="..."
UPSTOX_CLIENT_SECRET="..."
UPSTOX_REDIRECT_URI="http://localhost:6868/api/connections/upstox/callback"
CONNECTED_ACCOUNTS_ENCRYPTION_KEY="long-random-secret"
CONNECTED_ACCOUNTS_STATE_SECRET="long-random-secret"
APP_BASE_URL="http://localhost:6868"
```

4. Open Nexus, go to `Settings -> Integrations -> Connected Accounts`, then click **Connect Upstox**.

## Firebase Admin Setup (required for server auth)

Server-side connected-account endpoints verify Firebase ID tokens with `firebase-admin`.

Set:

```bash
FIREBASE_ADMIN_PROJECT_ID="..."
FIREBASE_ADMIN_CLIENT_EMAIL="..."
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

If running on GCP with workload identity, default credentials can be used instead.

## Pricing Model (existing)

Nexus pricing routes remain provider-aware for manual/market-linked assets:

- India mutual funds: `AMFI`
- India stocks: `Upstox` system route when configured
- U.S. equities: `Massive`
- Canada equities: close-based route with caching and queue handling
- Gold: system gold pricing
- Manual assets: no market refresh

## Useful Scripts

```bash
npm run dev
npm run build
npm run lint
npm run test:run
```

## Environment Notes

- `NEXT_PUBLIC_*` values are browser-visible and should stay client-safe.
- Keep provider secrets and encryption keys server-only.
- Never commit real credentials.

## Deployment

Production is currently deployed on Vercel.

Live app:

- [https://nexus-phi-inky.vercel.app](https://nexus-phi-inky.vercel.app)

Latest production release:

- Date: `2026-04-18`
- Alias: [https://nexus-phi-inky.vercel.app](https://nexus-phi-inky.vercel.app)
- Inspect: [https://vercel.com/thanoskakas-projects/nexus/4msi9GbDcu2eiu8LuxzTMXcQDYSi](https://vercel.com/thanoskakas-projects/nexus/4msi9GbDcu2eiu8LuxzTMXcQDYSi)

Deploy command:

```bash
npx vercel --prod --yes
```

Compatibility note:

- Vercel rewrites `/api/integrations/splitwise/*` to `/api/splitwise/*` via `vercel.json`.
