import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectSplitwise } from './splitwiseApi';

const mockGetIdToken = vi.fn(async () => 'firebase-token');

vi.mock('./firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: () => mockGetIdToken(),
    },
  },
}));

describe('splitwiseApi connectSplitwise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ authorizeUrl: 'https://secure.splitwise.com/oauth/authorize?foo=bar' }),
    })));
    vi.stubGlobal('window', {
      open: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      location: { origin: 'http://localhost:3000' },
    });
  });

  it('throws when popup is blocked', async () => {
    await expect(connectSplitwise()).rejects.toThrow('Popup was blocked');
  });

  it('falls back to legacy endpoint when integrations route fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authorizeUrl: 'https://secure.splitwise.com/oauth/authorize?fallback=yes' }),
      }));

    await expect(connectSplitwise()).rejects.toThrow('Popup was blocked');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/integrations/splitwise/connect?format=json',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer firebase-token' }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/splitwise/connect?format=json',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer firebase-token' }),
      }),
    );
  });
});
