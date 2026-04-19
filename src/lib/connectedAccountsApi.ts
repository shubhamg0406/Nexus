import { auth } from './firebase';

export type ConnectedProviderStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error'
  | 'revoked';

export type UpstoxConnectionSummary = {
  provider: 'upstox';
  status: ConnectedProviderStatus;
  displayName: string;
  connectedAt?: number;
  lastSyncAt?: number;
  lastError?: string;
  accounts: Array<{
    id: string;
    accountName: string;
    currency: string;
    marketValue?: number;
    cashValue?: number;
  }>;
  holdingsSummary: {
    totalMarketValueByCurrency: Array<{ currency: string; value: number }>;
    totalHoldingsCount: number;
    totalPositionsCount: number;
  };
  syncRuns?: Array<{
    id: string;
    startedAt: number;
    finishedAt?: number;
    status: 'success' | 'partial' | 'failed';
    metrics: {
      accountsUpserted: number;
      holdingsUpserted: number;
      holdingsDeactivated: number;
    };
    errorSummary?: string;
  }>;
};

export type ConnectedHolding = {
  id: string;
  provider: 'upstox';
  isin?: string;
  ticker?: string;
  securityName: string;
  assetType: 'stock' | 'etf' | 'fund' | 'cash' | 'derivative' | 'other';
  quantity: number;
  averageCost?: number;
  investedValue?: number;
  costCurrency: string;
  price?: number;
  priceCurrency: string;
  marketValue?: number;
  unrealizedPnl?: number;
  accountCurrency: string;
  holdingKind?: 'holding' | 'position';
  possibleDuplicateOf?: string;
  override?: {
    customLabel?: string;
    ownerOverride?: string;
    assetClassOverride?: string;
    hidden?: boolean;
    notes?: string;
  } | null;
};

async function requireAuthHeaders() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to use connected accounts.');
  }

  const token = await currentUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
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
  if (payload == null) {
    throw new Error('Server returned an empty response. Please retry.');
  }
  return payload as T;
}

export async function getUpstoxConnectionStatus() {
  const headers = await requireAuthHeaders();
  const response = await fetch('/api/connections/upstox/status', { headers });
  return parseJsonResponse<UpstoxConnectionSummary>(response);
}

export async function getUpstoxHoldings() {
  const headers = await requireAuthHeaders();
  const response = await fetch('/api/connections/upstox/holdings', { headers });
  const payload = await parseJsonResponse<{ holdings: ConnectedHolding[] }>(response);
  return payload.holdings || [];
}

export async function refreshUpstoxConnection() {
  const headers = await requireAuthHeaders();
  const response = await fetch('/api/connections/upstox/refresh', {
    method: 'POST',
    headers,
  });

  return parseJsonResponse<{
    status: 'success';
    metrics: {
      accountsUpserted: number;
      holdingsUpserted: number;
      holdingsDeactivated: number;
    };
  }>(response);
}

export async function disconnectUpstoxConnection() {
  const headers = await requireAuthHeaders();
  const response = await fetch('/api/connections/upstox/disconnect', {
    method: 'POST',
    headers,
  });
  return parseJsonResponse<{ success: boolean; deactivatedHoldings: number }>(response);
}

export async function startUpstoxConnectFlow() {
  const headers = await requireAuthHeaders();
  const response = await fetch('/api/connections/upstox/connect?format=json', { headers });
  const payload = await parseJsonResponse<{ authorizeUrl: string }>(response);
  if (!payload.authorizeUrl || typeof payload.authorizeUrl !== 'string') {
    throw new Error('Upstox OAuth URL is missing. Check server Upstox env setup.');
  }

  window.location.assign(payload.authorizeUrl);
}

export async function saveConnectedHoldingOverride(
  holdingId: string,
  patch: {
    customLabel?: string;
    ownerOverride?: string;
    assetClassOverride?: string;
    hidden?: boolean;
    notes?: string;
  },
) {
  const headers = await requireAuthHeaders();
  const response = await fetch(`/api/connections/upstox/overrides/${encodeURIComponent(holdingId)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(patch),
  });

  return parseJsonResponse<{ override: ConnectedHolding['override'] }>(response);
}
