import { describe, expect, it } from 'vitest';
import { mapSplitwiseSummaryToAssets } from './splitwiseAssetMapper';
import type { SplitwiseSummaryResponse } from '../lib/splitwiseTypes';

function buildSummary(net: Array<{ currency: string; amount: number }>): SplitwiseSummaryResponse {
  return {
    connected: true,
    profile: {},
    balances: {
      owes: [],
      owed: [],
      net,
    },
    groups: [],
    recentExpenses: [],
    lastSyncAt: 1_700_000_000_000,
  };
}

describe('mapSplitwiseSummaryToAssets', () => {
  it('converts multi-currency net balances into one primary-currency row', () => {
    const assets = mapSplitwiseSummaryToAssets(
      'connected',
      buildSummary([
        { currency: 'USD', amount: 100 },
        { currency: 'CAD', amount: 50 },
      ]),
      'Joint',
      'CAD',
      { CAD: 1.25, INR: 82 },
    );

    expect(assets).toHaveLength(1);
    expect(assets[0].currency).toBe('CAD');
    expect(assets[0].name).toBe('Splitwise - Cloud (CAD)');
    expect(assets[0].splitwiseOriginalBreakdown).toEqual([
      { currency: 'USD', amount: 100 },
      { currency: 'CAD', amount: 50 },
    ]);
    expect(assets[0].currentPrice).toBeCloseTo(175, 6);
  });

  it('flags missing FX currencies and excludes them from converted total', () => {
    const assets = mapSplitwiseSummaryToAssets(
      'connected',
      buildSummary([
        { currency: 'USD', amount: 100 },
        { currency: 'INR', amount: 1000 },
      ]),
      'Joint',
      'CAD',
      { CAD: 1.25 },
    );

    expect(assets).toHaveLength(1);
    expect(assets[0].currentPrice).toBeCloseTo(125, 6);
    expect(assets[0].splitwiseConversionNote).toContain('INR');
    expect(assets[0].priceFetchStatus).toBe('failed');
  });
});
