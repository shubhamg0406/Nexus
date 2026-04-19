import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignedState, normalizeBalancesForCurrentUser, verifySignedState } from './splitwiseService.js';

describe('splitwise service state signing', () => {
  beforeEach(() => {
    process.env.SPLITWISE_STATE_SECRET = 'test-secret';
  });

  it('signs and verifies a valid state', () => {
    const state = createSignedState({ uid: 'uid-1', nonce: 'nonce-1', ttlMs: 10_000 });
    const verified = verifySignedState(state);

    expect(verified.uid).toBe('uid-1');
    expect(verified.nonce).toBe('nonce-1');
    expect(verified.exp).toBeGreaterThan(Date.now());
  });

  it('rejects tampered state', () => {
    const state = createSignedState({ uid: 'uid-1', nonce: 'nonce-1', ttlMs: 10_000 });
    const tampered = `${state}x`;

    expect(() => verifySignedState(tampered)).toThrow();
  });

  it('rejects expired state', () => {
    vi.useFakeTimers();
    const now = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(now);

    const state = createSignedState({ uid: 'uid-1', nonce: 'nonce-1', ttlMs: 1000 });
    vi.setSystemTime(new Date(now.getTime() + 2000));

    expect(() => verifySignedState(state)).toThrow('State expired');
    vi.useRealTimers();
  });
});

describe('splitwise service balance normalization', () => {
  it('groups balances by currency with deterministic ordering and zero filtering', () => {
    const normalized = normalizeBalancesForCurrentUser([
      { currency_code: 'usd', amount: '-10.50' },
      { currency_code: 'CAD', amount: '5' },
      { currency_code: 'USD', amount: '3.25' },
      { currency_code: 'JPY', amount: '0' },
      { currency_code: 'CAD', amount: '-1.5' },
      { currency_code: 'CAD', amount: 'foo' },
    ]);

    expect(normalized.owes).toEqual([
      { currency: 'CAD', amount: 1.5 },
      { currency: 'USD', amount: 10.5 },
    ]);
    expect(normalized.owed).toEqual([
      { currency: 'CAD', amount: 5 },
      { currency: 'USD', amount: 3.25 },
    ]);
    expect(normalized.net).toEqual([
      { currency: 'CAD', amount: 3.5 },
      { currency: 'USD', amount: -7.25 },
    ]);
  });
});
