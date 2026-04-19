export type CurrencyAmount = {
  currency: string;
  amount: number;
};

export type SplitwiseGroupSummary = {
  id: number;
  name: string;
  updatedAt?: string;
  memberCount: number;
  balances: CurrencyAmount[];
};

export type SplitwiseExpenseSummary = {
  id: number;
  description: string;
  cost: string;
  currencyCode?: string;
  date: string;
  groupId?: number;
  groupName?: string;
  payment?: boolean;
  createdBy?: string;
};

export type SplitwiseStatusResponse = {
  connected: boolean;
  status: 'disconnected' | 'connected' | 'error' | 'revoked' | 'reconnect_needed';
  profile?: {
    id?: number;
    firstName?: string;
    lastName?: string;
    email?: string;
    defaultCurrency?: string;
    pictureUrl?: string;
  };
  lastSyncAt?: number;
  lastError?: string;
  receivableTotal?: number;
  receivableCurrency?: string;
  hasReceivable?: boolean;
};

export type SplitwiseSummaryResponse = {
  connected: boolean;
  profile: {
    id?: number;
    firstName?: string;
    lastName?: string;
    email?: string;
    defaultCurrency?: string;
    pictureUrl?: string;
  };
  balances: {
    owes: CurrencyAmount[];
    owed: CurrencyAmount[];
    net: CurrencyAmount[];
  };
  groups: SplitwiseGroupSummary[];
  recentExpenses: SplitwiseExpenseSummary[];
  lastSyncAt?: number;
  receivableTotal?: number;
  receivableCurrency?: string;
  positiveBalances?: CurrencyAmount[];
};

export type SplitwiseConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'revoked'
  | 'reconnect_needed';
