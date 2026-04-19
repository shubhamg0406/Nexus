import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/requireFirebaseUser', () => ({
  requireFirebaseUser: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { uid: 'uid-1' };
    next();
  },
}));

vi.mock('./upstoxService', () => ({
  buildSettingsRedirect: vi.fn((params: Record<string, string>) => {
    const search = new URLSearchParams({ view: 'settings', section: 'integrations', ...params });
    return `/?${search.toString()}`;
  }),
  buildUpstoxAuthorizeUrl: vi.fn(async () => 'https://api-v2.upstox.com/dialog'),
  completeUpstoxCallback: vi.fn(async () => ({})),
  disconnectUpstox: vi.fn(async () => ({ success: true, deactivatedHoldings: 0 })),
  getUpstoxStatus: vi.fn(async () => ({ provider: 'upstox', status: 'disconnected', displayName: 'Upstox', accounts: [], holdingsSummary: { totalMarketValueByCurrency: [], totalHoldingsCount: 0, totalPositionsCount: 0 } })),
  listUpstoxHoldingsWithOverrides: vi.fn(async () => []),
  runUpstoxSync: vi.fn(async () => ({ status: 'success', metrics: { accountsUpserted: 1, holdingsUpserted: 1, holdingsDeactivated: 0 } })),
  saveUpstoxHoldingOverride: vi.fn(async () => ({ uid: 'uid-1', holdingId: 'h1', updatedAt: Date.now() })),
  verifySignedState: vi.fn(() => ({ uid: 'uid-1', nonce: 'nonce-1', exp: Date.now() + 10_000 })),
}));

vi.mock('../../connections/connectionStore', () => ({
  updateExternalConnectionStatus: vi.fn(async () => undefined),
}));

describe('upstoxRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects callback success to integrations page', async () => {
    const { createUpstoxRouter } = await import('./upstoxRoutes.js');
    const app = express();
    app.use('/api/connections/upstox', createUpstoxRouter());

    const response = await request(app).get('/api/connections/upstox/callback?state=state&code=code');
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('upstox=success');
  });

  it('redirects callback failure and marks connection error when state is valid', async () => {
    const { completeUpstoxCallback } = await import('./upstoxService.js');
    vi.mocked(completeUpstoxCallback).mockRejectedValueOnce(new Error('Callback failed'));

    const { updateExternalConnectionStatus } = await import('../../connections/connectionStore.js');
    const { createUpstoxRouter } = await import('./upstoxRoutes.js');
    const app = express();
    app.use('/api/connections/upstox', createUpstoxRouter());

    const response = await request(app).get('/api/connections/upstox/callback?state=state&code=code');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('upstox=error');
    expect(vi.mocked(updateExternalConnectionStatus)).toHaveBeenCalledWith('uid-1', 'upstox', 'error', {
      lastError: 'Callback failed',
    });
  });
});
