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
import { DEFAULT_PRICE_PROVIDER_SETTINGS, PriceProviderSettings, fetchAutoMatchedPriceForAsset, fetchExchangeRates, fetchGoldSystemQuote, isMassiveCandidateTicker } from '../lib/api';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { applyPriceFormula } from '../lib/priceFormula';
import {
  buildPortfolioName,
  createDefaultPortfolio,
  getActivePortfolioStorageKey,
  getPersonalPortfolioId,
  isLegacySelfPortfolioCandidate,
  normalizePortfolio,
  removeLegacySelfPortfolioDuplicates,
  shouldHydratePersonalPortfolioFromLegacy,
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
  baseCurrency: 'CAD' | 'INR' | 'USD' | 'ORIGINAL';
  setBaseCurrency: (currency: 'CAD' | 'INR' | 'USD' | 'ORIGINAL') => Promise<void>;
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
    baseCurrency?: 'CAD' | 'INR' | 'USD' | 'ORIGINAL';
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
    provider: 'massive' | null;
  };
  isPortfolioLoading: boolean;
  hasAccess: boolean;
  accessError: string | null;
  importProgress: ImportProgress;
  setImportProgress: (progress: ImportProgress) => void;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

const EMPTY_PROGRESS: ImportProgress = { visible: false, current: 0, total: 0, message: '' };
const MASSIVE_REFRESH_BATCH_SIZE = 5;
const MASSIVE_REFRESH_WINDOW_MS = 60 * 1000;
const EMPTY_PORTFOLIO: PortfolioDocument = {
  assets: [],
  assetClasses: [],
  baseCurrency: 'ORIGINAL',
  members: [],
  memberEmails: [],
  name: '',
  ownerEmail: '',
  ownerUid: '',
  isPersonal: false,
  priceProviderSettings: DEFAULT_PRICE_PROVIDER_SETTINGS,
};

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState<PortfolioDocument>(EMPTY_PORTFOLIO);
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [activePortfolioId, setActivePortfolioIdState] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [userProviderOverrides, setUserProviderOverrides] = useState<UserProviderOverrides>(DEFAULT_USER_PROVIDER_OVERRIDES);
  const [userBrokerConnections, setUserBrokerConnections] = useState<UserBrokerConnections>(DEFAULT_BROKER_CONNECTIONS);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshQueue, setRefreshQueue] = useState<{ pending: number; nextRunAt: number | null; provider: 'massive' | null }>({
    pending: 0,
    nextRunAt: null,
    provider: null,
  });
  const [isPortfolioLoading, setIsPortfolioLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress>(EMPTY_PROGRESS);
  const effectivePriceProviderSettings = useMemo(
    () => mergePriceProviderSettings(portfolio.priceProviderSettings, userProviderOverrides),
    [portfolio.priceProviderSettings, userProviderOverrides],
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
  const queueTimeoutRef = React.useRef<number | null>(null);

  useEffect(() => {
    portfolioRef.current = portfolio;
  }, [portfolio]);

  useEffect(() => {
    ratesRef.current = rates;
  }, [rates]);

  useEffect(() => {
    settingsRef.current = effectivePriceProviderSettings;
  }, [effectivePriceProviderSettings]);

  useEffect(() => {
    return () => {
      if (queueTimeoutRef.current != null) {
        window.clearTimeout(queueTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!user?.email) {
      setPortfolio(EMPTY_PORTFOLIO);
      setPortfolios([]);
      setActivePortfolioIdState(null);
      setUserProviderOverrides(DEFAULT_USER_PROVIDER_OVERRIDES);
      setUserBrokerConnections(DEFAULT_BROKER_CONNECTIONS);
      setHasAccess(false);
      setAccessError(null);
      setIsPortfolioLoading(false);
      return;
    }

    setIsPortfolioLoading(true);
    const personalPortfolioId = getPersonalPortfolioId(user.uid);
    const personalPortfolioRef = doc(db, 'portfolios', personalPortfolioId);
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
          currentActivePortfolioId: activePortfolioId,
          persistedPortfolioId,
          availablePortfolios: visiblePortfolios,
          personalPortfolioId,
        });
        const activePortfolio = visiblePortfolios.find((candidate) => candidate.id === nextActivePortfolioId) || visiblePortfolios[0];

        setPortfolios(visiblePortfolios.map(({ document: _document, ...summary }) => summary));
        setActivePortfolioIdState(activePortfolio.id);
        setPortfolio(activePortfolio.document);
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
  }, [activePortfolioId, user?.email, user?.uid]);

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
    setActivePortfolioIdState(id);
  };

  const mutatePortfolio = async (updater: (current: PortfolioDocument) => PortfolioDocument) => {
    if (!activePortfolioId) {
      throw new Error('No active portfolio selected.');
    }

    const portfolioRef = doc(db, 'portfolios', activePortfolioId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(portfolioRef);
      const current = snapshot.exists()
        ? normalizePortfolio(snapshot.data() as Partial<PortfolioDocument>)
        : createDefaultPortfolio(user?.email, user?.uid, activePortfolioId);
      const next = updater(current);
      transaction.set(portfolioRef, {
        ...stripUndefinedDeep({
          ...next,
          memberEmails: next.members.map((member) => member.email.toLowerCase()),
        }),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
  };

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

  const setBaseCurrency = async (currency: 'CAD' | 'INR' | 'USD' | 'ORIGINAL') => {
    await mutatePortfolio((current) => ({
      ...current,
      baseCurrency: currency,
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
    await mutatePortfolio((current) => {
      const sourceAsset = current.assets.find((asset) => asset.id === id);
      if (!sourceAsset) return current;

      const duplicatedAsset: Asset = {
        ...sourceAsset,
        id: crypto.randomUUID(),
        name: `${sourceAsset.name} Copy`,
        lastUpdated: Date.now(),
      };

      return {
        ...current,
        assets: [...current.assets, duplicatedAsset],
      };
    });
  };

  const updateAsset = async (asset: Asset) => {
    await mutatePortfolio((current) => ({
      ...current,
      assets: current.assets.map((existing) => existing.id === asset.id ? { ...asset, lastUpdated: Date.now() } : existing),
    }));
  };

  const removeAsset = async (id: string) => {
    await mutatePortfolio((current) => ({
      ...current,
      assets: current.assets.filter((asset) => asset.id !== id),
    }));
  };

  const refreshAsset = async (id: string) => {
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
    baseCurrency?: 'CAD' | 'INR' | 'USD' | 'ORIGINAL';
    priceProviderSettings?: PriceProviderSettings;
  }) => {
    await mutatePortfolio((current) => ({
      ...current,
      assets: data.assets,
      assetClasses: data.assetClasses,
      baseCurrency: data.baseCurrency ?? current.baseCurrency,
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
    try {
      if (queueTimeoutRef.current != null) {
        window.clearTimeout(queueTimeoutRef.current);
        queueTimeoutRef.current = null;
      }

      const currentRates = await loadRates() || rates;
      const queuePlan = buildMassiveRefreshQueuePlan(portfolio.assets);
      const immediateIds = new Set(queuePlan.immediateAssetIds);
      const queuedIds = new Set(queuePlan.queuedAssetIds);
      const updatedImmediateAssets = await refreshAssetPrices(
        portfolio.assets.filter((asset) => immediateIds.has(asset.id)),
        currentRates,
        effectivePriceProviderSettings,
        false,
        true,
      );
      const refreshedById = new Map(updatedImmediateAssets.map((asset) => [asset.id, asset]));
      const nextRunAt = queuePlan.queuedAssetIds.length > 0 ? Date.now() + MASSIVE_REFRESH_WINDOW_MS : null;
      const queuedMessage = nextRunAt ? buildQueuedRefreshMessage(nextRunAt) : undefined;

      const updatedAssets = portfolio.assets.map((asset) => {
        const refreshed = refreshedById.get(asset.id);
        if (refreshed) return refreshed;
        if (!queuedIds.has(asset.id)) return asset;

        return {
          ...asset,
          priceFetchStatus: asset.currentPrice != null ? 'success' : asset.priceFetchStatus || 'idle',
          priceFetchMessage: queuedMessage,
          priceProvider: asset.priceProvider || 'massive',
        };
      });

      await mutatePortfolio((current) => ({
        ...current,
        assets: updatedAssets,
      }));

      if (queuePlan.queuedAssetIds.length > 0 && nextRunAt) {
        setRefreshQueue({
          pending: queuePlan.queuedAssetIds.length,
          nextRunAt,
          provider: 'massive',
        });
        scheduleMassiveQueueProcessing(queuePlan.queuedAssetIds, nextRunAt);
      } else {
        setRefreshQueue({ pending: 0, nextRunAt: null, provider: null });
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const refreshFailedPrices = async () => {
    setIsRefreshing(true);
    try {
      const currentRates = await loadRates() || rates;
      const failedAssets = portfolio.assets.filter((asset) => asset.priceFetchStatus === 'failed');
      const refreshedFailedAssets = await refreshAssetPrices(failedAssets, currentRates, effectivePriceProviderSettings, true, true);
      const refreshedById = new Map(refreshedFailedAssets.map((asset) => [asset.id, asset]));

      await mutatePortfolio((current) => ({
        ...current,
        assets: current.assets.map((asset) => refreshedById.get(asset.id) || asset),
      }));
    } finally {
      setIsRefreshing(false);
    }
  };

  const scheduleMassiveQueueProcessing = React.useCallback((queuedIds: string[], nextRunAt: number) => {
    const delayMs = Math.max(nextRunAt - Date.now(), 0);
    queueTimeoutRef.current = window.setTimeout(async () => {
      const currentPortfolio = portfolioRef.current;
      const queuedAssets = currentPortfolio.assets.filter((asset) => queuedIds.includes(asset.id));
      const queuePlan = buildMassiveRefreshQueuePlan(queuedAssets, true);

      if (queuePlan.immediateAssetIds.length === 0) {
        setRefreshQueue({ pending: 0, nextRunAt: null, provider: null });
        queueTimeoutRef.current = null;
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
      const followingRunAt = remainingQueuedIds.length > 0 ? Date.now() + MASSIVE_REFRESH_WINDOW_MS : null;
      const queuedMessage = followingRunAt ? buildQueuedRefreshMessage(followingRunAt) : undefined;

      await mutatePortfolio((current) => ({
        ...current,
        assets: current.assets.map((asset) => {
          const refreshed = refreshedById.get(asset.id);
          if (refreshed) return refreshed;
          if (!remainingQueuedIds.includes(asset.id)) return asset;

          return {
            ...asset,
            priceFetchStatus: asset.currentPrice != null ? 'success' : asset.priceFetchStatus || 'idle',
            priceFetchMessage: queuedMessage,
            priceProvider: asset.priceProvider || 'massive',
          };
        }),
      }));

      if (remainingQueuedIds.length > 0 && followingRunAt) {
        setRefreshQueue({
          pending: remainingQueuedIds.length,
          nextRunAt: followingRunAt,
          provider: 'massive',
        });
        scheduleMassiveQueueProcessing(remainingQueuedIds, followingRunAt);
      } else {
        setRefreshQueue({ pending: 0, nextRunAt: null, provider: null });
        queueTimeoutRef.current = null;
      }
    }, delayMs);
  }, [mutatePortfolio]);

  return (
    <PortfolioContext.Provider value={{
      assets: portfolio.assets,
      assetClasses: portfolio.assetClasses,
      members: portfolio.members,
      portfolios,
      activePortfolioId,
      setActivePortfolioId,
      currentUserRole,
      baseCurrency: portfolio.baseCurrency,
      setBaseCurrency,
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
          priceFetchMessage = formulaResult?.error || result.error || undefined;
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
        priceFetchMessage = formulaResult?.error || quote.error || undefined;
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

function buildMassiveRefreshQueuePlan(sourceAssets: Asset[], forceQueueCandidates: boolean = false) {
  const immediateAssetIds: string[] = [];
  const queuedAssetIds: string[] = [];
  const queuedGroupKeys = new Set<string>();
  const activeGroupKeys = new Set<string>();

  for (const asset of sourceAssets) {
    if (!isMassiveQueuedAsset(asset, forceQueueCandidates)) {
      immediateAssetIds.push(asset.id);
      continue;
    }

    const queueKey = getMassiveQueueKey(asset);
    if (!queueKey) {
      immediateAssetIds.push(asset.id);
      continue;
    }

    if (activeGroupKeys.has(queueKey)) {
      immediateAssetIds.push(asset.id);
      continue;
    }

    if (activeGroupKeys.size < MASSIVE_REFRESH_BATCH_SIZE) {
      activeGroupKeys.add(queueKey);
      immediateAssetIds.push(asset.id);
      continue;
    }

    queuedGroupKeys.add(queueKey);
    queuedAssetIds.push(asset.id);
  }

  if (queuedGroupKeys.size > 0) {
    for (const asset of sourceAssets) {
      const queueKey = getMassiveQueueKey(asset);
      if (queueKey && queuedGroupKeys.has(queueKey) && !queuedAssetIds.includes(asset.id)) {
        queuedAssetIds.push(asset.id);
      }
    }
  }

  return {
    immediateAssetIds,
    queuedAssetIds,
  };
}

function isMassiveQueuedAsset(asset: Asset, forceQueueCandidates: boolean = false) {
  if (!asset.autoUpdate || !asset.ticker) return false;
  if (!isMassiveCandidateTicker(asset.ticker)) return false;
  if (asset.country === 'India' || asset.country === 'Canada') return false;
  if (forceQueueCandidates) return true;
  return !isSameLocalDay(asset.lastUpdated);
}

function getMassiveQueueKey(asset: Asset) {
  if (!asset.ticker) return '';
  return [
    asset.ticker.trim().toUpperCase(),
    asset.name.trim().toUpperCase(),
    asset.assetClass.trim().toUpperCase(),
    asset.country.trim().toUpperCase(),
  ].join('::');
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

function buildQueuedRefreshMessage(nextRunAt: number) {
  return `Queued for the next Massive refresh window at ${new Date(nextRunAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}. Showing the last saved price until then.`;
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
        baseCurrency: legacyPortfolio.baseCurrency ?? currentPersonal.baseCurrency,
        priceProviderSettings: legacyPortfolio.priceProviderSettings ?? currentPersonal.priceProviderSettings,
      }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}
