import { describe, expect, it } from 'vitest';
import { normalizeSplitwiseStatus, parseSplitwiseCallbackResult } from '../lib/splitwiseCallback';

describe('SplitwiseContext helpers', () => {
  it('maps backend status to UI status', () => {
    expect(normalizeSplitwiseStatus('connected')).toBe('connected');
    expect(normalizeSplitwiseStatus('error')).toBe('error');
    expect(normalizeSplitwiseStatus('revoked')).toBe('revoked');
    expect(normalizeSplitwiseStatus('reconnect_needed')).toBe('reconnect_needed');
    expect(normalizeSplitwiseStatus('disconnected')).toBe('disconnected');
  });

  it('parses callback success and strips query params', () => {
    const parsed = parseSplitwiseCallbackResult('http://localhost:3000/?view=settings&splitwise=success&reason=x');
    expect(parsed.result).toEqual({ status: 'connecting', error: null });
    expect(parsed.cleanedPath).toBe('/?view=settings');
  });

  it('parses callback failure and returns readable error', () => {
    const parsed = parseSplitwiseCallbackResult('http://localhost:3000/?splitwise=error&reason=State%20expired');
    expect(parsed.result).toEqual({ status: 'error', error: 'State expired' });
    expect(parsed.cleanedPath).toBe('/');
  });
});
