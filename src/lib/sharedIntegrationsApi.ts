import { auth } from './firebase';
import type { ConnectedHolding, UpstoxConnectionSummary } from './connectedAccountsApi';
import type { SplitwiseStatusResponse, SplitwiseSummaryResponse } from './splitwiseTypes';

export type SharedIntegrationMember = {
  member: {
    uid: string;
    email: string;
    role: 'owner' | 'partner';
    label: string;
  };
  upstox: {
    status: UpstoxConnectionSummary;
    holdings: ConnectedHolding[];
    error?: string;
  };
  splitwise: {
    status: SplitwiseStatusResponse;
    summary: SplitwiseSummaryResponse | null;
    error?: string;
  };
};

export type SharedIntegrationsResponse = {
  portfolioId: string;
  members: SharedIntegrationMember[];
};

async function requireAuthHeaders() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to use shared integrations.');
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
  if (!payload) {
    throw new Error('Server returned an empty response. Please retry.');
  }
  return payload as T;
}

export async function getSharedIntegrations(portfolioId: string) {
  const headers = await requireAuthHeaders();
  const response = await fetch(`/api/integrations/shared?portfolioId=${encodeURIComponent(portfolioId)}`, { headers });
  return parseJsonResponse<SharedIntegrationsResponse>(response);
}

export async function disconnectSharedIntegration(input: {
  portfolioId: string;
  provider: 'upstox' | 'splitwise';
  targetUid: string;
}) {
  const headers = await requireAuthHeaders();
  const response = await fetch('/api/integrations/shared/disconnect', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  return parseJsonResponse<{ success: boolean }>(response);
}

export async function refreshSharedIntegration(input: {
  portfolioId: string;
  provider: 'upstox' | 'splitwise';
  targetUid: string;
}) {
  const headers = await requireAuthHeaders();
  const response = await fetch('/api/integrations/shared/refresh', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  return parseJsonResponse<{ success: boolean }>(response);
}
