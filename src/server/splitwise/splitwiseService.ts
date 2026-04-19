import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  CurrencyAmount,
  SplitwiseExpenseSummary,
  SplitwiseGroupSummary,
  SplitwiseStatusResponse,
  SplitwiseSummaryResponse,
} from '../../lib/splitwiseTypes.js';
import { fetchExchangeRates } from '../../lib/api.js';
import { decryptJson, encryptJson } from '../security/encryption.js';
import {
  SplitwiseClient,
  type SplitwiseCurrentUser,
  type SplitwiseExpense,
  type SplitwiseGroup,
  type SplitwiseTokenPair,
} from './splitwiseClient.js';
import { getFirebaseAdminFirestore } from '../firebaseAdmin.js';

const CONNECTIONS_COLLECTION = 'splitwise_connections';
const OAUTH_STATES_COLLECTION = 'splitwise_oauth_states';
const TARGET_CURRENCY = 'CAD';

type OAuthStatePayload = {
  uid: string;
  nonce: string;
  exp: number;
};

type PersistedOAuthState = {
  uid: string;
  state: string;
  nonce: string;
  expiresAt: number;
  createdAt: number;
};

type StoredTokenBlob = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string[];
};

export type SplitwiseConnectionDoc = {
  uid: string;
  email?: string;

  splitwiseUserId?: number;
  splitwiseEmail?: string;
  splitwiseFirstName?: string;
  splitwiseLastName?: string;
  splitwiseDefaultCurrency?: string;
  splitwisePictureUrl?: string;

  authProvider: 'oauth2';
  encryptedToken?: ReturnType<typeof encryptJson>;

  status: 'connected' | 'error' | 'revoked' | 'reconnect_needed';
  connectedAt: number;
  updatedAt: number;
  lastSyncAt?: number;
  lastError?: string;
  receivableTotal?: number;
  receivableCurrency?: string;
  lastReceivableBreakdown?: CurrencyAmount[];
};

function now() {
  return Date.now();
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function getStateSecret() {
  const secret = process.env.SPLITWISE_STATE_SECRET?.trim();
  if (!secret) {
    throw new Error('Missing required config: SPLITWISE_STATE_SECRET');
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

function makeHmacSignature(payloadBase64: string, secret: string) {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(payloadBase64).digest());
}

function parseAmount(value: string | number | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== 'string') {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currencyOrFallback(input: string | undefined) {
  const value = (input || '').trim().toUpperCase();
  return value || 'UNKNOWN';
}

function sortedCurrencyAmounts(map: Map<string, number>) {
  return Array.from(map.entries())
    .filter(([, amount]) => Math.abs(amount) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({ currency, amount }));
}

function updateMap(map: Map<string, number>, currency: string, delta: number) {
  map.set(currency, (map.get(currency) || 0) + delta);
}

function toProfile(currentUser: SplitwiseCurrentUser) {
  return {
    id: currentUser.id,
    firstName: currentUser.first_name,
    lastName: currentUser.last_name,
    email: currentUser.email,
    defaultCurrency: currentUser.default_currency,
    pictureUrl:
      currentUser.picture?.custom ||
      currentUser.picture?.medium ||
      currentUser.picture?.small ||
      currentUser.picture?.large,
  };
}

function displayNameFromCreatedBy(expense: SplitwiseExpense) {
  const first = expense.created_by?.first_name?.trim();
  const last = expense.created_by?.last_name?.trim();
  if (first || last) {
    return [first, last].filter(Boolean).join(' ');
  }
  return expense.created_by?.email;
}

function normalizeRecentExpenses(expenses: SplitwiseExpense[], groupsById: Map<number, SplitwiseGroup>): SplitwiseExpenseSummary[] {
  return expenses.map((expense) => {
    const group = typeof expense.group_id === 'number' ? groupsById.get(expense.group_id) : undefined;
    return {
      id: typeof expense.id === 'number' ? expense.id : -1,
      description: expense.description?.trim() || 'Expense',
      cost: expense.cost || '0',
      currencyCode: expense.currency_code,
      date: expense.date || new Date().toISOString(),
      groupId: expense.group_id,
      groupName: group?.name,
      payment: expense.payment,
      createdBy: displayNameFromCreatedBy(expense),
    };
  });
}

function normalizeGroupBalances(currentUserId: number | undefined, group: SplitwiseGroup): CurrencyAmount[] {
  if (!currentUserId) return [];
  const member = (group.members || []).find((candidate) => candidate.id === currentUserId);
  if (!member?.balance) return [];

  const net = new Map<string, number>();
  for (const balance of member.balance) {
    const amount = parseAmount(balance.amount);
    if (!amount) continue;
    const currency = currencyOrFallback(balance.currency_code);
    updateMap(net, currency, amount);
  }

  return sortedCurrencyAmounts(net);
}

function normalizeGroups(groups: SplitwiseGroup[], currentUserId?: number): SplitwiseGroupSummary[] {
  return groups
    .filter((group): group is SplitwiseGroup & { id: number } => typeof group.id === 'number')
    .map((group) => ({
      id: group.id,
      name: group.name?.trim() || `Group ${group.id}`,
      updatedAt: group.updated_at,
      memberCount: Array.isArray(group.members) ? group.members.length : 0,
      balances: normalizeGroupBalances(currentUserId, group),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getCurrentUserBalanceEntries(currentUser: SplitwiseCurrentUser) {
  const candidate = Array.isArray(currentUser.balance) ? currentUser.balance : currentUser.balances;
  return Array.isArray(candidate) ? candidate : [];
}

function aggregateBalancesByCurrency(
  entries: Array<{ currency_code?: string; amount?: string | number }>,
) {
  const byCurrency = new Map<string, number>();
  for (const entry of entries) {
    const amount = parseAmount(entry.amount);
    if (!amount) continue;
    const currency = currencyOrFallback(entry.currency_code);
    updateMap(byCurrency, currency, amount);
  }
  return byCurrency;
}

function getGroupFallbackBalanceEntries(
  currentUserId: number | undefined,
  groups: SplitwiseGroup[],
) {
  if (!currentUserId) return [] as Array<{ currency_code: string; amount: string }>;

  const flattened: Array<{ currency_code?: string; amount?: string | number }> = [];
  for (const group of groups) {
    const member = (group.members || []).find((candidate) => candidate.id === currentUserId);
    if (!member?.balance) continue;
    for (const entry of member.balance) {
      flattened.push(entry);
    }
  }

  const aggregated = aggregateBalancesByCurrency(flattened);
  return Array.from(aggregated.entries()).map(([currency_code, amount]) => ({
    currency_code,
    amount: String(amount),
  }));
}

function getEffectiveBalanceEntries(currentUser: SplitwiseCurrentUser, groups: SplitwiseGroup[]) {
  const direct = getCurrentUserBalanceEntries(currentUser);
  if (direct.length > 0) return direct;
  return getGroupFallbackBalanceEntries(currentUser.id, groups);
}

function toTokenPair(connection: SplitwiseConnectionDoc | null): SplitwiseTokenPair {
  if (!connection || connection.status !== 'connected' || !connection.encryptedToken) {
    throw new Error('Splitwise account is not connected');
  }

  const token = decryptJson<StoredTokenBlob>(connection.encryptedToken);
  if (!token?.accessToken) {
    throw new Error('Splitwise token is missing.');
  }
  return token;
}

function normalizeTargetCurrency(value: string | undefined) {
  const upper = (value || '').toUpperCase();
  if (!upper) return TARGET_CURRENCY;
  return upper;
}

function convertWithRates(amount: number, fromCurrency: string, toCurrency: string, rates: Record<string, number> | null) {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;
  if (!rates) return amount;

  const fromRate = from === 'USD' ? 1 : rates[from];
  const toRate = to === 'USD' ? 1 : rates[to];
  if (!Number.isFinite(fromRate) || !fromRate || !Number.isFinite(toRate) || !toRate) {
    return amount;
  }

  const usdValue = amount / fromRate;
  return usdValue * toRate;
}

export function createSignedState(input: { uid: string; nonce: string; ttlMs?: number }) {
  const ttlMs = input.ttlMs ?? 10 * 60 * 1000;
  const payload: OAuthStatePayload = {
    uid: input.uid,
    nonce: input.nonce,
    exp: now() + ttlMs,
  };

  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = makeHmacSignature(payloadEncoded, getStateSecret());
  return `${payloadEncoded}.${signature}`;
}

export function verifySignedState(state: string): OAuthStatePayload {
  const [payloadEncoded, signature] = state.split('.');
  if (!payloadEncoded || !signature) {
    throw new Error('Invalid state format');
  }

  const expectedSignature = makeHmacSignature(payloadEncoded, getStateSecret());
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('State signature mismatch');
  }

  const decoded = JSON.parse(base64UrlDecode(payloadEncoded)) as OAuthStatePayload;
  if (!decoded.uid || !decoded.nonce || !decoded.exp) {
    throw new Error('State payload malformed');
  }
  if (decoded.exp < now()) {
    throw new Error('State expired');
  }

  return decoded;
}

export function normalizeBalancesForCurrentUser(
  balances: Array<{ amount?: string | number; currency_code?: string }> | undefined,
): { owes: CurrencyAmount[]; owed: CurrencyAmount[]; net: CurrencyAmount[] } {
  const owes = new Map<string, number>();
  const owed = new Map<string, number>();
  const net = new Map<string, number>();

  for (const item of balances || []) {
    const amount = parseAmount(item.amount);
    if (!amount) continue;
    const currency = currencyOrFallback(item.currency_code);

    if (amount < 0) {
      updateMap(owes, currency, Math.abs(amount));
    } else {
      updateMap(owed, currency, amount);
    }
    updateMap(net, currency, amount);
  }

  return {
    owes: sortedCurrencyAmounts(owes),
    owed: sortedCurrencyAmounts(owed),
    net: sortedCurrencyAmounts(net),
  };
}

export async function saveOAuthState(input: PersistedOAuthState) {
  await getFirebaseAdminFirestore()
    .collection(OAUTH_STATES_COLLECTION)
    .doc(input.uid)
    .set(withoutUndefined(input));
}

export async function consumeOAuthState(uid: string) {
  const docRef = getFirebaseAdminFirestore().collection(OAUTH_STATES_COLLECTION).doc(uid);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    throw new Error('OAuth state not found');
  }
  const data = snapshot.data() as PersistedOAuthState;
  await docRef.delete();

  if (data.expiresAt < now()) {
    throw new Error('OAuth state expired');
  }

  return data;
}

export async function getConnection(uid: string) {
  const snapshot = await getFirebaseAdminFirestore().collection(CONNECTIONS_COLLECTION).doc(uid).get();
  if (!snapshot.exists) {
    return null;
  }
  return snapshot.data() as SplitwiseConnectionDoc;
}

export async function upsertConnection(doc: SplitwiseConnectionDoc) {
  await getFirebaseAdminFirestore()
    .collection(CONNECTIONS_COLLECTION)
    .doc(doc.uid)
    .set(withoutUndefined(doc), { merge: true });
}

export async function softRevokeConnection(uid: string) {
  const timestamp = now();
  await getFirebaseAdminFirestore()
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid)
    .set(
      {
        uid,
        status: 'revoked',
        updatedAt: timestamp,
        encryptedToken: FieldValue.delete(),
      },
      { merge: true },
    );
}

function toStatusResponse(connection: SplitwiseConnectionDoc | null): SplitwiseStatusResponse {
  if (!connection) {
    return {
      connected: false,
      status: 'disconnected',
    };
  }

  return {
    connected: connection.status === 'connected',
    status: connection.status,
    profile: {
      id: connection.splitwiseUserId,
      firstName: connection.splitwiseFirstName,
      lastName: connection.splitwiseLastName,
      email: connection.splitwiseEmail,
      defaultCurrency: connection.splitwiseDefaultCurrency,
      pictureUrl: connection.splitwisePictureUrl,
    },
    lastSyncAt: connection.lastSyncAt,
    lastError: connection.lastError,
    receivableTotal: connection.receivableTotal,
    receivableCurrency: connection.receivableCurrency || TARGET_CURRENCY,
    hasReceivable: (connection.receivableTotal || 0) > 0,
  };
}

export async function getStatusForUid(uid: string) {
  const connection = await getConnection(uid);
  return toStatusResponse(connection);
}

async function syncReceivableForToken(
  token: SplitwiseTokenPair,
  targetCurrency: string,
  client: SplitwiseClient,
) {
  const [currentUser, groups] = await Promise.all([
    client.getCurrentUser(token),
    client.getGroups(token),
  ]);
  const balances = getEffectiveBalanceEntries(currentUser, groups);
  const positiveBalances = balances
    .map((entry) => ({
      currency: currencyOrFallback(entry.currency_code),
      amount: parseAmount(entry.amount),
    }))
    .filter((entry) => entry.amount > 0);

  const rates = await fetchExchangeRates('USD');
  const convertedReceivable = positiveBalances.reduce((sum, entry) => {
    return sum + convertWithRates(entry.amount, entry.currency, targetCurrency, rates);
  }, 0);

  return {
    currentUser,
    positiveBalances,
    convertedReceivable,
  };
}

export async function synchronizeSplitwiseReceivable(
  uid: string,
  options?: { targetCurrency?: string; client?: SplitwiseClient },
) {
  const connection = await getConnection(uid);
  const token = toTokenPair(connection);
  const client = options?.client || new SplitwiseClient();
  const targetCurrency = normalizeTargetCurrency(options?.targetCurrency || connection?.receivableCurrency || TARGET_CURRENCY);

  const synced = await syncReceivableForToken(token, targetCurrency, client);
  const timestamp = now();

  await upsertConnection({
    uid,
    email: connection?.email,
    splitwiseUserId: synced.currentUser.id,
    splitwiseEmail: synced.currentUser.email,
    splitwiseFirstName: synced.currentUser.first_name,
    splitwiseLastName: synced.currentUser.last_name,
    splitwiseDefaultCurrency: synced.currentUser.default_currency,
    splitwisePictureUrl:
      synced.currentUser.picture?.custom ||
      synced.currentUser.picture?.medium ||
      synced.currentUser.picture?.small ||
      synced.currentUser.picture?.large,
    authProvider: 'oauth2',
    encryptedToken: connection?.encryptedToken,
    status: 'connected',
    connectedAt: connection?.connectedAt || timestamp,
    updatedAt: timestamp,
    lastSyncAt: timestamp,
    lastError: undefined,
    receivableTotal: synced.convertedReceivable,
    receivableCurrency: targetCurrency,
    lastReceivableBreakdown: synced.positiveBalances,
  });

  return {
    value: synced.convertedReceivable,
    currency: targetCurrency,
    lastSyncedAt: timestamp,
    positiveBalances: synced.positiveBalances,
    profile: toProfile(synced.currentUser),
  };
}

export async function fetchAndBuildSummary(
  uid: string,
  params: { limit?: number; groupId?: number },
  client: SplitwiseClient = new SplitwiseClient(),
): Promise<SplitwiseSummaryResponse> {
  const connection = await getConnection(uid);
  const token = toTokenPair(connection);
  const targetCurrency = normalizeTargetCurrency(connection?.receivableCurrency || TARGET_CURRENCY);

  const safeLimit = Number.isFinite(params.limit) ? Math.min(Math.max(params.limit || 20, 1), 100) : 20;
  const safeGroupId = Number.isFinite(params.groupId) ? params.groupId : undefined;

  const [currentUser, groups, expenses, syncedReceivable] = await Promise.all([
    client.getCurrentUser(token),
    client.getGroups(token),
    client.getExpenses(token, { limit: safeLimit, offset: 0, groupId: safeGroupId }),
    syncReceivableForToken(token, targetCurrency, client),
  ]);

  const groupsById = new Map<number, SplitwiseGroup>();
  for (const group of groups) {
    if (typeof group.id === 'number') {
      groupsById.set(group.id, group);
    }
  }

  const balances = normalizeBalancesForCurrentUser(getEffectiveBalanceEntries(currentUser, groups));
  const timestamp = now();

  const summary: SplitwiseSummaryResponse = {
    connected: true,
    profile: toProfile(currentUser),
    balances,
    groups: normalizeGroups(groups, currentUser.id),
    recentExpenses: normalizeRecentExpenses(expenses, groupsById),
    lastSyncAt: timestamp,
    receivableTotal: syncedReceivable.convertedReceivable,
    receivableCurrency: targetCurrency,
    positiveBalances: syncedReceivable.positiveBalances,
  };

  await upsertConnection({
    uid,
    email: connection?.email,
    splitwiseUserId: currentUser.id,
    splitwiseEmail: currentUser.email,
    splitwiseFirstName: currentUser.first_name,
    splitwiseLastName: currentUser.last_name,
    splitwiseDefaultCurrency: currentUser.default_currency,
    splitwisePictureUrl:
      currentUser.picture?.custom || currentUser.picture?.medium || currentUser.picture?.small || currentUser.picture?.large,
    authProvider: 'oauth2',
    encryptedToken: connection?.encryptedToken,
    status: 'connected',
    connectedAt: connection?.connectedAt || now(),
    updatedAt: timestamp,
    lastSyncAt: summary.lastSyncAt,
    lastError: undefined,
    receivableTotal: summary.receivableTotal,
    receivableCurrency: summary.receivableCurrency,
    lastReceivableBreakdown: summary.positiveBalances,
  });

  return summary;
}

export async function markConnectionError(uid: string, message: string) {
  await getFirebaseAdminFirestore()
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid)
    .set(
      {
        uid,
        status: 'error',
        updatedAt: now(),
        lastError: message,
      },
      { merge: true },
    );
}

export async function markConnectionReconnectNeeded(uid: string, message: string) {
  await getFirebaseAdminFirestore()
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid)
    .set(
      {
        uid,
        status: 'reconnect_needed',
        updatedAt: now(),
        lastError: message,
        encryptedToken: FieldValue.delete(),
      },
      { merge: true },
    );
}

export async function finalizeConnectionFromOAuth(input: {
  uid: string;
  email?: string;
  token: SplitwiseTokenPair;
  client?: SplitwiseClient;
}) {
  const client = input.client || new SplitwiseClient();
  const timestamp = now();

  const synced = await syncReceivableForToken(input.token, TARGET_CURRENCY, client);

  const nextConnection: SplitwiseConnectionDoc = {
    uid: input.uid,
    email: input.email,
    splitwiseUserId: synced.currentUser.id,
    splitwiseEmail: synced.currentUser.email,
    splitwiseFirstName: synced.currentUser.first_name,
    splitwiseLastName: synced.currentUser.last_name,
    splitwiseDefaultCurrency: synced.currentUser.default_currency,
    splitwisePictureUrl:
      synced.currentUser.picture?.custom || synced.currentUser.picture?.medium || synced.currentUser.picture?.small || synced.currentUser.picture?.large,
    authProvider: 'oauth2',
    encryptedToken: encryptJson({
      accessToken: input.token.accessToken,
      refreshToken: input.token.refreshToken,
      tokenType: input.token.tokenType,
      scope: input.token.scope,
    } satisfies StoredTokenBlob),
    status: 'connected',
    connectedAt: timestamp,
    updatedAt: timestamp,
    lastSyncAt: timestamp,
    lastError: undefined,
    receivableTotal: synced.convertedReceivable,
    receivableCurrency: TARGET_CURRENCY,
    lastReceivableBreakdown: synced.positiveBalances,
  };

  await upsertConnection(nextConnection);
  return nextConnection;
}
