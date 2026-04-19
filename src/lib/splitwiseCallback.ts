import type { SplitwiseConnectionStatus, SplitwiseStatusResponse } from './splitwiseTypes';

export function normalizeSplitwiseStatus(status: SplitwiseStatusResponse['status']): SplitwiseConnectionStatus {
  if (status === 'connected') return 'connected';
  if (status === 'error') return 'error';
  if (status === 'revoked') return 'revoked';
  if (status === 'reconnect_needed') return 'reconnect_needed';
  return 'disconnected';
}

export function parseSplitwiseCallbackResult(href: string) {
  const url = new URL(href, 'http://localhost');
  const splitwise = url.searchParams.get('splitwise');
  const reason = url.searchParams.get('reason');
  if (!splitwise) {
    return { result: null as { status: 'connecting' | 'error'; error: string | null } | null, cleanedPath: `${url.pathname}${url.search}` };
  }

  const cleanedUrl = new URL(url.toString());
  cleanedUrl.searchParams.delete('splitwise');
  cleanedUrl.searchParams.delete('reason');

  if (splitwise === 'success') {
    return {
      result: { status: 'connecting' as const, error: null },
      cleanedPath: `${cleanedUrl.pathname}${cleanedUrl.search}`,
    };
  }

  return {
    result: { status: 'error' as const, error: reason || 'Splitwise callback failed.' },
    cleanedPath: `${cleanedUrl.pathname}${cleanedUrl.search}`,
  };
}
