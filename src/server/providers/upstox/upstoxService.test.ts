import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptJson } from '../../security/encryption.js';

vi.mock('../../connections/connectionStore', () => ({
  getExternalConnection: vi.fn(),
  sanitizeExternalConnection: vi.fn((value) => value),
  upsertExternalConnection: vi.fn(),
  updateExternalConnectionStatus: vi.fn(),
  clearExternalConnectionToken: vi.fn(),
}));

vi.mock('../../connections/accountStore', () => ({
  deactivateMissingExternalAccounts: vi.fn(async () => 0),
  listExternalAccounts: vi.fn(async () => []),
  upsertExternalAccounts: vi.fn(async () => 1),
}));

vi.mock('../../connections/holdingStore', () => ({
  deactivateAllExternalHoldings: vi.fn(async () => 0),
  deactivateMissingExternalHoldings: vi.fn(async () => 1),
  listActiveExternalHoldings: vi.fn(async () => []),
  listExternalAssetOverrides: vi.fn(async () => []),
  upsertExternalAssetOverride: vi.fn(async () => null),
  getExternalAssetOverride: vi.fn(async () => null),
  upsertExternalHoldings: vi.fn(async () => 2),
}));

vi.mock('../../connections/syncRunStore', () => ({
  finishExternalSyncRun: vi.fn(async () => undefined),
  listLatestSyncRuns: vi.fn(async () => []),
  startExternalSyncRun: vi.fn(async () => ({
    id: 'run-1',
    uid: 'uid-1',
    provider: 'upstox',
    connectionId: 'uid-1:upstox',
    startedAt: Date.now(),
    status: 'failed',
    metrics: { accountsUpserted: 0, holdingsUpserted: 0, holdingsDeactivated: 0 },
  })),
}));

vi.mock('./upstoxAdapter', () => ({
  UpstoxAdapter: class {
    async refreshConnection() {
      return undefined;
    }

    async fetchAccounts(connection: { uid: string; id: string }) {
      return [{
        id: `acct:${connection.id}`,
        uid: connection.uid,
        connectionId: connection.id,
        provider: 'upstox',
        remoteAccountId: 'u123',
        accountName: 'Upstox Account',
        accountType: 'brokerage',
        currency: 'INR',
        syncedAt: Date.now(),
        isActive: true,
      }];
    }

    async fetchHoldings(connection: { uid: string; id: string }) {
      return [{
        id: 'h1',
        uid: connection.uid,
        connectionId: connection.id,
        accountId: `acct:${connection.id}`,
        provider: 'upstox',
        securityName: 'TCS',
        assetType: 'stock',
        quantity: 1,
        costCurrency: 'INR',
        priceCurrency: 'INR',
        accountCurrency: 'INR',
        syncedAt: Date.now(),
        isActive: true,
        sourceFingerprint: 'upstox:u123:TCS:holding',
        marketValue: 100,
      }];
    }
  },
}));

describe('upstoxService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CONNECTED_ACCOUNTS_STATE_SECRET = 'state-secret';
    process.env.CONNECTED_ACCOUNTS_ENCRYPTION_KEY = 'encryption-secret';
  });

  it('creates and verifies signed OAuth state', async () => {
    const { createSignedState, verifySignedState } = await import('./upstoxService.js');
    const state = createSignedState({ uid: 'uid-1', nonce: 'nonce-1', ttlMs: 60_000 });

    const payload = verifySignedState(state);
    expect(payload.uid).toBe('uid-1');
    expect(payload.nonce).toBe('nonce-1');
    expect(payload.exp).toBeGreaterThan(Date.now());
  });

  it('fails verification on tampered state', async () => {
    const { createSignedState, verifySignedState } = await import('./upstoxService.js');
    const state = createSignedState({ uid: 'uid-1', nonce: 'nonce-1', ttlMs: 60_000 });
    const tampered = `${state}x`;

    expect(() => verifySignedState(tampered)).toThrow('State signature mismatch');
  });

  it('marks missing holdings inactive during sync', async () => {
    const { getExternalConnection } = await import('../../connections/connectionStore.js');
    const { deactivateMissingExternalHoldings } = await import('../../connections/holdingStore.js');
    const mockedGetConnection = vi.mocked(getExternalConnection);
    mockedGetConnection.mockResolvedValue({
      id: 'uid-1:upstox',
      uid: 'uid-1',
      provider: 'upstox',
      status: 'connected',
      displayName: 'Upstox',
      connectedAt: Date.now(),
      updatedAt: Date.now(),
      tokenBlob: encryptJson({ accessToken: 'token' }),
    } as never);

    const { runUpstoxSync } = await import('./upstoxService.js');
    const result = await runUpstoxSync('uid-1');

    expect(result.status).toBe('success');
    expect(result.metrics.holdingsDeactivated).toBe(1);
    expect(vi.mocked(deactivateMissingExternalHoldings)).toHaveBeenCalledWith(
      'uid-1',
      'uid-1:upstox',
      ['upstox:u123:TCS:holding'],
    );
  });
});
