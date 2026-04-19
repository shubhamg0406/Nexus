import { describe, expect, it, vi } from 'vitest';
import { SplitwiseClient } from './splitwiseClient.js';

describe('SplitwiseClient OAuth2', () => {
  it('builds OAuth2 authorize URL with state and redirect URI', () => {
    const client = new SplitwiseClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://localhost:3000/api/splitwise/callback',
      apiBaseUrl: 'https://secure.splitwise.com/api/v3.0',
      oauthTokenUrl: 'https://secure.splitwise.com/oauth/token',
      oauthAuthorizeUrl: 'https://secure.splitwise.com/oauth/authorize',
    });

    const authorizeUrl = client.getAuthorizeUrl('signed-state');
    expect(authorizeUrl).toContain('/oauth/authorize');
    expect(authorizeUrl).toContain('response_type=code');
    expect(authorizeUrl).toContain('state=signed-state');
  });

  it('exchanges code for token using oauth/token endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1' }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new SplitwiseClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://localhost:3000/api/splitwise/callback',
      apiBaseUrl: 'https://secure.splitwise.com/api/v3.0',
      oauthTokenUrl: 'https://secure.splitwise.com/oauth/token',
      oauthAuthorizeUrl: 'https://secure.splitwise.com/oauth/authorize',
    });

    const token = await client.exchangeCodeForAccessToken('code-123');

    const firstUrl = fetchMock.mock.calls[0] ? String(fetchMock.mock.calls[0][0]) : '';
    expect(firstUrl).toContain('/oauth/token');
    expect(token.accessToken).toBe('access-1');
    expect(token.refreshToken).toBe('refresh-1');
  });
});
