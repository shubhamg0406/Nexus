import type { PriceProvider, PriceProviderSettings } from '../lib/api';

export interface UserProviderOverrides {
  enabled: boolean;
  alphaVantageApiKey: string;
  finnhubApiKey: string;
  primaryProviderOverride: 'app-default' | PriceProvider;
  secondaryProviderOverride: 'app-default' | PriceProvider;
}

export interface BrokerConnectionConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken: string;
  accountLabel: string;
}

export interface UserBrokerConnections {
  upstox: BrokerConnectionConfig;
  groww: BrokerConnectionConfig;
}

export const DEFAULT_USER_PROVIDER_OVERRIDES: UserProviderOverrides = {
  enabled: false,
  alphaVantageApiKey: '',
  finnhubApiKey: '',
  primaryProviderOverride: 'app-default',
  secondaryProviderOverride: 'app-default',
};

export const DEFAULT_BROKER_CONNECTIONS: UserBrokerConnections = {
  upstox: {
    enabled: false,
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    accessToken: '',
    accountLabel: '',
  },
  groww: {
    enabled: false,
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    accessToken: '',
    accountLabel: '',
  },
};

export function getUserProviderOverridesKey(uid: string) {
  return `user-provider-overrides:${uid}`;
}

export function getUserBrokerConnectionsKey(uid: string) {
  return `user-broker-connections:${uid}`;
}

export function normalizeUserProviderOverrides(data?: Partial<UserProviderOverrides> | null): UserProviderOverrides {
  return {
    ...DEFAULT_USER_PROVIDER_OVERRIDES,
    ...(data || {}),
  };
}

export function normalizeUserBrokerConnections(data?: Partial<UserBrokerConnections> | null): UserBrokerConnections {
  return {
    upstox: {
      ...DEFAULT_BROKER_CONNECTIONS.upstox,
      ...(data?.upstox || {}),
    },
    groww: {
      ...DEFAULT_BROKER_CONNECTIONS.groww,
      ...(data?.groww || {}),
    },
  };
}

export function mergePriceProviderSettings(
  sharedSettings: PriceProviderSettings,
  overrides: UserProviderOverrides,
): PriceProviderSettings {
  if (!overrides.enabled) return sharedSettings;

  return {
    alphaVantageApiKey: overrides.alphaVantageApiKey.trim() || sharedSettings.alphaVantageApiKey,
    finnhubApiKey: overrides.finnhubApiKey.trim() || sharedSettings.finnhubApiKey,
    primaryProvider: overrides.primaryProviderOverride === 'app-default'
      ? sharedSettings.primaryProvider
      : overrides.primaryProviderOverride,
    secondaryProvider: overrides.secondaryProviderOverride === 'app-default'
      ? sharedSettings.secondaryProvider
      : overrides.secondaryProviderOverride,
  };
}
