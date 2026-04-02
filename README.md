# Nexus Portfolio

Nexus Portfolio is a shared family wealth tracker built for people managing investments across India and Canada.

It helps you track your full household balance sheet in one place, including:
- stocks
- mutual funds
- TFSA, RRSP, and FHSA accounts
- bank balances and cash
- gold
- PF, PPF, NPS, and fixed deposits
- real estate and other manual assets
- liabilities such as credit cards

## What This App Is For

Most portfolio apps are built for one person and one market.

Nexus Portfolio is built for real families who need:
- India and Canada holdings together
- multiple family members in one shared portfolio
- both live-priced and manually updated assets
- clear views by owner, country, and currency
- imports and exports that match how real data is stored

## Start Using It

1. Open the live website
2. Sign in with Google
3. If you are an authorized member, your portfolio loads automatically
4. Import your India and Canada holdings from `Settings`
5. Review and manage all holdings from `Assets`
6. Track totals, charts, and FX impact from `Dashboard`

## What You Can Do

### Track Your Full Portfolio
- manage India and Canada holdings in one place
- track assets and liabilities together
- view wealth by member, country, and asset class

### Use Shared Family Access
- sign in with Google
- invite family members
- keep one shared cloud-synced portfolio
- see updates across devices in real time

### Import And Export Easily
- import India holdings CSV
- import Canada holdings CSV
- import asset classes CSV
- export India holdings in the same format
- export Canada holdings in the same format

### Work With Live Or Manual Pricing
- use ticker-based live pricing
- keep manual pricing for assets that should not auto-refresh
- refresh a single row or refresh in bulk
- fix broken tickers with a guided modal
- apply FX conversion, unit conversion, and formulas to live prices

### Understand Your Wealth Better
- see combined family wealth at a glance
- track invested amount, current value, returns, and daily change
- switch currency views
- review country and owner breakdowns
- monitor FX rates and allocation views

### Manage Data Safely
- duplicate assets
- edit or delete holdings
- review failed price rows
- migrate local data into cloud when needed

## Why People Like It

- built for actual family portfolio tracking, not just stock watching
- handles both investing and debt
- works for India and Canada together
- useful for households with multiple owners and multiple account types
- flexible enough for both market-linked and manual assets

## Import Templates

The app includes downloadable templates inside `Settings`.

Supported imports:
- India holdings
- Canada holdings
- asset classes

Supported exports:
- India holdings
- Canada holdings

## For Developers

If you want to run the app locally:

1. `npm install`
2. copy `.env.example` to `.env.local`
3. add your Firebase config and any provider API keys
4. run `npm run dev`

Notes:
- `NEXT_PUBLIC_*` values are exposed to the browser and should only be used for client-safe config such as Firebase app setup.
- Sensitive provider keys should stay in server-only env vars such as `MASSIVE_API_KEY`, `FINNHUB_API_KEY`, and `ALPHA_VANTAGE_API_KEY`.

Useful scripts:
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run test:run`
