# Nexus Portfolio

Nexus Portfolio is a shared wealth tracker for families managing money across Canada and India.

It combines market-linked investments, manual assets, and liabilities in one portfolio so you can track the full household balance sheet instead of just a brokerage account.

## What It Covers

- Canada and India holdings in one app
- Multiple family members in one shared portfolio
- Stocks, ETFs, mutual funds, gold, bank balances, PF/PPF/NPS/FD, real estate, and liabilities
- Live-priced and manual-priced assets side by side
- Portfolio views by owner, country, asset class, and currency

## Core Features

- Shared portfolio access with Google sign-in
- Dashboard for total wealth, allocation, returns, and FX-aware views
- Assets ledger with filters, sorting, subtotals, and bulk refresh
- Import/export flows for Canada holdings, India holdings, and asset classes
- Guided ticker repair and pricing controls for market-linked assets
- System routing for different price sources instead of one-provider-only logic

## Pricing Model

Nexus Portfolio uses different routes depending on the asset type.

- India mutual funds: `AMFI`
- India stocks: `Upstox` system route when configured
- U.S. equities: `Massive`
- Canada equities: close-based route with caching and queue-aware refresh handling
- Gold: system gold pricing
- Manual assets: no market refresh

Bulk refresh is provider-aware:

- unrestricted routes refresh immediately
- limited routes use cached close prices and queue windows when needed
- actionable failures are tracked separately from queued or cached rows

## Imports and Exports

Inside `Settings`, you can:

- download blank templates
- download sample templates with fake example data
- import India holdings
- import Canada holdings
- import asset classes
- export holdings in the same structured format

## Who This Is For

This app is a good fit if you want:

- one portfolio across countries
- one place for both spouses or family members
- both investments and liabilities in the same view
- flexibility for assets that do not belong in a normal stock app

## Tech Stack

- React
- TypeScript
- Vite
- Firebase
- Tailwind
- TanStack Table

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy envs:

```bash
cp .env.example .env.local
```

3. Fill in the values you need in `.env.local`

4. Start the app:

```bash
npm run dev
```

## Useful Scripts

```bash
npm run dev
npm run build
npm run lint
npm run test:run
```

## Environment Notes

- `NEXT_PUBLIC_*` values are browser-visible and should only be used for client-safe config
- sensitive keys should stay in server-only env vars
- optional browser-side integrations such as logos can use client env vars like `VITE_LOGO_DEV_PUBLISHABLE_KEY`
- keep real credentials only in `.env.local`, never in committed files

## Deployment

Production is currently deployed on Vercel.

Live app:

- [https://nexus-phi-inky.vercel.app](https://nexus-phi-inky.vercel.app)

## Status

Nexus Portfolio is actively being refined around:

- better bulk refresh behavior
- more reliable provider routing
- stronger import/export workflows
- clearer portfolio UX for real household use
