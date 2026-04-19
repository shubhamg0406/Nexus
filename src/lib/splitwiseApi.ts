import { auth } from './firebase';
import type { SplitwiseStatusResponse, SplitwiseSummaryResponse } from './splitwiseTypes';

async function requireCurrentUserToken() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to use Splitwise integration.');
  }
  return currentUser.getIdToken();
}

export async function getAuthHeaders() {
  const token = await requireCurrentUserToken();
  return {
    Authorization: `Bearer ${token}`,
  } satisfies Record<string, string>;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error?: string }).error || 'Request failed')
      : 'Request failed';
    throw new Error(message);
  }
  return payload as T;
}

async function getSplitwiseAuthorizeUrl(idToken: string) {
  const headers = { Authorization: `Bearer ${idToken}` };
  const connectEndpoints = [
    '/api/integrations/splitwise/connect?format=json',
    '/api/splitwise/connect?format=json',
  ];
  let firstError: string | null = null;

  for (const endpoint of connectEndpoints) {
    try {
      const response = await fetch(endpoint, { headers });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error?: string }).error || 'Request failed')
          : `Splitwise connect request failed (${response.status}).`;
        if (!firstError) firstError = message;
        continue;
      }

      const authorizeUrl =
        payload && typeof payload === 'object' && 'authorizeUrl' in payload
          ? String((payload as { authorizeUrl?: string }).authorizeUrl || '')
          : '';
      if (authorizeUrl) {
        return authorizeUrl;
      }
      if (!firstError) {
        firstError = 'Splitwise OAuth URL is missing. Check server Splitwise env setup.';
      }
    } catch (error) {
      if (!firstError) {
        firstError = error instanceof Error ? error.message : 'Failed to request Splitwise authorization URL.';
      }
    }
  }

  throw new Error(firstError || 'Failed to start Splitwise connection.');
}

export async function getSplitwiseStatus() {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/splitwise/status', { headers });
  return parseJsonResponse<SplitwiseStatusResponse>(response);
}

export async function getSplitwiseSummary(params?: { limit?: number; groupId?: number }) {
  const headers = await getAuthHeaders();
  const url = new URL('/api/splitwise/summary', window.location.origin);
  if (typeof params?.limit === 'number') {
    url.searchParams.set('limit', String(params.limit));
  }
  if (typeof params?.groupId === 'number') {
    url.searchParams.set('groupId', String(params.groupId));
  }

  const response = await fetch(url.pathname + url.search, { headers });
  return parseJsonResponse<SplitwiseSummaryResponse>(response);
}

export async function disconnectSplitwise() {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/splitwise/disconnect', {
    method: 'POST',
    headers,
  });
  return parseJsonResponse<{ success: boolean }>(response);
}

export async function connectSplitwise() {
  const token = await requireCurrentUserToken();
  const authorizeUrl = await getSplitwiseAuthorizeUrl(token);
  return new Promise<void>((resolve, reject) => {
    let popup: Window | null = null;
    let pollTimer: number | null = null;
    let settled = false;
    const allowedOrigins = new Set<string>([window.location.origin]);
    const localStorageResultKey = 'splitwise_oauth_result';

    try {
      const parsedAuthorizeUrl = new URL(authorizeUrl, window.location.origin);
      const redirectUri = parsedAuthorizeUrl.searchParams.get('redirect_uri');
      if (redirectUri) {
        const callbackOrigin = new URL(redirectUri).origin;
        allowedOrigins.add(callbackOrigin);
      }
    } catch {
      // Ignore malformed authorize URL and keep default origin allow-list.
    }

    const isAllowedPopupOrigin = (origin: string) => {
      if (allowedOrigins.has(origin)) return true;
      try {
        const incoming = new URL(origin);
        const current = new URL(window.location.origin);
        const localHosts = new Set(['localhost', '127.0.0.1']);
        const bothLocal = localHosts.has(incoming.hostname) && localHosts.has(current.hostname);
        return bothLocal && incoming.protocol === current.protocol && incoming.port === current.port;
      } catch {
        return false;
      }
    };

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
      }
    };

    const consumeStoredPopupResult = () => {
      try {
        const raw = window.localStorage.getItem(localStorageResultKey);
        if (!raw) return null;
        window.localStorage.removeItem(localStorageResultKey);
        const parsed = JSON.parse(raw) as { type?: string; reason?: string; at?: number };
        if (!parsed?.type) return null;
        return {
          type: parsed.type,
          reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        };
      } catch {
        return null;
      }
    };

    const rejectFromLatestStatus = () => {
      void getSplitwiseStatus()
        .then((statusResponse) => {
          if (statusResponse.status === 'connected') {
            resolve();
            return;
          }
          const detailedReason =
            statusResponse.lastError ||
            (statusResponse.status === 'reconnect_needed'
              ? 'Splitwise requires reconnect.'
              : statusResponse.status === 'revoked'
                ? 'Splitwise connection was revoked.'
                : '');
          reject(new Error(detailedReason || 'Splitwise popup was closed before authorization completed.'));
        })
        .catch(() => {
          reject(new Error('Splitwise popup was closed before authorization completed.'));
        });
    };

    const onMessage = (event: MessageEvent) => {
      if (!isAllowedPopupOrigin(event.origin)) return;
      const messageType = event.data?.type;
      if (messageType === 'SPLITWISE_CONNECTED') {
        settled = true;
        cleanup();
        resolve();
        return;
      }
      if (messageType === 'SPLITWISE_CANCELLED') {
        settled = true;
        cleanup();
        reject(new Error('Splitwise authorization was cancelled.'));
        return;
      }
      if (messageType === 'SPLITWISE_ERROR') {
        settled = true;
        cleanup();
        reject(new Error(event.data?.reason || 'Splitwise connection failed.'));
      }
    };

    window.addEventListener('message', onMessage);
    // Clear stale popup result from any previous attempts.
    try {
      window.localStorage.removeItem(localStorageResultKey);
    } catch {
      // ignore
    }
    popup = window.open(
      authorizeUrl,
      'splitwise-oauth',
      'width=640,height=760,left=200,top=80',
    );
    if (!popup) {
      settled = true;
      cleanup();
      reject(new Error('Popup was blocked. Please allow popups and try again.'));
      return;
    }

    pollTimer = window.setInterval(() => {
      if (settled || !popup) return;

      const storedResult = consumeStoredPopupResult();
      if (storedResult) {
        settled = true;
        cleanup();
        if (storedResult.type === 'SPLITWISE_CONNECTED') {
          resolve();
          return;
        }
        if (storedResult.type === 'SPLITWISE_CANCELLED') {
          reject(new Error('Splitwise authorization was cancelled.'));
          return;
        }
        reject(new Error(storedResult.reason || 'Splitwise connection failed.'));
        return;
      }

      // Fallback: if postMessage is dropped, parse the callback result from the popup URL
      // once it returns to our origin (/api/splitwise/done?result=...).
      try {
        const popupUrl = new URL(popup.location.href);
        const donePath = '/api/splitwise/done';
        const legacyDonePath = '/api/integrations/splitwise/done';
        if (
          allowedOrigins.has(popupUrl.origin) &&
          (popupUrl.pathname === donePath || popupUrl.pathname === legacyDonePath)
        ) {
          const result = popupUrl.searchParams.get('result');
          const reason = popupUrl.searchParams.get('reason') || '';
          settled = true;
          cleanup();
          if (result === 'success') {
            resolve();
            return;
          }
          if (result === 'cancelled') {
            reject(new Error('Splitwise authorization was cancelled.'));
            return;
          }
          reject(new Error(reason || 'Splitwise connection failed.'));
          return;
        }
      } catch {
        // Cross-origin during OAuth flow; ignore until popup returns to app origin.
      }

      if (!settled && popup.closed) {
        settled = true;
        cleanup();
        rejectFromLatestStatus();
      }
    }, 500);
  });
}

export async function syncSplitwise() {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/splitwise/sync', {
    method: 'POST',
    headers,
  });
  return parseJsonResponse<{ success: boolean; value: number; currency: string; lastSyncedAt: number }>(response);
}
