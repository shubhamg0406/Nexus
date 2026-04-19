import { beforeEach, describe, expect, it } from 'vitest';
import { encryptJson } from '../../security/encryption.js';
import { UpstoxAdapter } from './upstoxAdapter.js';

describe('UpstoxAdapter', () => {
  beforeEach(() => {
    process.env.CONNECTED_ACCOUNTS_ENCRYPTION_KEY = 'test-encryption-key';
  });

  it('normalizes holdings and positions with deterministic fingerprints', async () => {
    const mockClient = {
      getProfile: async () => ({ user_id: 'u123', user_name: 'Trader' }),
      getHoldings: async () => ([
        {
          isin: 'INE123456789',
          trading_symbol: 'TCS',
          quantity: 4,
          average_price: 120,
          last_price: 150,
          pnl: 120,
          instrument_token: 'NSE_EQ|1234',
          product: 'D',
        },
      ]),
      getPositions: async () => ([
        {
          trading_symbol: 'NIFTY24APR22500CE',
          quantity: 2,
          average_price: 80,
          last_price: 105,
          pnl: 50,
          instrument_token: 'NSE_FO|5678',
          product: 'OPT',
          multiplier: 50,
        },
      ]),
    };

    const adapter = new UpstoxAdapter(mockClient as never);
    const connection = {
      id: 'uid-1:upstox',
      uid: 'uid-1',
      provider: 'upstox',
      status: 'connected',
      displayName: 'Upstox',
      connectedAt: Date.now(),
      updatedAt: Date.now(),
      tokenBlob: encryptJson({ accessToken: 'access-token' }),
    } as const;

    const holdings = await adapter.fetchHoldings(connection);

    expect(holdings).toHaveLength(2);
    expect(holdings[0].holdingKind).toBe('holding');
    expect(holdings[0].sourceFingerprint).toBe('upstox:u123:INE123456789:holding');
    expect(holdings[0].assetType).toBe('stock');

    expect(holdings[1].holdingKind).toBe('position');
    expect(holdings[1].assetType).toBe('derivative');
    expect(holdings[1].sourceFingerprint).toBe('upstox:u123:NIFTY24APR22500CE:position');
    expect(holdings[1].positionSide).toBe('long');
  });
});
