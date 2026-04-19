import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { Asset, AssetClassDef, getSetting, saveSetting } from './db';
import {
  DEFAULT_PRICE_PROVIDER_SETTINGS,
  PriceProviderSettings,
  fetchAutoMatchedPriceForAsset,
  fetchExchangeRates,
  fetchGoldSystemQuote,
  isCanadianAutoMatchTicker,
  isIndianMutualFundAsset,
  isIndianStockAsset,
  isMassiveCandidateTicker,
} from '../lib/api';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { applyPriceFormula } from '../lib/priceFormula';
import {
  buildPortfolioName,
  createDefaultPortfolio,
  derivePortfolioCurrencies,
  getActivePortfolioStorageKey,
  getPersonalPortfolioId,
  isLegacySelfPortfolioCandidate,
  normalizePortfolio,
  removeLegacySelfPortfolioDuplicates,
  shouldHydratePersonalPortfolioFromLegacy,
  type PortfolioBaseCurrency,
  type PortfolioCurrency,
  type PortfolioDocument,
  type PortfolioMember,
  type PortfolioSummary,
  selectActivePortfolioId,
} from './portfolioHelpers';
import {
  DEFAULT_BROKER_CONNECTIONS,
  DEFAULT_USER_PROVIDER_OVERRIDES,
  type UserBrokerConnections,
  type UserProviderOverrides,
  getUserBrokerConnectionsKey,
  getUserProviderOverridesKey,
  mergePriceProviderSettings,
  normalizeUserBrokerConnections,
  normalizeUserProviderOverrides,
} from './userPreferences';
import { useConnectedAccounts } from './ConnectedAccountsContext';
import { useSplitwise } from './SplitwiseContext';
import { mapSplitwiseSummaryToAssets } from './splitwiseAssetMapper';
import { disconnectSharedIntegration, getSharedIntegrations, refreshSharedIntegration, type SharedIntegrationMember } from '../lib/sharedIntegrationsApi';

export interface ImportProgress {
  visible: boolean;
  current: number;
  total: number;
  message: string;
}

interface PortfolioContextType {
  assets: Asset[];
  assetClasses: AssetClassDef[];
  members: PortfolioMember[];
  portfolios: PortfolioSummary[];
  activePortfolioId: string | null;
  setActivePortfolioId: (id: string) => void;
  currentUserRole: PortfolioMember['role'] | null;
  sharedIntegrationMembers: SharedIntegrationMember[];
  refreshSharedIntegrations: () => Promise<void>;
  disconnectMemberIntegration: (provider: 'upstox' | 'splitwise', targetUid: string) => Promise<void>;
  refreshMemberIntegration: (provider: 'upstox' | 'splitwise', targetUid: string) => Promise<void>;
  baseCurrency: PortfolioBaseCurrency;
  setBaseCurrency: (currency: PortfolioBaseCurrency) => Promise<void>;
  primaryCurrency: PortfolioCurrency;
  secondaryCurrency: PortfolioCurrency;
  setPrimaryCurrency: (currency: PortfolioCurrency) => Promise<void>;
  setSecondaryCurrency: (currency: PortfolioCurrency) => Promise<void>;
  setPortfolioCurrencies: (primary: PortfolioCurrency, secondary: PortfolioCurrency) => Promise<void>;
  rates: Record<string, number> | null;
  sharedPriceProviderSettings: PriceProviderSettings;
  priceProviderSettings: PriceProviderSettings;
  updatePriceProviderSettings: (settings: PriceProviderSettings) => Promise<void>;
  userProviderOverrides: UserProviderOverrides;
  updateUserProviderOverrides: (settings: UserProviderOverrides) => Promise<void>;
  userBrokerConnections: UserBrokerConnections;
  updateUserBrokerConnections: (settings: UserBrokerConnections) => Promise<void>;
  addAsset: (asset: Omit<Asset, 'id'>) => Promise<void>;
  duplicateAsset: (id: string) => Promise<void>;
  updateAsset: (asset: Asset) => Promise<void>;
  removeAsset: (id: string) => Promise<void>;
  refreshAsset: (id: string) => Promise<void>;
  refreshPrices: () => Promise<void>;
  refreshFailedPrices: () => Promise<void>;
  importAssets: (assets: Asset[]) => Promise<void>;
  importAssetClasses: (classes: AssetClassDef[]) => Promise<void>;
  replaceCloudPortfolio: (data: {
    assets: Asset[];
    assetClasses: AssetClassDef[];
    baseCurrency?: PortfolioBaseCurrency;
    primaryCurrency?: PortfolioCurrency;
    secondaryCurrency?: PortfolioCurrency;
    priceProviderSettings?: PriceProviderSettings;
  }) => Promise<void>;
  addAssetClass: (cls: Omit<AssetClassDef, 'id'>) => Promise<void>;
  updateAssetClass: (cls: AssetClassDef) => Promise<void>;
  removeAssetClass: (id: string) => Promise<void>;
  clearAllAssets: () => Promise<void>;
  clearAllAssetClasses: () => Promise<void>;
  inviteMember: (email: string, role?: PortfolioMember['role']) => Promise<void>;
  removeMember: (email: string) => Promise<void>;
  isRefreshing: boolean;
  refreshQueue: {
    pending: number;
    nextRunAt: number | null;
    provider: 'massive' | 'alphavantage' | null;
  };
  bulkRefreshState: BulkRefreshRunState;
  isPortfolioLoading: boolean;
  hasAccess: boolean;
  accessError: string | null;
  importProgress: ImportProgress;
  setImportProgress: (progress: ImportProgress) => void;
}

type BulkRefreshProvider = 'amfi' | 'upstox' | 'gold' | 'massive' | 'alphavantage' | 'yahoo';
type BulkRefreshQueueProvider = 'massive' | 'alphavantage';
type BulkRefreshRowStatus =
  | 'manual'
  | 'updated_live'
  | 'updated_close_today'
  | 'using_cached_close_today'
  | 'queued_next_window'
  | 'blocked_missing_credentials'
  | 'blocked_provider_limit'
  | 'using_last_saved_price'
  | 'failed_actionable'
  | 'idle';

interface BulkRefreshIssueSummary {
  key: string;
  label: string;
  count: number;
  tone: 'sky' | 'amber' | 'rose' | 'emerald' | 'slate';
}

interface BulkRefreshProviderQueue {
  provider: BulkRefreshQueueProvider;
  pendingRequests: number;
  pendingRows: number;
  nextRunAt: number | null;
}

export interface BulkRefreshRunState {
  status: 'idle' | 'running' | 'queued' | 'completed' | 'partial';
  startedAt: number | null;
  completedAt: number | null;
  counts: {
    eligibleMarketLinked: number;
    updatedNow: number;
    usingCachedClose: number;
    queued: number;
    skippedManual: number;
    blockedBySetup: number;
    needsAttention: number;
  };
  queues: BulkRefreshProviderQueue[];
  issues: BulkRefreshIssueSummary[];
  note?: string;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

const EMPTY_PROGRESS: ImportProgress = { visible: false, current: 0, total: 0, message: '' };
const MASSIVE_REFRESH_BATCH_SIZE = 5;
const MASSIVE_REFRESH_WINDOW_MS = 60 * 1000;
const ALPHAVANTAGE_REFRESH_BATCH_SIZE = 8;
const EMPTY_PORTFOLIO: PortfolioDocument = {
  assets: [],
  assetClasses: [],
  baseCurrency: 'CAD',
  primaryCurrency: 'CAD',
  secondaryCurrency: 'USD',
  currencySettingsVersion: 1,
  members: [],
  memberEmails: [],
  name: '',
  ownerEmail: '',
  ownerUid: '',
  isPersonal: false,
  priceProviderSettings: DEFAULT_PRICE_PROVIDER_SETTINGS,
};
const EMPTY_BULK_REFRESH_STATE: BulkRefreshRunState = {
  status: 'idle',
  startedAt: null,
  completedAt: null,
  counts: {
    eligibleMarketLinked: 0,
    updatedNow: 0,
    usingCachedClose: 0,
    queued: 0,
    skippedManual: 0,
    blockedBySetup: 0,
    needsAttention: 0,
  },
  queues: [],
  issues: [],
};
const PORTFOLIO_CACHE_VERSION = 1;

interface CachedPortfolioSnapshot {
  id: string;
  name: string;
  ownerEmail: string;
  isPersonal: boolean;
  document: PortfolioDocument;
}

interface PortfolioCachePayload {
  version: number;
  activePortfolioId: string | null;
  portfolios: CachedPortfolioSnapshot[];
}

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { upstox, saveUpstoxOverride, refreshUpstox } = useConnectedAccounts();
  const { status: splitwiseStatus, summary: splitwiseSummary, refresh: refreshSplitwise } = useSplitwise();
  const [portfolio, setPortfolio] = useState<PortfolioDocument>(EMPTY_PORTFOLIO);
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [activePortfolioId, setActivePortfolioIdState] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [userProviderOverrides, setUserProviderOverrides] = useState<UserProviderOverrides>(DEFAULT_USER_PROVIDER_OVERRIDES);
  const [userBrokerConnections, setUserBrokerConnections] = useState<UserBrokerConnections>(DEFAULT_BROKER_CONNECTIONS);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshQueue, setRefreshQueue] = useState<{ pending: number; nextRunAt: number | null; provider: 'massive' | 'alphavantage' | null }>({
    pending: 0,
    nextRunAt: null,
    provider: null,
  });
  const [bulkRefreshState, setBulkRefreshState] = useState<BulkRefreshRunState>(EMPTY_BULK_REFRESH_STATE);
  const [isPortfolioLoading, setIsPortfolioLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress>(EMPTY_PROGRESS);
  const [sharedIntegrationMembers, setSharedIntegrationMembers] = useState<SharedIntegrationMember[]>([]);
  const effectivePriceProviderSettings = useMemo(
    () => mergePriceProviderSettings(portfolio.priceProviderSettings, userProviderOverrides),
    [portfolio.priceProviderSettings, userProviderOverrides],
  );
  const connectedAssets = useMemo(
    () => sharedIntegrationMembers.flatMap((member) => mapConnectedHoldingsToAssets(member.upstox.holdings, member.member.label)),
    [sharedIntegrationMembers],
  );
  const splitwiseAssets = useMemo(
    () => sharedIntegrationMembers.flatMap((member) => mapSplitwiseSummaryToAssets(
      member.splitwise.status.status === 'connected' ? 'connected' : 'disconnected',
      member.splitwise.summary,
      member.member.label,
      portfolio.primaryCurrency || 'CAD',
      rates,
      member.member.uid,
    )),
    [sharedIntegrationMembers, portfolio.primaryCurrency, rates],
  );
  const mergedAssets = useMemo(
    () => [...portfolio.assets, ...connectedAssets, ...splitwiseAssets],
    [connectedAssets, portfolio.assets, splitwiseAssets],
  );
  const currentUserRole = useMemo(() => {
    if (!user?.email) return null;
    return portfolio.members.find((member) => member.email.toLowerCase() === user.email?.toLowerCase())?.role || null;
  }, [portfolio.members, user?.email]);

  useEffect(() => {
    void loadRates();
  }, []);

  const portfolioRef = React.useRef(portfolio);
  const ratesRef = React.useRef(rates);
  const settingsRef = React.useRef(DEFAULT_PRICE_PROVIDER_SETTINGS);
  const activePortfolioIdRef = React.useRef<string | null>(null);
  const userRef = React.useRef(user);
  const massiveQueueTimeoutRef = React.useRef<number | null>(null);
  const alphaVantageQueueTimeoutRef = React.useRef<number | null>(null);
  const migrationInFlightRef = React.useRef(new Set<string>());
  const memberUidBindingRef = React.useRef(new Set<string>());

  useEffect(() => {
    portfolioRef.current = portfolio;
  }, [portfolio]);

  useEffect(() => {
    activePortfolioIdRef.current = activePortfolioId;
  }, [activePortfolioId]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    ratesRef.current = rates;
  }, [rates]);

  useEffect(() => {
    settingsRef.current = effectivePriceProviderSettings;
  }, [effectivePriceProviderSettings]);

  useEffect(() => {
    setBulkRefreshState((current) => {
      if (current.status === 'running') {
        return current;
      }
      return summarizeBulkRefreshRun(portfolio.assets, {
        startedAt: current.startedAt,
        completedAt: current.completedAt,
        queues: current.queues,
        note: current.note,
      });
    });
  }, [portfolio.assets]);

  useEffect(() => {
    return () => {
      if (massiveQueueTimeoutRef.current != null) {
        window.clearTimeout(massiveQueueTimeoutRef.current);
      }
      if (alphaVantageQueueTimeoutRef.current != null) {
        window.clearTimeout(alphaVantageQueueTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!user?.email) {
      setPortfolio(EMPTY_PORTFOLIO);
      setPortfolios([]);
      setActivePortfolioIdState(null);
      activePortfolioIdRef.current = null;
      setSharedIntegrationMembers([]);
      setUserProviderOverrides(DEFAULT_USER_PROVIDER_OVERRIDES);
      setUserBrokerConnections(DEFAULT_BROKER_CONNECTIONS);
      setBulkRefreshState(EMPTY_BULK_REFRESH_STATE);
      setRefreshQueue({ pending: 0, nextRunAt: null, provider: null });
      setHasAccess(false);
      setAccessError(null);
      setIsPortfolioLoading(false);
      return;
    }

    setIsPortfolioLoading(true);
    const personalPortfolioId = getPersonalPortfolioId(user.uid);
    const personalPortfolioRef = doc(db, 'portfolios', personalPortfolioId);
    const cachedPortfolioState = readPortfolioCache(user.uid);
    if (cachedPortfolioState && cachedPortfolioState.portfolios.length > 0) {
      const persistedPortfolioId = window.localStorage.getItem(getActivePortfolioStorageKey(user.uid));
      const nextActivePortfolioId = selectActivePortfolioId({
        currentActivePortfolioId: activePortfolioIdRef.current,
        persistedPortfolioId: persistedPortfolioId || cachedPortfolioState.activePortfolioId,
        availablePortfolios: cachedPortfolioState.portfolios,
        personalPortfolioId,
      });
      const activeCachedPortfolio = cachedPortfolioState.portfolios.find((candidate) => candidate.id === nextActivePortfolioId)
        || cachedPortfolioState.portfolios[0];
      setPortfolios(cachedPortfolioState.portfolios.map(({ document: _document, ...summary }) => summary));
      setActivePortfolioIdState(activeCachedPortfolio.id);
      activePortfolioIdRef.current = activeCachedPortfolio.id;
      setPortfolio(activeCachedPortfolio.document);
      setHasAccess(true);
      setAccessError(null);
      setIsPortfolioLoading(false);
    }
    void ensurePersonalPortfolio(personalPortfolioRef, user.email, user.uid);

    const portfoliosQuery = query(
      collection(db, 'portfolios'),
      where('memberEmails', 'array-contains', user.email.toLowerCase()),
    );

    const unsubscribe = onSnapshot(
      portfoliosQuery,
      (snapshot) => {
        const availablePortfolios = snapshot.docs.map((portfolioDoc) => {
          const normalized = normalizePortfolio(portfolioDoc.data() as Partial<PortfolioDocument>);
          return {
            id: portfolioDoc.id,
            name: portfolioDoc.id === personalPortfolioId ? 'My Portfolio' : (normalized.name || buildPortfolioName(normalized, portfolioDoc.id)),
            ownerEmail: normalized.ownerEmail || normalized.members[0]?.email || '',
            isPersonal: normalized.isPersonal || portfolioDoc.id === personalPortfolioId,
            document: normalized,
          };
        });
        const personalPortfolioCandidate = availablePortfolios.find((portfolio) => portfolio.id === personalPortfolioId);
        const legacySelfPortfolioCandidate = availablePortfolios.find((portfolio) =>
          isLegacySelfPortfolioCandidate(portfolio, user.email, personalPortfolioId)
        );
        if (
          personalPortfolioCandidate &&
          legacySelfPortfolioCandidate &&
          shouldHydratePersonalPortfolioFromLegacy(
            personalPortfolioCandidate.document,
            legacySelfPortfolioCandidate.document,
          )
        ) {
          void hydratePersonalPortfolioFromLegacy(
            doc(db, 'portfolios', personalPortfolioId),
            legacySelfPortfolioCandidate.document,
          );
        }
        const visiblePortfolios = removeLegacySelfPortfolioDuplicates(availablePortfolios, user.email);

        if (visiblePortfolios.length === 0) {
          setPortfolio(EMPTY_PORTFOLIO);
          setPortfolios([]);
          setActivePortfolioIdState(null);
          setHasAccess(false);
          setAccessError('No accessible portfolios were found yet. Your personal portfolio is being created.');
          setIsPortfolioLoading(false);
          return;
        }

        const persistedPortfolioId = window.localStorage.getItem(getActivePortfolioStorageKey(user.uid));
        const nextActivePortfolioId = selectActivePortfolioId({
          currentActivePortfolioId: activePortfolioIdRef.current,
          persistedPortfolioId,
          availablePortfolios: visiblePortfolios,
          personalPortfolioId,
        });
        const activePortfolio = visiblePortfolios.find((candidate) => candidate.id === nextActivePortfolioId) || visiblePortfolios[0];

        const normalizedEmail = user.email.trim().toLowerCase();
        const matchingMember = activePortfolio.document.members.find(
          (member) => (member.email || '').trim().toLowerCase() === normalizedEmail,
        );
        if (matchingMember && !matchingMember.uid) {
          const bindingKey = `${activePortfolio.id}:${user.uid}`;
          if (!memberUidBindingRef.current.has(bindingKey)) {
            memberUidBindingRef.current.add(bindingKey);
            void bindMemberUidToPortfolio(activePortfolio.id, user.uid, normalizedEmail)
              .finally(() => {
                memberUidBindingRef.current.delete(bindingKey);
              });
          }
        }

        if (activePortfolio.document.currencySettingsVersion !== 1 && !migrationInFlightRef.current.has(activePortfolio.id)) {
          migrationInFlightRef.current.add(activePortfolio.id);
          void migratePortfolioCurrencySettings(doc(db, 'portfolios', activePortfolio.id))
            .finally(() => {
              migrationInFlightRef.current.delete(activePortfolio.id);
            });
        }

        setPortfolios(visiblePortfolios.map(({ document: _document, ...summary }) => summary));
        setActivePortfolioIdState(activePortfolio.id);
        activePortfolioIdRef.current = activePortfolio.id;
        setPortfolio(activePortfolio.document);
        writePortfolioCache(user.uid, {
          version: PORTFOLIO_CACHE_VERSION,
          activePortfolioId: activePortfolio.id,
          portfolios: visiblePortfolios,
        });
        setHasAccess(true);
        setAccessError(null);
        setIsPortfolioLoading(false);
      },
      (error) => {
        setIsPortfolioLoading(false);
        setHasAccess(false);
        setAccessError(getFirestoreErrorMessage(error));
      }
    );

    return unsubscribe;
  }, [user?.email, user?.uid]);

  const refreshSharedIntegrations = React.useCallback(async () => {
    if (!user?.uid || !activePortfolioId) {
      setSharedIntegrationMembers([]);
      return;
    }

    try {
      const payload = await getSharedIntegrations(activePortfolioId);
      setSharedIntegrationMembers(payload.members || []);
    } catch {
      setSharedIntegrationMembers([]);
    }
  }, [activePortfolioId, user?.uid]);

  useEffect(() => {
    void refreshSharedIntegrations();
  }, [
    refreshSharedIntegrations,
    upstox?.lastSyncAt,
    splitwiseStatus,
    splitwiseSummary?.lastSyncAt,
  ]);

  useEffect(() => {
    if (!user?.uid || !activePortfolioId) return;
    window.localStorage.setItem(getActivePortfolioStorageKey(user.uid), activePortfolioId);
  }, [activePortfolioId, user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setUserProviderOverrides(DEFAULT_USER_PROVIDER_OVERRIDES);
      setUserBrokerConnections(DEFAULT_BROKER_CONNECTIONS);
      return;
    }

    let cancelled = false;

    void Promise.all([
      getSetting<UserProviderOverrides>(getUserProviderOverridesKey(user.uid)),
      getSetting<UserBrokerConnections>(getUserBrokerConnectionsKey(user.uid)),
    ]).then(([storedOverrides, storedBrokerConnections]) => {
      if (cancelled) return;
      setUserProviderOverrides(normalizeUserProviderOverrides(storedOverrides));
      setUserBrokerConnections(normalizeUserBrokerConnections(storedBrokerConnections));
    }).catch(() => {
      if (cancelled) return;
      setUserProviderOverrides(DEFAULT_USER_PROVIDER_OVERRIDES);
      setUserBrokerConnections(DEFAULT_BROKER_CONNECTIONS);
    });

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const setActivePortfolioId = (id: string) => {
    activePortfolioIdRef.current = id;
    setActivePortfolioIdState(id);
  };

  const mutatePortfolio = React.useCallback(async (updater: (current: PortfolioDocument) => PortfolioDocument) => {
    const portfolioId = activePortfolioIdRef.current;
    if (!portfolioId) {
      throw new Error('No active portfolio selected.');
    }

    const current = portfolioRef.current;
    const fallback = createDefaultPortfolio(userRef.current?.email || '', userRef.current?.uid || '', portfolioId);
    const source = current.ownerEmail || current.members.length > 0 ? current : fallback;
    const nextRaw = updater(source);
    const nextCurrencies = derivePortfolioCurrencies(nextRaw);
    const next: PortfolioDocument = {
      ...nextRaw,
      primaryCurrency: nextCurrencies.primaryCurrency,
      secondaryCurrency: nextCurrencies.secondaryCurrency,
      baseCurrency: nextCurrencies.primaryCurrency,
    };
    const portfolioDoc = doc(db, 'portfolios', portfolioId);
    await setDoc(portfolioDoc, {
      ...stripUndefinedDeep({
        ...next,
        memberEmails: next.members.map((member) => member.email.toLowerCase()),
        currencySettingsVersion: 1 as const,
      }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, []);

  const loadRates = async () => {
    const fetchedRates = await fetchExchangeRates('USD');
    if (fetchedRates) {
      setRates(fetchedRates);
      return fetchedRates;
    }
    return null;
  };

  const updatePriceProviderSettings = async (settings: PriceProviderSettings) => {
    await mutatePortfolio((current) => ({
      ...current,
      priceProviderSettings: settings,
    }));
  };

  const updateUserProviderOverrides = async (settings: UserProviderOverrides) => {
    const normalized = normalizeUserProviderOverrides(settings);
    setUserProviderOverrides(normalized);
    if (!user?.uid) return;
    await saveSetting(getUserProviderOverridesKey(user.uid), normalized);
  };

  const updateUserBrokerConnections = async (settings: UserBrokerConnections) => {
    const normalized = normalizeUserBrokerConnections(settings);
    setUserBrokerConnections(normalized);
    if (!user?.uid) return;
    await saveSetting(getUserBrokerConnectionsKey(user.uid), normalized);
  };

  const disconnectMemberIntegration = React.useCallback(async (
    provider: 'upstox' | 'splitwise',
    targetUid: string,
  ) => {
    if (!activePortfolioId) {
      throw new Error('No active portfolio selected.');
    }
    await disconnectSharedIntegration({
      portfolioId: activePortfolioId,
      provider,
      targetUid,
    });
    await refreshSharedIntegrations();
    if (provider === 'upstox' && targetUid === user?.uid) {
      await refreshUpstox();
    }
    if (provider === 'splitwise' && targetUid === user?.uid) {
      await refreshSplitwise();
    }
  }, [activePortfolioId, refreshSharedIntegrations, refreshSplitwise, refreshUpstox, user?.uid]);

  const refreshMemberIntegration = React.useCallback(async (
    provider: 'upstox' | 'splitwise',
    targetUid: string,
  ) => {
    if (!activePortfolioId) {
      throw new Error('No active portfolio selected.');
    }
    await refreshSharedIntegration({
      portfolioId: activePortfolioId,
      provider,
      targetUid,
    });
    await refreshSharedIntegrations();
    if (provider === 'upstox' && targetUid === user?.uid) {
      await refreshUpstox();
    }
    if (provider === 'splitwise' && targetUid === user?.uid) {
      await refreshSplitwise();
    }
  }, [activePortfolioId, refreshSharedIntegrations, refreshSplitwise, refreshUpstox, user?.uid]);

  const setBaseCurrency = async (currency: PortfolioBaseCurrency) => {
    if (currency === 'ORIGINAL') return;
    await mutatePortfolio((current) => ({
      ...current,
      baseCurrency: currency,
      primaryCurrency: currency,
    }));
  };

  const setPrimaryCurrency = async (currency: PortfolioCurrency) => {
    if (currentUserRole !== 'owner') {
      throw new Error('Only portfolio owners can update currency preferences.');
    }
    await mutatePortfolio((current) => ({
      ...current,
      primaryCurrency: currency,
      baseCurrency: currency,
      secondaryCurrency: current.secondaryCurrency === currency
        ? (currency === 'USD' ? 'CAD' : 'USD')
        : current.secondaryCurrency,
    }));
  };

  const setSecondaryCurrency = async (currency: PortfolioCurrency) => {
    if (currentUserRole !== 'owner') {
      throw new Error('Only portfolio owners can update currency preferences.');
    }
    await mutatePortfolio((current) => ({
      ...current,
      secondaryCurrency: currency === current.primaryCurrency
        ? (currency === 'USD' ? 'CAD' : 'USD')
        : currency,
    }));
  };

  const setPortfolioCurrencies = async (primary: PortfolioCurrency, secondary: PortfolioCurrency) => {
    if (currentUserRole !== 'owner') {
      throw new Error('Only portfolio owners can update currency preferences.');
    }
    await mutatePortfolio((current) => ({
      ...current,
      primaryCurrency: primary,
      baseCurrency: primary,
      secondaryCurrency: secondary === primary
        ? (primary === 'USD' ? 'CAD' : 'USD')
        : secondary,
    }));
  };

  const addAsset = async (assetData: Omit<Asset, 'id'>) => {
    const newAsset: Asset = {
      ...assetData,
      id: crypto.randomUUID(),
      lastUpdated: Date.now(),
    };
    await mutatePortfolio((current) => ({
      ...current,
      assets: [...current.assets, newAsset],
    }));
  };

  const duplicateAsset = async (id: string) => {
    const sourceAsset = mergedAssets.find((asset) => asset.id === id);
    if (sourceAsset?.sourceManaged) {
      return;
    }

    await mutatePortfolio((current) => {
      const sourceManualAsset = current.assets.find((asset) => asset.id === id);
      if (!sourceManualAsset) return current;

      const duplicatedAsset: Asset = {
        ...sourceManualAsset,
        id: crypto.randomUUID(),
        name: `${sourceManualAsset.name} Copy`,
        lastUpdated: Date.now(),
      };

      return {
        ...current,
        assets: [...current.assets, duplicatedAsset],
      };
    });
  };

  const updateAsset = async (asset: Asset) => {
    if (asset.sourceManaged && asset.connectedProvider === 'upstox' && asset.connectedHoldingId) {
      await saveUpstoxOverride(asset.connectedHoldingId, {
        customLabel: asset.name?.trim() || undefined,
        ownerOverride: asset.owner?.trim() || undefined,
        assetClassOverride: asset.assetClass?.trim() || undefined,
        hidden: asset.hiddenFromDashboard,
        notes: asset.comments?.trim() || undefined,
      });
      return;
    }

    await mutatePortfolio((current) => ({
      ...current,
      assets: current.assets.map((existing) => existing.id === asset.id ? { ...asset, lastUpdated: Date.now() } : existing),
    }));
  };

  const removeAsset = async (id: string) => {
    const sourceAsset = mergedAssets.find((asset) => asset.id === id);
    if (sourceAsset?.sourceManaged && sourceAsset.connectedProvider === 'upstox' && sourceAsset.connectedHoldingId) {
      await saveUpstoxOverride(sourceAsset.connectedHoldingId, { hidden: true });
      return;
    }

    await mutatePortfolio((current) => ({
      ...current,
      assets: current.assets.filter((asset) => asset.id !== id),
    }));
  };

  const refreshAsset = async (id: string) => {
    const sourceAsset = mergedAssets.find((asset) => asset.id === id);
    if (sourceAsset?.sourceManaged && sourceAsset.connectedProvider === 'upstox') {
      await refreshUpstox();
      return;
    }
    if (sourceAsset?.sourceManaged && sourceAsset.connectedProvider === 'splitwise') {
      await refreshSplitwise();
      return;
    }

    setIsRefreshing(true);
    try {
      const currentRates = await loadRates() || rates;
      const assetToRefresh = portfolio.assets.find((asset) => asset.id === id);
      if (!assetToRefresh) return;

      const [refreshedAsset] = await refreshAssetPrices([assetToRefresh], currentRates, effectivePriceProviderSettings, false, true);
      await mutatePortfolio((current) => ({
        ...current,
        assets: current.assets.map((asset) => asset.id === id ? refreshedAsset : asset),
      }));
    } finally {
      setIsRefreshing(false);
    }
  };

  const applyBulkRefreshState = React.useCallback((
    nextAssets: Asset[],
    startedAt: number | null,
    queues: BulkRefreshProviderQueue[],
    note?: string,
  ) => {
    const nextState = summarizeBulkRefreshRun(nextAssets, {
      startedAt,
      completedAt: Date.now(),
      queues,
      note,
    });
    setBulkRefreshState(nextState);
    const primaryQueue = queues
      .filter((queue) => queue.pendingRows > 0 && queue.nextRunAt)
      .sort((left, right) => {
        if (!left.nextRunAt && !right.nextRunAt) return 0;
        if (!left.nextRunAt) return 1;
        if (!right.nextRunAt) return -1;
        return left.nextRunAt - right.nextRunAt;
      })[0];

    setRefreshQueue(primaryQueue
      ? {
          pending: primaryQueue.pendingRows,
          nextRunAt: primaryQueue.nextRunAt,
          provider: primaryQueue.provider,
        }
      : {
          pending: 0,
          nextRunAt: null,
          provider: null,
        });
  }, []);

  const importAssets = async (nextAssets: Asset[]) => {
    try {
      setImportProgress({ visible: true, current: 0, total: nextAssets.length, message: 'Importing holdings...' });
      await mutatePortfolio((current) => ({
        ...current,
        assets: nextAssets,
      }));
      setImportProgress({ visible: true, current: nextAssets.length, total: nextAssets.length, message: 'Import complete.' });
    } finally {
      setImportProgress(EMPTY_PROGRESS);
    }
  };

  const importAssetClasses = async (nextClasses: AssetClassDef[]) => {
    try {
      setImportProgress({ visible: true, current: 0, total: nextClasses.length, message: 'Importing asset classes...' });
      await mutatePortfolio((current) => ({
        ...current,
        assetClasses: nextClasses,
      }));
      setImportProgress({ visible: true, current: nextClasses.length, total: nextClasses.length, message: 'Import complete.' });
    } finally {
      setImportProgress(EMPTY_PROGRESS);
    }
  };

  const replaceCloudPortfolio = async (data: {
    assets: Asset[];
    assetClasses: AssetClassDef[];
    baseCurrency?: PortfolioBaseCurrency;
    primaryCurrency?: PortfolioCurrency;
    secondaryCurrency?: PortfolioCurrency;
    priceProviderSettings?: PriceProviderSettings;
  }) => {
    await mutatePortfolio((current) => ({
      ...current,
      assets: data.assets,
      assetClasses: data.assetClasses,
      baseCurrency: data.primaryCurrency ?? (data.baseCurrency !== 'ORIGINAL' ? data.baseCurrency : undefined) ?? current.primaryCurrency,
      primaryCurrency: data.primaryCurrency ?? (data.baseCurrency !== 'ORIGINAL' ? data.baseCurrency : undefined) ?? current.primaryCurrency,
      secondaryCurrency: data.secondaryCurrency ?? current.secondaryCurrency,
      priceProviderSettings: data.priceProviderSettings ?? current.priceProviderSettings,
    }));
  };

  const addAssetClass = async (cls: Omit<AssetClassDef, 'id'>) => {
    const newClass: AssetClassDef = { ...cls, id: crypto.randomUUID() };
    await mutatePortfolio((current) => ({
      ...current,
      assetClasses: [...current.assetClasses, newClass],
    }));
  };

  const updateAssetClass = async (cls: AssetClassDef) => {
    await mutatePortfolio((current) => ({
      ...current,
      assetClasses: current.assetClasses.map((existing) => existing.id === cls.id ? cls : existing),
    }));
  };

  const removeAssetClass = async (id: string) => {
    await mutatePortfolio((current) => ({
      ...current,
      assetClasses: current.assetClasses.filter((cls) => cls.id !== id),
    }));
  };

  const clearAllAssets = async () => {
    await mutatePortfolio((current) => ({
      ...current,
      assets: [],
    }));
  };

  const clearAllAssetClasses = async () => {
    await mutatePortfolio((current) => ({
      ...current,
      assetClasses: [],
    }));
  };

  const inviteMember = async (email: string, role: PortfolioMember['role'] = 'partner') => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    await mutatePortfolio((current) => {
      const existing = current.members.find((member) => member.email.toLowerCase() === normalizedEmail);
      if (existing) {
        return current;
      }

      return {
        ...current,
        members: [...current.members, { email: normalizedEmail, role }],
      };
    });
  };

  const removeMember = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    await mutatePortfolio((current) => ({
      ...current,
      members: current.members.filter((member) => member.email.toLowerCase() !== normalizedEmail),
    }));
  };

  const refreshPrices = async () => {
    setIsRefreshing(true);
    const startedAt = Date.now();
    setBulkRefreshState((current) => ({
      ...current,
      status: 'running',
      startedAt,
      completedAt: null,
      note: 'Refreshing all market-linked rows across providers.',
    }));
    try {
      clearScheduledRefreshQueues(massiveQueueTimeoutRef, alphaVantageQueueTimeoutRef);
      const currentRates = await loadRates() || rates;
      const plan = buildBulkRefreshPlan(portfolio.assets);
      const immediateIds = new Set([
        ...plan.instantAssetIds,
        ...plan.massive.immediateAssetIds,
        ...plan.alphaVantage.immediateAssetIds,
      ]);
      const queuedAssetUpdates = new Map<string, Asset>();
      const cachedAssetUpdates = new Map<string, Asset>();
      const blockedAssetUpdates = new Map<string, Asset>();

      for (const asset of portfolio.assets) {
        if (plan.cachedAssetIds.includes(asset.id)) {
          cachedAssetUpdates.set(asset.id, buildCachedCloseAsset(asset, resolveBulkRefreshProvider(asset)));
        }
        if (plan.massive.queuedAssetIds.includes(asset.id)) {
          queuedAssetUpdates.set(asset.id, buildQueuedRefreshAsset(asset, 'massive', plan.massive.nextRunAt));
        }
        if (plan.alphaVantage.queuedAssetIds.includes(asset.id)) {
          queuedAssetUpdates.set(asset.id, buildQueuedRefreshAsset(asset, 'alphavantage', plan.alphaVantage.nextRunAt));
        }
        if (plan.blockedReasons[asset.id]) {
          blockedAssetUpdates.set(asset.id, buildBlockedRefreshAsset(asset, plan.blockedReasons[asset.id]));
        }
      }

      const updatedImmediateAssets = await refreshAssetPrices(
        portfolio.assets.filter((asset) => immediateIds.has(asset.id)),
        currentRates,
        effectivePriceProviderSettings,
        false,
        true,
      );
      const refreshedById = new Map(updatedImmediateAssets.map((asset) => [asset.id, asset]));

      const updatedAssets = portfolio.assets.map((asset) => {
        const refreshed = refreshedById.get(asset.id);
        if (refreshed) return refreshed;
        const queued = queuedAssetUpdates.get(asset.id);
        if (queued) return queued;
        const cached = cachedAssetUpdates.get(asset.id);
        if (cached) return cached;
        const blocked = blockedAssetUpdates.get(asset.id);
        if (blocked) return blocked;
        return asset;
      });

      await mutatePortfolio((current) => ({
        ...current,
        assets: updatedAssets,
      }));

      const queues = buildBulkRefreshQueues(plan);
      if (plan.massive.queuedAssetIds.length > 0 && plan.massive.nextRunAt) {
        scheduleQueuedProviderProcessing('massive', plan.massive.queuedAssetIds, plan.massive.nextRunAt);
      }
      if (plan.alphaVantage.queuedAssetIds.length > 0 && plan.alphaVantage.nextRunAt) {
        scheduleQueuedProviderProcessing('alphavantage', plan.alphaVantage.queuedAssetIds, plan.alphaVantage.nextRunAt);
      }
      applyBulkRefreshState(updatedAssets, startedAt, queues, 'Refresh all covers all market-linked rows, not just the filtered table view.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const refreshFailedPrices = async () => {
    setIsRefreshing(true);
    const startedAt = Date.now();
    try {
      const currentRates = await loadRates() || rates;
      const failedAssets = portfolio.assets.filter((asset) => getBulkRefreshRowStatus(asset) === 'failed_actionable');
      const refreshedFailedAssets = await refreshAssetPrices(failedAssets, currentRates, effectivePriceProviderSettings, true, true);
      const refreshedById = new Map(refreshedFailedAssets.map((asset) => [asset.id, asset]));

      const updatedAssets = portfolio.assets.map((asset) => refreshedById.get(asset.id) || asset);
      await mutatePortfolio((current) => ({
        ...current,
        assets: updatedAssets,
      }));
      applyBulkRefreshState(updatedAssets, startedAt, bulkRefreshState.queues, 'Retried actionable price rows only.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const scheduleQueuedProviderProcessing = React.useCallback((provider: BulkRefreshQueueProvider, queuedIds: string[], nextRunAt: number) => {
    const delayMs = Math.max(nextRunAt - Date.now(), 0);
    const timeoutRef = provider === 'massive' ? massiveQueueTimeoutRef : alphaVantageQueueTimeoutRef;
    timeoutRef.current = window.setTimeout(async () => {
      const currentPortfolio = portfolioRef.current;
      const queuedAssets = currentPortfolio.assets.filter((asset) => queuedIds.includes(asset.id));
      const queuePlan = buildQueuedProviderPlan(provider, queuedAssets, true);

      if (queuePlan.immediateAssetIds.length === 0) {
        timeoutRef.current = null;
        applyBulkRefreshState(currentPortfolio.assets, bulkRefreshState.startedAt, bulkRefreshState.queues.filter((queue) => queue.provider !== provider));
        return;
      }

      const currentRates = await loadRates() || ratesRef.current;
      const refreshedBatch = await refreshAssetPrices(
        queuedAssets.filter((asset) => queuePlan.immediateAssetIds.includes(asset.id)),
        currentRates,
        settingsRef.current,
        false,
        true,
      );
      const refreshedById = new Map(refreshedBatch.map((asset) => [asset.id, asset]));
      const remainingQueuedIds = queuePlan.queuedAssetIds;
      const followingRunAt = queuePlan.nextRunAt;
      const queuedUpdates = new Map<string, Asset>(
        queuedAssets
          .filter((asset) => remainingQueuedIds.includes(asset.id))
          .map((asset) => [asset.id, buildQueuedRefreshAsset(asset, provider, followingRunAt)]),
      );

      const updatedAssets = currentPortfolio.assets.map((asset) => {
        const refreshed = refreshedById.get(asset.id);
        if (refreshed) return refreshed;
        const queued = queuedUpdates.get(asset.id);
        if (queued) return queued;
        return asset;
      });

      await mutatePortfolio((current) => ({
        ...current,
        assets: updatedAssets,
      }));

      const existingQueues = bulkRefreshState.queues.filter((queue) => queue.provider !== provider);
      const nextQueues = remainingQueuedIds.length > 0 && followingRunAt
        ? [
            ...existingQueues,
            {
              provider,
              pendingRequests: queuePlan.queuedRequestCount,
              pendingRows: remainingQueuedIds.length,
              nextRunAt: followingRunAt,
            } satisfies BulkRefreshProviderQueue,
          ]
        : existingQueues;

      if (remainingQueuedIds.length > 0 && followingRunAt) {
        scheduleQueuedProviderProcessing(provider, remainingQueuedIds, followingRunAt);
      } else {
        timeoutRef.current = null;
      }
      applyBulkRefreshState(updatedAssets, bulkRefreshState.startedAt, nextQueues);
    }, delayMs);
  }, [bulkRefreshState.queues, bulkRefreshState.startedAt, mutatePortfolio]);

  return (
    <PortfolioContext.Provider value={{
      assets: mergedAssets,
      assetClasses: portfolio.assetClasses,
      members: portfolio.members,
      portfolios,
      activePortfolioId,
      setActivePortfolioId,
      currentUserRole,
      sharedIntegrationMembers,
      refreshSharedIntegrations,
      disconnectMemberIntegration,
      refreshMemberIntegration,
      baseCurrency: portfolio.primaryCurrency || 'CAD',
      setBaseCurrency,
      primaryCurrency: portfolio.primaryCurrency || 'CAD',
      secondaryCurrency: portfolio.secondaryCurrency || 'USD',
      setPrimaryCurrency,
      setSecondaryCurrency,
      setPortfolioCurrencies,
      rates,
      sharedPriceProviderSettings: portfolio.priceProviderSettings,
      priceProviderSettings: effectivePriceProviderSettings,
      updatePriceProviderSettings,
      userProviderOverrides,
      updateUserProviderOverrides,
      userBrokerConnections,
      updateUserBrokerConnections,
      addAsset,
      duplicateAsset,
      updateAsset,
      removeAsset,
      refreshAsset,
      refreshPrices,
      refreshFailedPrices,
      importAssets,
      importAssetClasses,
      replaceCloudPortfolio,
      addAssetClass,
      updateAssetClass,
      removeAssetClass,
      clearAllAssets,
      clearAllAssetClasses,
      inviteMember,
      removeMember,
      isRefreshing,
      refreshQueue,
      bulkRefreshState,
      isPortfolioLoading,
      hasAccess,
      accessError,
      importProgress,
      setImportProgress,
    }}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (!context) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return context;
}

async function bindMemberUidToPortfolio(portfolioId: string, uid: string, email: string) {
  const portfolioRef = doc(db, 'portfolios', portfolioId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(portfolioRef);
    if (!snapshot.exists()) return;
    const current = normalizePortfolio(snapshot.data() as Partial<PortfolioDocument>);
    const normalizedEmail = email.trim().toLowerCase();
    const members = Array.isArray(current.members) ? current.members : [];
    const hasPendingBinding = members.some((member) => (member.email || '').trim().toLowerCase() === normalizedEmail && !member.uid);
    if (!hasPendingBinding) return;

    const nextMembers = members.map((member) => {
      if ((member.email || '').trim().toLowerCase() !== normalizedEmail) return member;
      if (member.uid) return member;
      return { ...member, uid };
    });

    transaction.set(portfolioRef, {
      members: nextMembers,
      memberEmails: nextMembers.map((member) => member.email.toLowerCase()),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}

function mapConnectedHoldingsToAssets(
  holdings: Array<{
    id: string;
    provider: 'upstox';
    isin?: string;
    ticker?: string;
    securityName: string;
    assetType: 'stock' | 'etf' | 'fund' | 'cash' | 'derivative' | 'other';
    quantity: number;
    averageCost?: number;
    investedValue?: number;
    price?: number;
    marketValue?: number;
    unrealizedPnl?: number;
    accountCurrency: string;
    holdingKind?: 'holding' | 'position';
    positionSide?: 'long' | 'short' | 'unknown';
    possibleDuplicateOf?: string;
    override?: {
      customLabel?: string;
      ownerOverride?: string;
      assetClassOverride?: string;
      hidden?: boolean;
      notes?: string;
    } | null;
  }>,
  ownerLabel: string,
): Asset[] {
  return holdings.map((holding) => {
    const quantity = Number.isFinite(holding.quantity) ? holding.quantity : 0;
    const reportedAverageCost = Number.isFinite(holding.averageCost) ? Number(holding.averageCost) : 0;
    const marketValue = Number.isFinite(holding.marketValue) ? Number(holding.marketValue) : quantity * (holding.price || 0);
    const investedValue = Number.isFinite(holding.investedValue)
      ? Number(holding.investedValue)
      : Number.isFinite(holding.unrealizedPnl)
        ? marketValue - Number(holding.unrealizedPnl)
        : 0;
    const averageCost = reportedAverageCost > 0
      ? reportedAverageCost
      : quantity !== 0 && investedValue > 0
        ? investedValue / quantity
        : 0;
    const currentPrice = Number.isFinite(holding.price)
      ? Number(holding.price)
      : quantity > 0
        ? marketValue / quantity
        : 0;

    const assetClass = 'Upstox Cloud';
    const currency = normalizeAssetCurrency(holding.accountCurrency);
    const hidden = Boolean(holding.override?.hidden);

    return {
      id: `connected:${holding.id}`,
      name: holding.override?.customLabel || holding.securityName || holding.ticker || holding.isin || 'Connected holding',
      ticker: holding.ticker || holding.isin,
      quantity,
      costBasis: quantity !== 0 && averageCost > 0 ? quantity * averageCost : investedValue,
      currency,
      owner: ownerLabel,
      country: 'India',
      assetClass,
      autoUpdate: false,
      currentPrice: Number.isFinite(currentPrice) ? currentPrice : 0,
      priceFetchStatus: 'success',
      priceFetchMessage: holding.holdingKind === 'position'
        ? 'Synced from Upstox short-term positions (read-only).'
        : 'Synced from Upstox holdings (read-only).',
      priceProvider: 'upstox',
      holdingPlatform: 'Upstox Cloud',
      comments: holding.override?.notes || undefined,
      sourceType: 'connected',
      sourceManaged: true,
      connectedProvider: 'upstox',
      connectedHoldingId: holding.id,
      holdingKind: holding.holdingKind || 'holding',
      positionSide: holding.positionSide,
      hiddenFromDashboard: hidden,
      possibleDuplicateOf: holding.possibleDuplicateOf,
    } satisfies Asset;
  });
}

function normalizeAssetCurrency(value?: string): 'CAD' | 'INR' | 'USD' {
  const upper = (value || '').trim().toUpperCase();
  if (upper === 'CAD') return 'CAD';
  if (upper === 'USD') return 'USD';
  return 'INR';
}

function isTemporaryPriceProviderIssue(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('temporarily') ||
    normalized.includes('rate-limit') ||
    normalized.includes('rate limit') ||
    normalized.includes('cooldown') ||
    normalized.includes('try again') ||
    normalized.includes('unavailable')
  );
}

async function refreshAssetPrices(
  sourceAssets: Asset[],
  currentRates: Record<string, number> | null,
  priceProviderSettings: PriceProviderSettings,
  onlyFailedRows: boolean,
  forceTickerRefresh: boolean = false,
) {
  const inFlightRefreshes = new Map<string, ReturnType<typeof fetchAutoMatchedPriceForAsset>>();

  return mapWithConcurrency(sourceAssets, 3, async (asset) => {
    if (!asset.autoUpdate && !(forceTickerRefresh && asset.ticker)) return asset;
    if (onlyFailedRows && asset.priceFetchStatus !== 'failed') return asset;

    let newPrice = asset.currentPrice;
    let newPreviousClose = asset.previousClose;
    let priceFetchStatus: Asset['priceFetchStatus'] = asset.priceFetchStatus || 'idle';
    let priceFetchMessage = asset.priceFetchMessage;
    let priceProvider = asset.priceProvider;

    if (asset.ticker) {
      try {
        const refreshKey = [
          asset.ticker.trim().toUpperCase(),
          asset.name.trim().toUpperCase(),
          asset.assetClass.trim().toUpperCase(),
          asset.country.trim().toUpperCase(),
          asset.preferredPriceProvider || '',
        ].join('::');
        let resultPromise = inFlightRefreshes.get(refreshKey);
        if (!resultPromise) {
          resultPromise = fetchAutoMatchedPriceForAsset(asset, priceProviderSettings);
          inFlightRefreshes.set(refreshKey, resultPromise);
        }
        const result = await resultPromise;
        if (result.price != null) {
          const unitFactor = asset.priceUnitConversionFactor && asset.priceUnitConversionFactor > 0
            ? asset.priceUnitConversionFactor
            : 1;
          const sourceCurrency = asset.priceSourceCurrency || normalizeCurrency(result.currency) || normalizeCurrency(asset.originalCurrency) || normalizeCurrency(asset.currency);
          const targetCurrency = asset.priceTargetCurrency || normalizeCurrency(asset.currency) || sourceCurrency;
          const liveFxFactor = getFxConversionFactor(sourceCurrency, targetCurrency, currentRates);
          const legacyFactor = asset.priceConversionFactor && asset.priceConversionFactor > 0 ? asset.priceConversionFactor : 1;
          const effectiveFactor = asset.priceSourceCurrency || asset.priceTargetCurrency || asset.priceUnitConversionFactor
            ? liveFxFactor / unitFactor
            : legacyFactor;
          const formulaResult = asset.priceFormula
            ? applyPriceFormula(asset.priceFormula, {
                price: result.price,
                fx: liveFxFactor,
                unit: unitFactor,
              })
            : null;
          const previousCloseFormulaResult = asset.priceFormula && result.previousClose != null
            ? applyPriceFormula(asset.priceFormula, {
                price: result.previousClose,
                fx: liveFxFactor,
                unit: unitFactor,
              })
            : null;

          newPrice = formulaResult?.value != null ? formulaResult.value : result.price * effectiveFactor;
          newPreviousClose = result.previousClose != null
            ? previousCloseFormulaResult?.value != null
              ? previousCloseFormulaResult.value
              : result.previousClose * effectiveFactor
            : asset.previousClose;
          priceFetchStatus = 'success';
          priceFetchMessage = formulaResult?.error || buildSuccessfulRefreshMessage(result.provider);
          priceProvider = result.provider;
        } else {
          const shouldKeepSavedPrice =
            newPrice != null &&
            isTemporaryPriceProviderIssue(result.error);

          priceFetchStatus = shouldKeepSavedPrice ? 'success' : 'failed';
          priceFetchMessage = shouldKeepSavedPrice
            ? `Live refresh is temporarily unavailable for ${asset.ticker}. Using the last saved price for now.`
            : result.error;
          priceProvider = result.provider;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : `Price refresh failed for ${asset.ticker}.`;
        const shouldKeepSavedPrice =
          newPrice != null &&
          isTemporaryPriceProviderIssue(message);

        priceFetchStatus = shouldKeepSavedPrice ? 'success' : 'failed';
        priceFetchMessage = shouldKeepSavedPrice
          ? `Live refresh is temporarily unavailable for ${asset.ticker}. Using the last saved price for now.`
          : message;
      }
    } else if (asset.assetClass === 'Gold') {
      const quote = await fetchGoldSystemQuote();
      if (quote.price != null) {
        const unitFactor = asset.priceUnitConversionFactor && asset.priceUnitConversionFactor > 0
          ? asset.priceUnitConversionFactor
          : 31.1035;
        const sourceCurrency = asset.priceSourceCurrency || normalizeCurrency(quote.currency) || 'USD';
        const targetCurrency = asset.priceTargetCurrency || normalizeCurrency(asset.currency) || sourceCurrency;
        const liveFxFactor = getFxConversionFactor(sourceCurrency, targetCurrency, currentRates);
        const formulaResult = asset.priceFormula
          ? applyPriceFormula(asset.priceFormula, {
              price: quote.price,
              fx: liveFxFactor,
              unit: unitFactor,
            })
          : null;

        newPrice = formulaResult?.value != null ? formulaResult.value : (quote.price / unitFactor) * liveFxFactor;
        priceFetchStatus = 'success';
        priceFetchMessage = formulaResult?.error || buildSuccessfulRefreshMessage('gold');
        priceProvider = 'gold';
      } else {
        priceFetchStatus = 'failed';
        priceFetchMessage = quote.error || 'Gold price lookup failed.';
        priceProvider = 'gold';
      }
    }

    return {
      ...asset,
      currentPrice: newPrice,
      previousClose: newPreviousClose,
      lastUpdated: Date.now(),
      priceFetchStatus,
      priceFetchMessage,
      priceProvider,
    };
  });
}

function buildBulkRefreshPlan(sourceAssets: Asset[]) {
  const instantAssetIds: string[] = [];
  const cachedAssetIds: string[] = [];
  const blockedReasons: Record<string, string> = {};
  const massiveCandidates: Asset[] = [];
  const alphaVantageCandidates: Asset[] = [];

  for (const asset of sourceAssets) {
    if (!asset.autoUpdate) continue;

    const provider = resolveBulkRefreshProvider(asset);

    if (!provider) {
      blockedReasons[asset.id] = 'Live pricing is enabled, but this row does not have a supported market-linked route yet.';
      continue;
    }

    if (!asset.ticker && provider !== 'gold') {
      blockedReasons[asset.id] = 'This row needs a valid ticker before it can refresh automatically.';
      continue;
    }

    if (provider === 'massive') {
      if (asset.currentPrice != null && isSameLocalDay(asset.lastUpdated)) {
        cachedAssetIds.push(asset.id);
      } else {
        massiveCandidates.push(asset);
      }
      continue;
    }

    if (provider === 'alphavantage') {
      if (asset.currentPrice != null && isSameLocalDay(asset.lastUpdated)) {
        cachedAssetIds.push(asset.id);
      } else {
        alphaVantageCandidates.push(asset);
      }
      continue;
    }

    instantAssetIds.push(asset.id);
  }

  return {
    instantAssetIds,
    cachedAssetIds,
    blockedReasons,
    massive: buildQueuedProviderPlan('massive', massiveCandidates),
    alphaVantage: buildQueuedProviderPlan('alphavantage', alphaVantageCandidates),
  };
}

function buildQueuedProviderPlan(
  provider: BulkRefreshQueueProvider,
  sourceAssets: Asset[],
  forceQueueCandidates: boolean = false,
) {
  const batchSize = provider === 'massive' ? MASSIVE_REFRESH_BATCH_SIZE : ALPHAVANTAGE_REFRESH_BATCH_SIZE;
  const immediateAssetIds: string[] = [];
  const queuedAssetIds: string[] = [];
  const queuedGroupKeys = new Set<string>();
  const activeGroupKeys = new Set<string>();

  for (const asset of sourceAssets) {
    if (!isQueuedProviderCandidate(provider, asset, forceQueueCandidates)) {
      immediateAssetIds.push(asset.id);
      continue;
    }

    const queueKey = getQueuedProviderKey(provider, asset);
    if (!queueKey) {
      immediateAssetIds.push(asset.id);
      continue;
    }

    if (activeGroupKeys.has(queueKey)) {
      immediateAssetIds.push(asset.id);
      continue;
    }

    if (activeGroupKeys.size < batchSize) {
      activeGroupKeys.add(queueKey);
      immediateAssetIds.push(asset.id);
      continue;
    }

    queuedGroupKeys.add(queueKey);
    queuedAssetIds.push(asset.id);
  }

  if (queuedGroupKeys.size > 0) {
    for (const asset of sourceAssets) {
      const queueKey = getQueuedProviderKey(provider, asset);
      if (queueKey && queuedGroupKeys.has(queueKey) && !queuedAssetIds.includes(asset.id)) {
        queuedAssetIds.push(asset.id);
      }
    }
  }

  const nextRunAt = queuedAssetIds.length > 0
    ? provider === 'massive'
      ? Date.now() + MASSIVE_REFRESH_WINDOW_MS
      : getNextAlphaVantageRunAt()
    : null;

  return {
    immediateAssetIds,
    queuedAssetIds,
    queuedRequestCount: queuedGroupKeys.size,
    nextRunAt,
  };
}

function isQueuedProviderCandidate(provider: BulkRefreshQueueProvider, asset: Asset, forceQueueCandidates: boolean = false) {
  if (!asset.autoUpdate || !asset.ticker) return false;

  if (provider === 'massive') {
    if (!isMassiveCandidateTicker(asset.ticker)) return false;
    if (asset.country === 'India' || asset.country === 'Canada') return false;
  }

  if (provider === 'alphavantage') {
    if (!isCanadianAutoMatchTicker(asset.ticker, asset.country)) return false;
  }

  if (forceQueueCandidates) return true;
  return true;
}

function getQueuedProviderKey(provider: BulkRefreshQueueProvider, asset: Asset) {
  const providerKey = provider === 'alphavantage'
    ? normalizeAlphaVantageQueueTicker(asset.ticker || '')
    : asset.ticker?.trim().toUpperCase() || '';
  if (!providerKey) return '';

  return [
    provider,
    providerKey,
    asset.assetClass.trim().toUpperCase(),
    asset.country.trim().toUpperCase(),
  ].join('::');
}

function normalizeAlphaVantageQueueTicker(ticker: string) {
  const trimmed = ticker.trim().toUpperCase();
  if (trimmed.startsWith('TSE:')) return `${trimmed.slice(4)}.TRT`;
  if (trimmed.startsWith('CVE:')) return `${trimmed.slice(4)}.TRV`;
  if (trimmed.endsWith('.TO')) return `${trimmed.slice(0, -3)}.TRT`;
  if (trimmed.endsWith('.V')) return `${trimmed.slice(0, -2)}.TRV`;
  return trimmed;
}

function resolveBulkRefreshProvider(asset: Asset): BulkRefreshProvider | null {
  if (asset.assetClass === 'Gold') return 'gold';

  const ticker = asset.ticker?.trim() || '';
  if (isIndianMutualFundAsset(asset.assetClass, asset.country, ticker)) return 'amfi';
  if (isIndianStockAsset(asset.assetClass, asset.country, ticker)) return 'upstox';
  if (ticker && isMassiveCandidateTicker(ticker) && asset.country !== 'India' && asset.country !== 'Canada') return 'massive';
  if (ticker && isCanadianAutoMatchTicker(ticker, asset.country)) return 'alphavantage';
  if (ticker) return 'yahoo';
  return null;
}

function buildBulkRefreshQueues(plan: ReturnType<typeof buildBulkRefreshPlan>) {
  return [
    plan.massive.queuedAssetIds.length > 0 && plan.massive.nextRunAt
      ? {
          provider: 'massive',
          pendingRequests: plan.massive.queuedRequestCount,
          pendingRows: plan.massive.queuedAssetIds.length,
          nextRunAt: plan.massive.nextRunAt,
        }
      : null,
    plan.alphaVantage.queuedAssetIds.length > 0 && plan.alphaVantage.nextRunAt
      ? {
          provider: 'alphavantage',
          pendingRequests: plan.alphaVantage.queuedRequestCount,
          pendingRows: plan.alphaVantage.queuedAssetIds.length,
          nextRunAt: plan.alphaVantage.nextRunAt,
        }
      : null,
  ].filter(Boolean) as BulkRefreshProviderQueue[];
}

function buildCachedCloseAsset(asset: Asset, provider: BulkRefreshProvider | null): Asset {
  if (!provider) return asset;
  return {
    ...asset,
    priceFetchStatus: 'success',
    priceFetchMessage: buildCachedCloseMessage(provider),
    priceProvider: provider,
  };
}

function buildQueuedRefreshAsset(asset: Asset, provider: BulkRefreshQueueProvider, nextRunAt: number | null): Asset {
  return {
    ...asset,
    priceFetchStatus: asset.currentPrice != null ? 'success' : asset.priceFetchStatus || 'idle',
    priceFetchMessage: buildQueuedRefreshMessage(provider, nextRunAt),
    priceProvider: provider,
  };
}

function buildBlockedRefreshAsset(asset: Asset, message: string): Asset {
  return {
    ...asset,
    priceFetchStatus: asset.currentPrice != null ? 'success' : 'failed',
    priceFetchMessage: message,
  };
}

function isSameLocalDay(timestamp?: number) {
  if (!timestamp) return false;
  const left = new Date(timestamp);
  const right = new Date();
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function buildQueuedRefreshMessage(provider: BulkRefreshQueueProvider, nextRunAt: number | null) {
  if (!nextRunAt) {
    return provider === 'massive'
      ? 'Queued for the next Massive refresh window. Showing the last saved price until then.'
      : 'Deferred until the next Alpha Vantage close refresh window. Showing the last saved price until then.';
  }

  const formattedTime = new Date(nextRunAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return provider === 'massive'
    ? `Queued for the next Massive refresh window at ${formattedTime}. Showing the last saved price until then.`
    : `Queued for the next Alpha Vantage daily close window at ${formattedTime}. Showing the last saved price until then.`;
}

function buildCachedCloseMessage(provider: BulkRefreshProvider) {
  switch (provider) {
    case 'massive':
      return 'Using today\'s cached U.S. close. Refresh all will fetch a new Massive close on the next eligible window.';
    case 'alphavantage':
      return 'Using today\'s cached Canada close. Refresh all will fetch a new Alpha Vantage close on the next eligible window.';
    default:
      return 'Using the most recent saved market price.';
  }
}

function buildSuccessfulRefreshMessage(provider: string) {
  switch (provider) {
    case 'massive':
      return 'Fetched today\'s U.S. close from Massive.';
    case 'alphavantage':
      return 'Fetched today\'s Canada close from Alpha Vantage.';
    case 'amfi':
      return 'Updated from the AMFI public feed.';
    case 'upstox':
      return 'Updated from the Upstox market route.';
    case 'gold':
      return 'Updated from the system gold feed.';
    case 'yahoo':
      return 'Updated from Yahoo Finance.';
    default:
      return 'Live price updated successfully.';
  }
}

function getNextAlphaVantageRunAt(reference: Date = new Date()) {
  const next = new Date(reference);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 5, 0, 0);
  return next.getTime();
}

function clearScheduledRefreshQueues(
  massiveQueueTimeoutRef: React.MutableRefObject<number | null>,
  alphaVantageQueueTimeoutRef: React.MutableRefObject<number | null>,
) {
  if (massiveQueueTimeoutRef.current != null) {
    window.clearTimeout(massiveQueueTimeoutRef.current);
    massiveQueueTimeoutRef.current = null;
  }
  if (alphaVantageQueueTimeoutRef.current != null) {
    window.clearTimeout(alphaVantageQueueTimeoutRef.current);
    alphaVantageQueueTimeoutRef.current = null;
  }
}

function summarizeBulkRefreshRun(
  assets: Asset[],
  meta: {
    startedAt: number | null;
    completedAt?: number | null;
    queues: BulkRefreshProviderQueue[];
    note?: string;
  },
): BulkRefreshRunState {
  const counts = {
    eligibleMarketLinked: 0,
    updatedNow: 0,
    usingCachedClose: 0,
    queued: 0,
    skippedManual: 0,
    blockedBySetup: 0,
    needsAttention: 0,
  };
  const issuesMap = new Map<string, BulkRefreshIssueSummary>();

  for (const asset of assets) {
    const status = getBulkRefreshRowStatus(asset);
    if (!asset.autoUpdate) {
      counts.skippedManual += 1;
      continue;
    }

    counts.eligibleMarketLinked += 1;
    if (status === 'updated_live' || status === 'updated_close_today') counts.updatedNow += 1;
    if (status === 'using_cached_close_today' || status === 'using_last_saved_price') counts.usingCachedClose += 1;
    if (status === 'queued_next_window') counts.queued += 1;
    if (status === 'blocked_missing_credentials' || status === 'blocked_provider_limit') counts.blockedBySetup += 1;
    if (status === 'failed_actionable') counts.needsAttention += 1;

    const issue = getBulkRefreshIssue(asset, status);
    if (!issue) continue;
    const existing = issuesMap.get(issue.key);
    if (existing) {
      existing.count += 1;
    } else {
      issuesMap.set(issue.key, { ...issue });
    }
  }

  const issues = Array.from(issuesMap.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, 4);
  const status = counts.needsAttention > 0
    ? 'partial'
    : meta.queues.length > 0
      ? 'queued'
      : meta.startedAt
        ? 'completed'
        : 'idle';

  return {
    status,
    startedAt: meta.startedAt,
    completedAt: meta.completedAt ?? null,
    counts,
    queues: meta.queues,
    issues,
    note: meta.note,
  };
}

function getBulkRefreshIssue(asset: Asset, status: BulkRefreshRowStatus): Omit<BulkRefreshIssueSummary, 'count'> | null {
  if (status === 'queued_next_window') {
    return asset.priceProvider === 'alphavantage'
      ? { key: 'alphavantage-queued', label: 'Rows waiting for the next Alpha Vantage close window', tone: 'sky' }
      : { key: 'massive-queued', label: 'Rows waiting for the next Massive window', tone: 'sky' };
  }

  if (status === 'blocked_missing_credentials') {
    if ((asset.priceFetchMessage || '').toLowerCase().includes('upstox')) {
      return { key: 'upstox-missing', label: 'Rows missing Upstox system access', tone: 'amber' };
    }
    if ((asset.priceFetchMessage || '').toLowerCase().includes('alpha vantage')) {
      return { key: 'alphavantage-missing', label: 'Rows missing Alpha Vantage access', tone: 'amber' };
    }
    return { key: 'config-missing', label: 'Rows blocked by missing provider setup', tone: 'amber' };
  }

  if (status === 'using_last_saved_price' && (asset.priceProvider || '').toLowerCase() === 'yahoo') {
    return { key: 'yahoo-fallback', label: 'Yahoo fallback rows using the last saved price', tone: 'slate' };
  }

  if (status === 'failed_actionable') {
    return { key: 'ticker-attention', label: 'Rows that still need ticker or provider repair', tone: 'rose' };
  }

  return null;
}

export function getBulkRefreshRowStatus(asset: Asset): BulkRefreshRowStatus {
  const message = (asset.priceFetchMessage || '').toLowerCase();

  if (!asset.autoUpdate) return 'manual';
  if (message.includes('queued for the next massive refresh window') || message.includes('queued for the next alpha vantage daily close window')) {
    return 'queued_next_window';
  }
  if (message.includes('using today\'s cached') || message.includes('using today’s cached')) {
    return 'using_cached_close_today';
  }
  if (message.includes('using the last saved price') || message.includes('using the last known server-side yahoo price')) {
    return 'using_last_saved_price';
  }
  if (message.includes('api key is missing') || message.includes('access token') || message.includes('not configured') || message.includes('needs a valid ticker')) {
    return 'blocked_missing_credentials';
  }
  if (message.includes('daily close window') || message.includes('rate-limiting') || message.includes('temporarily unavailable')) {
    return asset.currentPrice != null ? 'blocked_provider_limit' : 'failed_actionable';
  }
  if (asset.priceFetchStatus === 'failed') {
    return 'failed_actionable';
  }
  if (asset.priceFetchStatus === 'success') {
    if (asset.priceProvider === 'massive' || asset.priceProvider === 'alphavantage') return 'updated_close_today';
    return 'updated_live';
  }
  return 'idle';
}

function normalizeCurrency(currency?: string | null): Asset['currency'] | null {
  if (currency === 'USD' || currency === 'CAD' || currency === 'INR') return currency;
  return null;
}

function getFxConversionFactor(
  fromCurrency: Asset['currency'],
  toCurrency: Asset['currency'],
  rates: Record<string, number> | null,
) {
  if (fromCurrency === toCurrency) return 1;
  if (!rates) return 1;

  const fromRate = fromCurrency === 'USD' ? 1 : rates[fromCurrency];
  const toRate = toCurrency === 'USD' ? 1 : rates[toCurrency];
  if (!fromRate || !toRate) return 1;

  return toRate / fromRate;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const itemIndex = currentIndex;
      currentIndex += 1;
      results[itemIndex] = await mapper(items[itemIndex], itemIndex);
    }
  }

  const workerCount = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function getFirestoreErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: string }).code);
    if (code.includes('permission-denied')) {
      return 'Access denied by Firestore rules. The signed-in account is not allowed to read or write this portfolio yet.';
    }
    if (code.includes('failed-precondition')) {
      return 'Firestore is not fully set up yet. Create the Firestore database in Firebase Console first.';
    }
    if (code.includes('unavailable')) {
      return 'Firestore is temporarily unavailable. Please refresh and try again.';
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Failed to load the shared portfolio from Firestore.';
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, nestedValue]) => {
        if (nestedValue === undefined) return [];
        return [[key, stripUndefinedDeep(nestedValue)]];
      })
    ) as T;
  }

  return value;
}

function getPortfolioCacheKey(uid: string) {
  return `nexus_assets_cache_${uid}`;
}

function readPortfolioCache(uid: string): PortfolioCachePayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getPortfolioCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PortfolioCachePayload>;
    if (parsed.version !== PORTFOLIO_CACHE_VERSION) return null;
    if (!Array.isArray(parsed.portfolios)) return null;

    const portfolios = parsed.portfolios
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const id = typeof entry.id === 'string' ? entry.id : '';
        if (!id) return null;
        const normalized = normalizePortfolio((entry as { document?: Partial<PortfolioDocument> }).document || {});
        return {
          id,
          name: typeof entry.name === 'string' ? entry.name : '',
          ownerEmail: typeof entry.ownerEmail === 'string' ? entry.ownerEmail : '',
          isPersonal: Boolean(entry.isPersonal),
          document: normalized,
        } satisfies CachedPortfolioSnapshot;
      })
      .filter(Boolean) as CachedPortfolioSnapshot[];

    return {
      version: PORTFOLIO_CACHE_VERSION,
      activePortfolioId: typeof parsed.activePortfolioId === 'string' ? parsed.activePortfolioId : null,
      portfolios,
    };
  } catch {
    return null;
  }
}

function writePortfolioCache(uid: string, payload: PortfolioCachePayload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getPortfolioCacheKey(uid), JSON.stringify(payload));
  } catch {
    // Best-effort cache write.
  }
}

async function migratePortfolioCurrencySettings(portfolioRef: ReturnType<typeof doc>) {
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(portfolioRef);
    if (!snapshot.exists()) return;
    const current = normalizePortfolio(snapshot.data() as Partial<PortfolioDocument>);
    if (current.currencySettingsVersion === 1) return;

    const derived = derivePortfolioCurrencies(current);
    transaction.set(portfolioRef, {
      ...stripUndefinedDeep({
        primaryCurrency: derived.primaryCurrency,
        secondaryCurrency: derived.secondaryCurrency,
        baseCurrency: derived.primaryCurrency,
        currencySettingsVersion: 1 as const,
      }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}

async function ensurePersonalPortfolio(portfolioRef: ReturnType<typeof doc>, email: string, uid: string) {
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(portfolioRef);
    if (snapshot.exists()) return;
    transaction.set(portfolioRef, {
      ...createDefaultPortfolio(email, uid, portfolioRef.id),
      updatedAt: serverTimestamp(),
    });
  });
}

async function hydratePersonalPortfolioFromLegacy(
  personalPortfolioRef: ReturnType<typeof doc>,
  legacyPortfolio: PortfolioDocument,
) {
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(personalPortfolioRef);
    const currentPersonal = snapshot.exists()
      ? normalizePortfolio(snapshot.data() as Partial<PortfolioDocument>)
      : createDefaultPortfolio('', '', personalPortfolioRef.id);

    if (!shouldHydratePersonalPortfolioFromLegacy(currentPersonal, legacyPortfolio)) {
      return;
    }

    transaction.set(personalPortfolioRef, {
      ...stripUndefinedDeep({
        ...currentPersonal,
        assets: legacyPortfolio.assets,
        assetClasses: legacyPortfolio.assetClasses,
        baseCurrency: legacyPortfolio.primaryCurrency
          || (legacyPortfolio.baseCurrency !== 'ORIGINAL' ? legacyPortfolio.baseCurrency : undefined)
          || currentPersonal.primaryCurrency,
        primaryCurrency: legacyPortfolio.primaryCurrency
          || (legacyPortfolio.baseCurrency !== 'ORIGINAL' ? legacyPortfolio.baseCurrency : undefined)
          || currentPersonal.primaryCurrency,
        secondaryCurrency: legacyPortfolio.secondaryCurrency || currentPersonal.secondaryCurrency,
        currencySettingsVersion: 1 as const,
        priceProviderSettings: legacyPortfolio.priceProviderSettings ?? currentPersonal.priceProviderSettings,
      }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}
