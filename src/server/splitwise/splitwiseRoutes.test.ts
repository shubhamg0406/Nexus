import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SplitwiseApiError } from './splitwiseClient.js';

const mockVerifySignedState = vi.fn();
const mockConsumeOAuthState = vi.fn();
const mockFinalizeConnectionFromOAuth = vi.fn();
const mockMarkConnectionError = vi.fn();
const mockMarkConnectionReconnectNeeded = vi.fn();
const mockSoftRevokeConnection = vi.fn();
const mockGetStatusForUid = vi.fn();
const mockFetchAndBuildSummary = vi.fn();
const mockCreateSignedState = vi.fn();
const mockSaveOAuthState = vi.fn();
const mockSynchronizeSplitwiseReceivable = vi.fn();
const mockVerifyIdToken = vi.fn();

vi.mock('../firebaseAdmin', () => ({
  getFirebaseAdminAuth: () => ({
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  }),
}));

vi.mock('../auth/requireFirebaseUser', () => ({
  requireFirebaseUser: (req: any, _res: any, next: any) => {
    req.user = { uid: 'firebase-user-1', email: 'user@example.com', name: 'Test' };
    next();
  },
}));

vi.mock('./splitwiseService', () => ({
  verifySignedState: (...args: unknown[]) => mockVerifySignedState(...args),
  consumeOAuthState: (...args: unknown[]) => mockConsumeOAuthState(...args),
  finalizeConnectionFromOAuth: (...args: unknown[]) => mockFinalizeConnectionFromOAuth(...args),
  markConnectionError: (...args: unknown[]) => mockMarkConnectionError(...args),
  markConnectionReconnectNeeded: (...args: unknown[]) => mockMarkConnectionReconnectNeeded(...args),
  softRevokeConnection: (...args: unknown[]) => mockSoftRevokeConnection(...args),
  getStatusForUid: (...args: unknown[]) => mockGetStatusForUid(...args),
  fetchAndBuildSummary: (...args: unknown[]) => mockFetchAndBuildSummary(...args),
  createSignedState: (...args: unknown[]) => mockCreateSignedState(...args),
  saveOAuthState: (...args: unknown[]) => mockSaveOAuthState(...args),
  synchronizeSplitwiseReceivable: (...args: unknown[]) => mockSynchronizeSplitwiseReceivable(...args),
}));

import { createSplitwiseRouter } from './splitwiseRoutes.js';

function createAppWithRouter(client?: unknown) {
  const app = express();
  app.use('/api/splitwise', createSplitwiseRouter(client as any));
  return app;
}

describe.skip('splitwise routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'firebase-user-1' });
  });

  it('connect returns authorize url in json mode', async () => {
    mockCreateSignedState.mockReturnValue('signed-state');
    const client = {
      getAuthorizeUrl: vi.fn().mockReturnValue('https://secure.splitwise.com/oauth/authorize?x=1'),
      exchangeCodeForAccessToken: vi.fn(),
    };

    const response = await request(createAppWithRouter(client)).get('/api/splitwise/connect?format=json&idToken=fake');

    expect(response.status).toBe(200);
    expect(response.body.authorizeUrl).toContain('secure.splitwise.com');
    expect(mockSaveOAuthState).toHaveBeenCalled();
  });

  it('handles callback success path', async () => {
    mockVerifySignedState.mockReturnValue({ uid: 'firebase-user-1', nonce: 'nonce-1', exp: Date.now() + 1000 });
    mockConsumeOAuthState.mockResolvedValue({
      uid: 'firebase-user-1',
      nonce: 'nonce-1',
      state: 'signed-state',
      expiresAt: Date.now() + 1000,
      createdAt: Date.now(),
    });
    mockFinalizeConnectionFromOAuth.mockResolvedValue(undefined);
    mockSynchronizeSplitwiseReceivable.mockResolvedValue(undefined);

    const client = {
      exchangeCodeForAccessToken: vi.fn().mockResolvedValue({
        accessToken: 'a',
      }),
      getAuthorizeUrl: vi.fn(),
    };

    const response = await request(createAppWithRouter(client)).get('/api/splitwise/callback').query({
      state: 'signed-state',
      code: 'oauth-code',
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/api/splitwise/done?result=success');
    expect(client.exchangeCodeForAccessToken).toHaveBeenCalled();
    expect(mockFinalizeConnectionFromOAuth).toHaveBeenCalled();
  });

  it('soft revokes on disconnect endpoint', async () => {
    mockSoftRevokeConnection.mockResolvedValue(undefined);

    const response = await request(createAppWithRouter({})).post('/api/splitwise/disconnect');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mockSoftRevokeConnection).toHaveBeenCalledWith('firebase-user-1');
  });

  it('sync maps splitwise 401 to reconnect-needed', async () => {
    mockSynchronizeSplitwiseReceivable.mockRejectedValue(new SplitwiseApiError('Unauthorized', 401));
    const response = await request(createAppWithRouter({})).post('/api/splitwise/sync');

    expect(response.status).toBe(401);
    expect(mockMarkConnectionReconnectNeeded).toHaveBeenCalledWith(
      'firebase-user-1',
      expect.stringContaining('reconnect'),
    );
  });
});
