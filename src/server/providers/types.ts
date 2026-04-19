export type ExternalProvider = 'upstox' | 'groww' | 'canada_aggregator';

export type ExternalConnectionStatus =
  | 'connected'
  | 'syncing'
  | 'error'
  | 'revoked'
  | 'disconnected';

export type ExternalAccountType = 'brokerage' | 'depository' | 'cash' | 'other';
export type ExternalAssetType = 'stock' | 'etf' | 'fund' | 'cash' | 'derivative' | 'other';

export type ExternalConnection = {
  id: string;
  uid: string;
  provider: ExternalProvider;
  status: ExternalConnectionStatus;
  displayName: string;
  externalUserId?: string;
  externalUserLabel?: string;
  tokenBlob?: Record<string, unknown>;
  scopes?: string[];
  connectedAt: number;
  updatedAt: number;
  lastSyncAt?: number;
  lastSuccessfulSyncAt?: number;
  lastError?: string;
};

export type ExternalAccount = {
  id: string;
  uid: string;
  connectionId: string;
  provider: ExternalProvider;
  remoteAccountId: string;
  accountName: string;
  accountType: ExternalAccountType;
  institutionName?: string;
  currency: 'INR' | 'CAD' | 'USD';
  marketValue?: number;
  cashValue?: number;
  availableBalance?: number;
  currentBalance?: number;
  sourceUpdatedAt?: number;
  syncedAt: number;
  isActive: boolean;
};

export type ExternalHolding = {
  id: string;
  uid: string;
  connectionId: string;
  accountId: string;
  provider: ExternalProvider;
  remoteHoldingId?: string;
  isin?: string;
  ticker?: string;
  securityName: string;
  assetType: ExternalAssetType;
  quantity: number;
  averageCost?: number;
  investedValue?: number;
  costCurrency: string;
  price?: number;
  priceCurrency: string;
  marketValue?: number;
  unrealizedPnl?: number;
  accountCurrency: string;
  sourceUpdatedAt?: number;
  syncedAt: number;
  isActive: boolean;
  sourceFingerprint: string;
  holdingKind?: 'holding' | 'position';
  positionSide?: 'long' | 'short' | 'unknown';
  possibleDuplicateOf?: string;
};

export type ExternalSyncRun = {
  id: string;
  uid: string;
  provider: ExternalProvider;
  connectionId: string;
  startedAt: number;
  finishedAt?: number;
  status: 'success' | 'partial' | 'failed';
  metrics: {
    accountsUpserted: number;
    holdingsUpserted: number;
    holdingsDeactivated: number;
  };
  errorSummary?: string;
};

export type ExternalAssetOverride = {
  holdingId: string;
  uid: string;
  customLabel?: string;
  ownerOverride?: string;
  assetClassOverride?: string;
  hidden?: boolean;
  notes?: string;
  updatedAt: number;
};

export interface ExternalProviderAdapter {
  getStatus(connection: ExternalConnection): Promise<{ healthy: boolean; detail?: string }>;
  refreshConnection(connection: ExternalConnection): Promise<void>;
  fetchAccounts(connection: ExternalConnection): Promise<ExternalAccount[]>;
  fetchHoldings(connection: ExternalConnection): Promise<ExternalHolding[]>;
}
