import { describe, expect, it } from 'vitest';
import {
  getCurrencyOptionsForCountry,
  getDefaultCurrencyForCountry,
} from './addAssetModalHelpers';

describe('AddAssetModal helpers', () => {
  it('returns only INR for India', () => {
    expect(getCurrencyOptionsForCountry('India')).toEqual(['INR']);
    expect(getDefaultCurrencyForCountry('India')).toBe('INR');
  });

  it('returns CAD and USD for Canada and defaults to CAD', () => {
    expect(getCurrencyOptionsForCountry('Canada')).toEqual(['CAD', 'USD']);
    expect(getDefaultCurrencyForCountry('Canada')).toBe('CAD');
  });

  it('preserves an existing valid currency for the selected country', () => {
    expect(getDefaultCurrencyForCountry('Canada', 'USD')).toBe('USD');
    expect(getDefaultCurrencyForCountry('India', 'INR')).toBe('INR');
  });

  it('falls back when the existing currency is not allowed for the selected country', () => {
    expect(getDefaultCurrencyForCountry('Canada', 'INR')).toBe('CAD');
    expect(getDefaultCurrencyForCountry('India', 'CAD')).toBe('INR');
  });
});
