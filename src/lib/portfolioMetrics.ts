import { Asset } from '../store/db';

export type DisplayCurrency = 'CAD' | 'INR' | 'USD';

export function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: DisplayCurrency,
  rates: Record<string, number> | null,
) {
  if (fromCurrency === toCurrency) return amount;
  if (!rates) return amount;

  const fromRate = fromCurrency === 'USD' ? 1 : rates[fromCurrency];
  const toRate = toCurrency === 'USD' ? 1 : rates[toCurrency];
  if (!fromRate || !toRate) return amount;

  const amountInUsd = amount / fromRate;
  return amountInUsd * toRate;
}

export function getOriginalDisplayCurrency(asset: Asset): DisplayCurrency {
  if (asset.country === 'India') return 'INR';
  if (asset.country === 'Canada') return 'CAD';
  return asset.currency;
}

export function getRelevantConversionRates(rates: Record<string, number> | null) {
  if (!rates) return [];

  const pairs: Array<{ label: string; value: number }> = [
    { label: 'USD → INR', value: convertAmount(1, 'USD', 'INR', rates) },
    { label: 'USD → CAD', value: convertAmount(1, 'USD', 'CAD', rates) },
    { label: 'CAD → INR', value: convertAmount(1, 'CAD', 'INR', rates) },
    { label: 'CAD → USD', value: convertAmount(1, 'CAD', 'USD', rates) },
    { label: 'INR → USD', value: convertAmount(1, 'INR', 'USD', rates) },
    { label: 'INR → CAD', value: convertAmount(1, 'INR', 'CAD', rates) },
  ];

  return pairs.filter((pair) => Number.isFinite(pair.value));
}

export function isDebtAssetClass(assetClass: string) {
  return assetClass.trim().toLowerCase() === 'credit card';
}

function applyAssetClassSign(assetClass: string, amount: number) {
  return isDebtAssetClass(assetClass) ? -Math.abs(amount) : amount;
}

function getFallbackUnitPrice(asset: Asset) {
  if (asset.quantity && Number.isFinite(asset.quantity) && asset.quantity !== 0) {
    return asset.costBasis / asset.quantity;
  }
  return asset.costBasis;
}

export function getInvestmentTotal(asset: Asset) {
  return applyAssetClassSign(asset.assetClass, asset.costBasis);
}

export function getCurrentPrice(asset: Asset) {
  const currentUnitPrice =
    typeof asset.currentPrice === 'number' && Number.isFinite(asset.currentPrice)
      ? asset.currentPrice
      : getFallbackUnitPrice(asset);
  return applyAssetClassSign(asset.assetClass, currentUnitPrice);
}

export function getCurrentTotal(asset: Asset) {
  const rawCurrentTotal =
    typeof asset.currentPrice === 'number' && Number.isFinite(asset.currentPrice)
      ? asset.quantity * Math.abs(asset.currentPrice)
      : asset.costBasis;
  return applyAssetClassSign(asset.assetClass, rawCurrentTotal);
}

export function getPreviousClose(asset: Asset) {
  const previousClose = asset.previousClose;
  return typeof previousClose === 'number' && Number.isFinite(previousClose)
    ? applyAssetClassSign(asset.assetClass, previousClose)
    : null;
}

export function getDailyPriceChange(asset: Asset) {
  const previousClose = getPreviousClose(asset);
  if (previousClose == null || typeof asset.currentPrice !== 'number') return null;
  return getCurrentPrice(asset) - previousClose;
}

export function getDailyTotalChange(asset: Asset) {
  const priceChange = getDailyPriceChange(asset);
  if (priceChange == null) return null;
  return priceChange * asset.quantity;
}

export function getInvestmentPrice(asset: Asset) {
  if (!asset.quantity) return 0;
  return getInvestmentTotal(asset) / asset.quantity;
}

export function getGrowthTotal(asset: Asset) {
  return getCurrentTotal(asset) - getInvestmentTotal(asset);
}

function parsePurchaseDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getAssetXirr(
  asset: Asset,
  displayCurrency: DisplayCurrency,
  rates: Record<string, number> | null,
) {
  const purchaseDate = parsePurchaseDate(asset.purchaseDate);
  if (!purchaseDate) return null;
  if (isDebtAssetClass(asset.assetClass)) return null;

  const invested = convertAmount(getInvestmentTotal(asset), asset.currency, displayCurrency, rates);
  const currentValue = convertAmount(getCurrentTotal(asset), asset.currency, displayCurrency, rates);
  if (invested <= 0 || currentValue <= 0) return null;

  const now = new Date();
  const elapsedDays = (now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24);
  if (elapsedDays <= 0) return null;

  return Math.pow(currentValue / invested, 365.25 / elapsedDays) - 1;
}

export function formatCurrency(value: number, currency: DisplayCurrency) {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}
