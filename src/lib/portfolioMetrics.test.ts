import { describe, expect, it } from 'vitest';
import {
  convertAmount,
  formatCurrency,
  getCurrentPrice,
  getCurrentTotal,
  getDailyPriceChange,
  getDailyTotalChange,
  getInvestmentTotal,
  getOriginalDisplayCurrency,
  isDebtAssetClass,
} from './portfolioMetrics';
import type { Asset } from '../store/db';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: 'Sample Asset',
    quantity: 10,
    costBasis: 1000,
    currency: 'CAD',
    owner: 'Shubham Gupta',
    country: 'Canada',
    assetClass: 'Stocks',
    autoUpdate: true,
    ...overrides,
  };
}

describe('portfolioMetrics', () => {
  it('uses Indian number formatting only for INR', () => {
    expect(formatCurrency(125000, 'INR')).toBe('₹1,25,000.00');
    expect(formatCurrency(125000, 'CAD')).toBe('CA$125,000.00');
  });

  it('returns original display currency by country', () => {
    expect(getOriginalDisplayCurrency(makeAsset({ country: 'India', currency: 'USD' }))).toBe('INR');
    expect(getOriginalDisplayCurrency(makeAsset({ country: 'Canada', currency: 'USD' }))).toBe('CAD');
  });

  it('converts via USD-based rates', () => {
    const rates = { CAD: 1.37, INR: 83.2 };
    expect(convertAmount(137, 'CAD', 'USD', rates)).toBeCloseTo(100, 4);
    expect(convertAmount(100, 'USD', 'INR', rates)).toBeCloseTo(8320, 4);
  });

  it('treats credit card assets as debt across totals and prices', () => {
    const debtAsset = makeAsset({
      assetClass: 'Credit Card',
      quantity: 1,
      costBasis: 5000,
      currentPrice: undefined,
    });

    expect(isDebtAssetClass(debtAsset.assetClass)).toBe(true);
    expect(getInvestmentTotal(debtAsset)).toBe(-5000);
    expect(getCurrentPrice(debtAsset)).toBe(-5000);
    expect(getCurrentTotal(debtAsset)).toBe(-5000);
  });

  it('computes daily changes from previous close when available', () => {
    const asset = makeAsset({
      currentPrice: 125,
      previousClose: 120,
      quantity: 4,
    });

    expect(getDailyPriceChange(asset)).toBe(5);
    expect(getDailyTotalChange(asset)).toBe(20);
  });

  it('returns null daily change when data is incomplete', () => {
    const asset = makeAsset({
      currentPrice: 125,
      previousClose: undefined,
    });

    expect(getDailyPriceChange(asset)).toBeNull();
    expect(getDailyTotalChange(asset)).toBeNull();
  });
});
