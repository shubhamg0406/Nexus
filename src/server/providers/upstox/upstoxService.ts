import crypto from 'crypto';
import {
  getExternalConnection,
  sanitizeExternalConnection,
  upsertExternalConnection,
  updateExternalConnectionStatus,
  clearExternalConnectionToken,
} from '../../connections/connectionStore.js';
import {
  deactivateMissingExternalAccounts,
  listExternalAccounts,
  upsertExternalAccounts,
} from '../../connections/accountStore.js';
import {
  deactivateAllExternalHoldings,
  deactivateMissingExternalHoldings,
  listActiveExternalHoldings,
  listExternalAssetOverrides,
  upsertExternalAssetOverride,
  getExternalAssetOverride,
  upsertExternalHoldings,
} from '../../connections/holdingStore.js';
import { finishExternalSyncRun, listLatestSyncRuns, startExternalSyncRun } from '../../connections/syncRunStore.js';
import { decryptJson, encryptJson } from '../../security/encryption.js';
import type { ExternalAccount, ExternalAssetOverride, ExternalConnection, ExternalHolding } from '../types.js';
import { UpstoxClient, type UpstoxTokenResponse } from './upstoxClient.js';
import { UpstoxAdapter } from './upstoxAdapter.js';

const OAUTH_STATE_COLLECTION = 'external_oauth_states';
const PROVIDER = 'upstox' as const;

type SignedStatePayload = {
  uid: string;
  nonce: string;
  exp: number;
};

type PersistedOAuthState = {
  provider: typeof PROVIDER;
  uid: string;
  nonce: string;
  expiresAt: number;
  createdAt: number;
};

type StoredTokenBlob = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scopes?: string[];
  expiresIn?: number;
};

function now() {
  return Date.now();
}

function getStateSecret() {
  const secret = process.env.CONNECTED_ACCOUNTS_STATE_SECRET?.trim() || process.env.SPLITWISE_STATE_SECRET?.trim();
  if (!secret) {
    throw new Error('Missing CONNECTED_ACCOUNTS_STATE_SECRET (or SPLITWISE_STATE_SECRET).');
  }
  return secret;
}

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const withPadding = padding ? normalized + '='.repeat(4 - padding) : normalized;
  return Buffer.from(withPadding, 'base64').toString('utf8');
}

function signStatePayload(payloadBase64: string) {
  return base64UrlEncode(crypto.createHmac('sha256', getStateSecret()).update(payloadBase64).digest());
}

function safeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 250);
  }
  return 'Unknown error';
}

export function createSignedState(input: { uid: string; nonce: string; ttlMs?: number }) {
  const payload: SignedStatePayload = {
    uid: input.uid,
    nonce: input.nonce,
    exp: now() + (input.ttlMs ?? 10 * 60 * 1000),
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = signStatePayload(encoded);
  return `${encoded}.${signature}`;
}

export function verifySignedState(state: string) {
  const [encodedPayload, signature] = state.split('.');
  if (!encodedPayload || !signature) {
    throw new Error('Invalid state format');
  }

  const expectedSignature = signStatePayload(encodedPayload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('State signature mismatch');
  }

  const decoded = JSON.parse(base64UrlDecode(encodedPayload)) as SignedStatePayload;
  if (!decoded.uid || !decoded.nonce || !decoded.exp) {
    throw new Error('State payload malformed');
  }
  if (decoded.exp < now()) {
    throw new Error('State expired');
  }

  return decoded;
}

export async function saveOAuthState(input: PersistedOAuthState) {
  const { getFirebaseAdminFirestore } = await import('../../firebaseAdmin.js');
  await getFirebaseAdminFirestore().collection(OAUTH_STATE_COLLECTION).doc(input.nonce).set(input);
}

export async function consumeOAuthState(nonce: string) {
  const { getFirebaseAdminFirestore } = await import('../../firebaseAdmin.js');
  const docRef = getFirebaseAdminFirestore().collection(OAUTH_STATE_COLLECTION).doc(nonce);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    throw new Error('OAuth state not found');
  }

  const payload = snapshot.data() as PersistedOAuthState;
  await docRef.delete();

  if (payload.provider !== PROVIDER) {
    throw new Error('OAuth provider mismatch');
  }
  if (payload.expiresAt < now()) {
    throw new Error('OAuth state expired');
  }

  return payload;
}

export function buildSettingsRedirect(params: Record<string, string | undefined>) {
  const target = new URL('/', process.env.APP_BASE_URL || 'http://localhost:3000');
  target.searchParams.set('view', 'settings');
  target.searchParams.set('section', 'integrations');
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      target.searchParams.set(key, value);
    }
  }
  return target.toString();
}

function parseScopes(scope: string | undefined) {
  if (!scope) return [];
  return scope.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
}

function readToken(connection: ExternalConnection): StoredTokenBlob {
  if (!connection.tokenBlob) {
    throw new Error('Connection token missing. Reconnect Upstox and try again.');
  }
  return decryptJson<StoredTokenBlob>(connection.tokenBlob);
}

function toConnectionDisplayName(profile: { user_name?: string; email?: string }) {
  return profile.user_name?.trim() || profile.email?.trim() || 'Upstox';
}

function sumMarketValue(holdings: ExternalHolding[]) {
  return holdings.reduce((sum, holding) => sum + (holding.marketValue || 0), 0);
}

function sumCashLikeValue(holdings: ExternalHolding[]) {
  return holdings
    .filter((holding) => holding.assetType === 'cash')
    .reduce((sum, holding) => sum + (holding.marketValue || 0), 0);
}

function mergeAccountMetrics(accounts: ExternalAccount[], holdings: ExternalHolding[]) {
  const byAccount = new Map<string, ExternalHolding[]>();
  for (const holding of holdings) {
    const rows = byAccount.get(holding.accountId) || [];
    rows.push(holding);
    byAccount.set(holding.accountId, rows);
  }

  return accounts.map((account) => {
    const rows = byAccount.get(account.id) || [];
    return {
      ...account,
      marketValue: sumMarketValue(rows),
      cashValue: sumCashLikeValue(rows),
      currentBalance: sumMarketValue(rows),
      syncedAt: now(),
      isActive: true,
    };
  });
}

function detectPossibleDuplicates(holdings: ExternalHolding[]) {
  const seen = new Map<string, string>();
  return holdings.map((holding) => {
    const dedupeKey = `${holding.provider}:${holding.isin || holding.ticker || holding.securityName}`.toLowerCase();
    const firstId = seen.get(dedupeKey);
    if (firstId) {
      return {
        ...holding,
        possibleDuplicateOf: firstId,
      };
    }

    seen.set(dedupeKey, holding.id || holding.sourceFingerprint);
    return holding;
  });
}

export async function finalizeConnectionFromOAuth(input: {
  uid: string;
  code: string;
  client?: UpstoxClient;
}) {
  const client = input.client || new UpstoxClient();
  const token = await client.exchangeCodeForToken(input.code);
  const profile = await client.getProfile(token.access_token);

  const encryptedToken = encryptJson({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type,
    scopes: parseScopes(token.scope),
    expiresIn: token.expires_in,
  } satisfies StoredTokenBlob);

  const connection = await upsertExternalConnection({
    uid: input.uid,
    provider: PROVIDER,
    status: 'connected',
    displayName: toConnectionDisplayName(profile),
    externalUserId: profile.user_id,
    externalUserLabel: profile.email || profile.user_name,
    tokenBlob: encryptedToken,
    scopes: parseScopes(token.scope),
    connectedAt: now(),
    lastError: undefined,
  });

  await runUpstoxSync(input.uid, connection.id);
  return connection;
}

async function ensureConnectionForSync(uid: string, connectionId?: string) {
  const connection = await getExternalConnection(uid, PROVIDER);
  if (!connection || (connectionId && connection.id !== connectionId)) {
    throw new Error('Upstox connection not found. Connect Upstox first.');
  }
  if (connection.status === 'disconnected' || connection.status === 'revoked') {
    throw new Error('Upstox connection is not active. Reconnect and try again.');
  }
  return connection;
}

export async function runUpstoxSync(uid: string, connectionId?: string) {
  const connection = await ensureConnectionForSync(uid, connectionId);
  const syncRun = await startExternalSyncRun({
    uid,
    provider: PROVIDER,
    connectionId: connection.id,
  });

  await updateExternalConnectionStatus(uid, PROVIDER, 'syncing', {
    lastSyncAt: now(),
    lastError: undefined,
  });

  try {
    const adapter = new UpstoxAdapter();
    await adapter.refreshConnection(connection);

    const accounts = await adapter.fetchAccounts(connection);
    const rawHoldings = await adapter.fetchHoldings(connection);
    const enrichedAccounts = mergeAccountMetrics(accounts, rawHoldings);
    const holdings = detectPossibleDuplicates(rawHoldings);

    const accountsUpserted = await upsertExternalAccounts(
      enrichedAccounts.map(({ id: _id, ...account }) => account),
    );

    const accountIds = enrichedAccounts.map((account) => account.remoteAccountId);
    await deactivateMissingExternalAccounts(uid, connection.id, accountIds);

    const holdingsUpserted = await upsertExternalHoldings(
      holdings.map(({ id: _id, ...holding }) => holding),
    );
    const holdingsDeactivated = await deactivateMissingExternalHoldings(
      uid,
      connection.id,
      holdings.map((holding) => holding.sourceFingerprint),
    );

    const timestamp = now();
    await updateExternalConnectionStatus(uid, PROVIDER, 'connected', {
      lastSyncAt: timestamp,
      lastSuccessfulSyncAt: timestamp,
      lastError: undefined,
    });

    const metrics = {
      accountsUpserted,
      holdingsUpserted,
      holdingsDeactivated,
    };

    await finishExternalSyncRun(syncRun.id, {
      status: 'success',
      metrics,
    });

    return {
      status: 'success' as const,
      metrics,
    };
  } catch (error) {
    const reason = safeError(error);
    await updateExternalConnectionStatus(uid, PROVIDER, 'error', {
      lastError: reason,
      lastSyncAt: now(),
    });

    await finishExternalSyncRun(syncRun.id, {
      status: 'failed',
      metrics: {
        accountsUpserted: 0,
        holdingsUpserted: 0,
        holdingsDeactivated: 0,
      },
      errorSummary: reason,
    });

    throw error;
  }
}

export async function getUpstoxStatus(uid: string) {
  const connection = await getExternalConnection(uid, PROVIDER);
  if (!connection) {
    return {
      provider: PROVIDER,
      status: 'disconnected' as const,
      displayName: 'Upstox',
      accounts: [],
      holdingsSummary: {
        totalMarketValueByCurrency: [] as Array<{ currency: string; value: number }>,
        totalHoldingsCount: 0,
        totalPositionsCount: 0,
      },
      syncRuns: [],
    };
  }

  const [accounts, holdings, syncRuns] = await Promise.all([
    listExternalAccounts(uid, connection.id),
    listActiveExternalHoldings(uid, connection.id),
    listLatestSyncRuns(uid, PROVIDER, 3),
  ]);

  const totalsByCurrency = new Map<string, number>();
  let totalHoldingsCount = 0;
  let totalPositionsCount = 0;

  for (const holding of holdings) {
    const value = holding.marketValue || 0;
    const currency = holding.accountCurrency || holding.priceCurrency || 'INR';
    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) || 0) + value);

    if (holding.holdingKind === 'position') {
      totalPositionsCount += 1;
    } else {
      totalHoldingsCount += 1;
    }
  }

  return {
    ...(sanitizeExternalConnection(connection) || {
      provider: PROVIDER,
      status: 'disconnected' as const,
      displayName: 'Upstox',
    }),
    provider: PROVIDER,
    accounts: accounts
      .filter((account) => account.isActive)
      .map((account) => ({
        id: account.id,
        accountName: account.accountName,
        currency: account.currency,
        marketValue: account.marketValue,
        cashValue: account.cashValue,
      })),
    holdingsSummary: {
      totalMarketValueByCurrency: Array.from(totalsByCurrency.entries())
        .map(([currency, value]) => ({ currency, value }))
        .sort((left, right) => left.currency.localeCompare(right.currency)),
      totalHoldingsCount,
      totalPositionsCount,
    },
    syncRuns: syncRuns.map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      status: run.status,
      metrics: run.metrics,
      errorSummary: run.errorSummary,
    })),
  };
}

export async function disconnectUpstox(uid: string) {
  const connection = await getExternalConnection(uid, PROVIDER);
  if (!connection) {
    return { success: true, deactivatedHoldings: 0 };
  }

  await clearExternalConnectionToken(uid, PROVIDER);
  const deactivatedHoldings = await deactivateAllExternalHoldings(uid, connection.id);
  await updateExternalConnectionStatus(uid, PROVIDER, 'disconnected', {
    lastError: undefined,
  });

  return {
    success: true,
    deactivatedHoldings,
  };
}

export async function listUpstoxHoldingsWithOverrides(uid: string) {
  const connection = await getExternalConnection(uid, PROVIDER);
  if (!connection) {
    return [] as Array<ExternalHolding & { override: ExternalAssetOverride | null }>;
  }

  const holdings = await listActiveExternalHoldings(uid, connection.id);
  const overrides = await listExternalAssetOverrides(uid, holdings.map((holding) => holding.id));
  const overrideByHoldingId = new Map(overrides.map((override) => [override.holdingId, override]));

  return holdings.map((holding) => ({
    ...holding,
    override: overrideByHoldingId.get(holding.id) || null,
  }));
}

export async function saveUpstoxHoldingOverride(
  uid: string,
  holdingId: string,
  patch: Partial<Omit<ExternalAssetOverride, 'uid' | 'holdingId' | 'updatedAt'>>,
) {
  const connection = await getExternalConnection(uid, PROVIDER);
  if (!connection) {
    throw new Error('Upstox connection not found.');
  }

  const holdings = await listActiveExternalHoldings(uid, connection.id);
  const exists = holdings.some((holding) => holding.id === holdingId);
  if (!exists) {
    const existingOverride = await getExternalAssetOverride(uid, holdingId);
    if (!existingOverride) {
      throw new Error('Holding not found for this user.');
    }
  }

  return upsertExternalAssetOverride(uid, holdingId, patch);
}

export async function buildUpstoxAuthorizeUrl(uid: string, client?: UpstoxClient) {
  const nonce = crypto.randomUUID();
  const state = createSignedState({ uid, nonce });
  await saveOAuthState({
    provider: PROVIDER,
    uid,
    nonce,
    expiresAt: now() + 10 * 60 * 1000,
    createdAt: now(),
  });

  return (client || new UpstoxClient()).getAuthorizeUrl(state);
}

export async function completeUpstoxCallback(params: {
  state: string;
  code: string;
  client?: UpstoxClient;
}) {
  const verifiedState = verifySignedState(params.state);
  const persisted = await consumeOAuthState(verifiedState.nonce);
  if (persisted.uid !== verifiedState.uid) {
    throw new Error('OAuth state user mismatch.');
  }

  const connection = await finalizeConnectionFromOAuth({
    uid: persisted.uid,
    code: params.code,
    client: params.client,
  });

  return connection;
}

export function serializeUpstoxToken(token: UpstoxTokenResponse) {
  return encryptJson({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type,
    scopes: parseScopes(token.scope),
    expiresIn: token.expires_in,
  } satisfies StoredTokenBlob);
}

export function readUpstoxAccessToken(connection: ExternalConnection) {
  const token = readToken(connection);
  if (!token.accessToken) {
    throw new Error('Upstox access token missing. Reconnect the account.');
  }
  return token.accessToken;
}
