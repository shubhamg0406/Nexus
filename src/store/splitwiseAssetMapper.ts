import type { SplitwiseConnectionStatus, SplitwiseSummaryResponse } from '../lib/splitwiseTypes';
import type { Asset } from './db';
import type { PortfolioCurrency } from './portfolioHelpers';

function normalizeAssetCurrency(value?: string): 'CAD' | 'INR' | 'USD' {
  const upper = (value || '').trim().toUpperCase();
  if (upper === 'CAD') return 'CAD';
  if (upper === 'USD') return 'USD';
  return 'INR';
}

function getStrictFxConversionFactor(
  fromCurrency: Asset['currency'],
  toCurrency: Asset['currency'],
  rates: Record<string, number> | null,
) {
  if (fromCurrency === toCurrency) return 1;
  if (!rates) return null;

  const fromRate = fromCurrency === 'USD' ? 1 : rates[fromCurrency];
  const toRate = toCurrency === 'USD' ? 1 : rates[toCurrency];
  if (!fromRate || !toRate) return null;
  return toRate / fromRate;
}

export function mapSplitwiseSummaryToAssets(
  status: SplitwiseConnectionStatus,
  summary: SplitwiseSummaryResponse | null,
  ownerLabel: string,
  primaryCurrency: PortfolioCurrency,
  rates: Record<string, number> | null,
  connectionKey: string = 'default',
): Asset[] {
  if (status !== 'connected' || !summary) return [];
  const netBalances = summary.balances?.net || [];
  const normalizedEntries = netBalances
    .filter((entry) => Number.isFinite(entry.amount) && Math.abs(entry.amount) > 0)
    .map((entry) => ({
      currency: normalizeAssetCurrency(entry.currency),
      amount: Number(entry.amount),
    }));
  if (normalizedEntries.length === 0) return [];

  const converted = normalizedEntries.reduce((total, entry) => {
    const factor = getStrictFxConversionFactor(entry.currency, primaryCurrency, rates);
    if (factor == null) return total;
    return total + entry.amount * factor;
  }, 0);
  const missingCurrencies = normalizedEntries
    .filter((entry) => getStrictFxConversionFactor(entry.currency, primaryCurrency, rates) == null)
    .map((entry) => entry.currency);
  const uniqueMissingCurrencies = Array.from(new Set(missingCurrencies));
  const splitwiseOriginalBreakdown = normalizedEntries.map((entry) => ({
    currency: entry.currency,
    amount: entry.amount,
  }));
  const conversionNoteParts: string[] = [];
  conversionNoteParts.push(`Original net: ${splitwiseOriginalBreakdown.map((entry) => `${entry.amount.toFixed(2)} ${entry.currency}`).join(', ')}`);
  if (uniqueMissingCurrencies.length > 0) {
    conversionNoteParts.push(`Missing FX for ${uniqueMissingCurrencies.join(', ')} -> ${primaryCurrency}; excluded from converted total.`);
  }
  if (summary.lastSyncAt) {
    conversionNoteParts.push(`Synced ${new Date(summary.lastSyncAt).toLocaleString()}`);
  }

  const connectionSuffix = connectionKey === 'default' ? `${primaryCurrency}` : `${connectionKey}:${primaryCurrency}`;
  const holdingId = connectionKey === 'default' ? `splitwise-${primaryCurrency}` : `splitwise-${connectionKey}-${primaryCurrency}`;

  return [{
    id: `connected:splitwise:${connectionSuffix}`,
    name: `Splitwise - Cloud (${primaryCurrency})`,
    quantity: 1,
    costBasis: converted,
    currency: primaryCurrency,
    owner: ownerLabel,
    country: primaryCurrency === 'INR' ? 'India' : 'Canada',
    assetClass: 'Splitwise Cloud',
    autoUpdate: false,
    currentPrice: converted,
    lastUpdated: summary.lastSyncAt,
    priceFetchStatus: uniqueMissingCurrencies.length > 0 ? 'failed' : 'success',
    priceFetchMessage: uniqueMissingCurrencies.length > 0
      ? 'Converted from Splitwise with partial FX coverage.'
      : 'Via Splitwise (read-only, converted to primary currency).',
    priceProvider: 'splitwise',
    holdingPlatform: 'Splitwise Cloud',
    comments: conversionNoteParts.join(' '),
    splitwiseOriginalBreakdown,
    splitwiseConvertedCurrency: primaryCurrency,
    splitwiseConversionNote: uniqueMissingCurrencies.length > 0
      ? `Missing FX for ${uniqueMissingCurrencies.join(', ')} -> ${primaryCurrency}.`
      : undefined,
    sourceType: 'connected',
    sourceManaged: true,
    connectedProvider: 'splitwise',
    connectedHoldingId: holdingId,
    hiddenFromDashboard: false,
  } satisfies Asset];
}
