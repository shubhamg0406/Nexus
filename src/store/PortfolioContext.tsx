import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { Asset, AssetClassDef } from './db';
import { DEFAULT_PRICE_PROVIDER_SETTINGS, PriceProviderSettings, fetchExchangeRates, fetchPriceWithProviderOrder, getGoldPrice } from '../lib/api';
import { db, defaultPortfolioId } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { applyPriceFormula } from '../lib/priceFormula';

export interface ImportProgress {
  visible: boolean;
  current: number;
  total: number;
  message: string;
}

export interface PortfolioMember {
  email: string;
  role: 'owner' | 'partner';
}

interface PortfolioContextType {
  assets: Asset[];
  assetClasses: AssetClassDef[];
  members: PortfolioMember[];
  currentUserRole: PortfolioMember['role'] | null;
  baseCurrency: 'CAD' | 'INR' | 'USD' | 'ORIGINAL';
  setBaseCurrency: (currency: 'CAD' | 'INR' | 'USD' | 'ORIGINAL') => Promise<void>;
  rates: Record<string, number> | null;
  priceProviderSettings: PriceProviderSettings;
  updatePriceProviderSettings: (settings: PriceProviderSettings) => Promise<void>;
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
  isPortfolioLoading: boolean;
  hasAccess: boolean;
  accessError: string | null;
  importProgress: ImportProgress;
  setImportProgress: (progress: ImportProgress) => void;
}

interface PortfolioDocument {
  assets: Asset[];
  assetClasses: AssetClassDef[];
  baseCurrency: 'CAD' | 'INR' | 'USD' | 'ORIGINAL';
  members: PortfolioMember[];
  memberEmails: string[];
  priceProviderSettings: PriceProviderSettings;
  updatedAt?: unknown;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

const EMPTY_PROGRESS: ImportProgress = { visible: false, current: 0, total: 0, message: '' };

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState<PortfolioDocument>({
    assets: [],
    assetClasses: [],
    baseCurrency: 'ORIGINAL',
    members: [],
    memberEmails: [],
    priceProviderSettings: DEFAULT_PRICE_PROVIDER_SETTINGS,
  });
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPortfolioLoading, setIsPortfolioLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress>(EMPTY_PROGRESS);

  useEffect(() => {
    void loadRates();
  }, []);

  useEffect(() => {
    if (!user?.email) {
      setPortfolio({
        assets: [],
        assetClasses: [],
        baseCurrency: 'ORIGINAL',
        members: [],
        memberEmails: [],
        priceProviderSettings: DEFAULT_PRICE_PROVIDER_SETTINGS,
      });
      setHasAccess(false);
      setAccessError(null);
      setIsPortfolioLoading(false);
      return;
    }

    setIsPortfolioLoading(true);
    const portfolioRef = doc(db, 'portfolios', defaultPortfolioId);
    let didBootstrap = false;

    const unsubscribe = onSnapshot(
      portfolioRef,
      async (snapshot) => {
        if (!snapshot.exists() && !didBootstrap) {
          didBootstrap = true;
          try {
            await setDoc(portfolioRef, {
              ...createDefaultPortfolio(user.email),
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            setIsPortfolioLoading(false);
            setHasAccess(false);
            setAccessError(getFirestoreErrorMessage(error));
          }
          return;
        }

        if (!snapshot.exists()) {
          setPortfolio({
            assets: [],
            assetClasses: [],
            baseCurrency: 'ORIGINAL',
            members: [],
            memberEmails: [],
            priceProviderSettings: DEFAULT_PRICE_PROVIDER_SETTINGS,
          });
          setHasAccess(false);
          setAccessError('Portfolio document was not found.');
          setIsPortfolioLoading(false);
          return;
        }

        const data = snapshot.data() as Partial<PortfolioDocument>;
        const nextPortfolio = normalizePortfolio(data);

        const email = user.email.toLowerCase();
        const isAuthorized = nextPortfolio.members.some((member) => member.email.toLowerCase() === email);

        setPortfolio(nextPortfolio);
        setHasAccess(isAuthorized);
        setAccessError(isAuthorized ? null : 'Access denied. Your email is not a member of this portfolio.');
        setIsPortfolioLoading(false);
      },
      (error) => {
        setIsPortfolioLoading(false);
        setHasAccess(false);
        setAccessError(getFirestoreErrorMessage(error));
      }
    );

    return unsubscribe;
  }, [user?.email]);

  const currentUserRole = useMemo(() => {
    if (!user?.email) return null;
    return portfolio.members.find((member) => member.email.toLowerCase() === user.email?.toLowerCase())?.role || null;
  }, [portfolio.members, user?.email]);

  const mutatePortfolio = async (updater: (current: PortfolioDocument) => PortfolioDocument) => {
    const portfolioRef = doc(db, 'portfolios', defaultPortfolioId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(portfolioRef);
      const current = snapshot.exists()
        ? normalizePortfolio(snapshot.data() as Partial<PortfolioDocument>)
        : createDefaultPortfolio(user?.email);
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

      const [refreshedAsset] = await refreshAssetPrices([assetToRefresh], currentRates, portfolio.priceProviderSettings, false, true);
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
      const currentRates = await loadRates() || rates;
      const updatedAssets = await refreshAssetPrices(portfolio.assets, currentRates, portfolio.priceProviderSettings, false, true);
      await mutatePortfolio((current) => ({
        ...current,
        assets: updatedAssets,
      }));
    } finally {
      setIsRefreshing(false);
    }
  };

  const refreshFailedPrices = async () => {
    setIsRefreshing(true);
    try {
      const currentRates = await loadRates() || rates;
      const failedAssets = portfolio.assets.filter((asset) => asset.priceFetchStatus === 'failed');
      const refreshedFailedAssets = await refreshAssetPrices(failedAssets, currentRates, portfolio.priceProviderSettings, true, true);
      const refreshedById = new Map(refreshedFailedAssets.map((asset) => [asset.id, asset]));

      await mutatePortfolio((current) => ({
        ...current,
        assets: current.assets.map((asset) => refreshedById.get(asset.id) || asset),
      }));
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <PortfolioContext.Provider value={{
      assets: portfolio.assets,
      assetClasses: portfolio.assetClasses,
      members: portfolio.members,
      currentUserRole,
      baseCurrency: portfolio.baseCurrency,
      setBaseCurrency,
      rates,
      priceProviderSettings: portfolio.priceProviderSettings,
      updatePriceProviderSettings,
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

function createDefaultPortfolio(email?: string | null): PortfolioDocument {
  const normalizedEmail = email?.trim().toLowerCase();
  return {
    assets: [],
    assetClasses: [],
    baseCurrency: 'ORIGINAL',
    members: normalizedEmail ? [{ email: normalizedEmail, role: 'owner' }] : [],
    memberEmails: normalizedEmail ? [normalizedEmail] : [],
    priceProviderSettings: DEFAULT_PRICE_PROVIDER_SETTINGS,
  };
}

function normalizePortfolio(data: Partial<PortfolioDocument>): PortfolioDocument {
  return {
    assets: Array.isArray(data.assets) ? data.assets : [],
    assetClasses: Array.isArray(data.assetClasses) ? data.assetClasses : [],
    baseCurrency: data.baseCurrency === 'CAD' || data.baseCurrency === 'INR' || data.baseCurrency === 'USD' || data.baseCurrency === 'ORIGINAL'
      ? data.baseCurrency
      : 'ORIGINAL',
    members: Array.isArray(data.members) ? data.members : [],
    memberEmails: Array.isArray(data.memberEmails) ? data.memberEmails : Array.isArray(data.members) ? data.members.map((member) => member.email).filter(Boolean) : [],
    priceProviderSettings: {
      ...DEFAULT_PRICE_PROVIDER_SETTINGS,
      ...(data.priceProviderSettings || {}),
    },
  };
}

async function refreshAssetPrices(
  sourceAssets: Asset[],
  currentRates: Record<string, number> | null,
  priceProviderSettings: PriceProviderSettings,
  onlyFailedRows: boolean,
  forceTickerRefresh: boolean = false,
) {
  return mapWithConcurrency(sourceAssets, 3, async (asset) => {
    if (!asset.autoUpdate && !(forceTickerRefresh && asset.ticker)) return asset;
    if (onlyFailedRows && asset.priceFetchStatus !== 'failed') return asset;

    let newPrice = asset.currentPrice;
    let newPreviousClose = asset.previousClose;
    let priceFetchStatus: Asset['priceFetchStatus'] = asset.priceFetchStatus || 'idle';
    let priceFetchMessage = asset.priceFetchMessage;
    let priceProvider = asset.priceProvider;

    if (asset.ticker) {
      const providerOrder = asset.preferredPriceProvider
        ? [asset.preferredPriceProvider, priceProviderSettings.primaryProvider, priceProviderSettings.secondaryProvider]
        : [priceProviderSettings.primaryProvider, priceProviderSettings.secondaryProvider];
      const result = await fetchPriceWithProviderOrder(asset.ticker, providerOrder, priceProviderSettings);
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
        priceFetchStatus = 'failed';
        priceFetchMessage = result.error;
        priceProvider = result.provider;
      }
    } else if (asset.assetClass === 'Gold') {
      // Gold holdings without a custom ticker still fall back to the generic spot-price lookup.
      const price = await getGoldPrice(asset.currency);
      if (price) {
        newPrice = price;
        priceFetchStatus = 'success';
        priceFetchMessage = undefined;
        priceProvider = 'gold';
      } else {
        priceFetchStatus = 'failed';
        priceFetchMessage = 'Gold price lookup failed.';
        priceProvider = undefined;
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
