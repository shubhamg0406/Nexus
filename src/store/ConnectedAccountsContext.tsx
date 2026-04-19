import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ConnectedHolding,
  type UpstoxConnectionSummary,
  disconnectUpstoxConnection,
  getUpstoxConnectionStatus,
  getUpstoxHoldings,
  refreshUpstoxConnection,
  saveConnectedHoldingOverride,
  startUpstoxConnectFlow,
} from '../lib/connectedAccountsApi';
import { useAuth } from './AuthContext';

export type ConnectedAccountsContextType = {
  upstox: UpstoxConnectionSummary | null;
  upstoxHoldings: ConnectedHolding[];
  loading: boolean;
  error: string | null;
  connectUpstox: () => void;
  refreshUpstox: () => Promise<void>;
  disconnectUpstox: () => Promise<void>;
  reload: () => Promise<void>;
  saveUpstoxOverride: (
    holdingId: string,
    patch: {
      customLabel?: string;
      ownerOverride?: string;
      assetClassOverride?: string;
      hidden?: boolean;
      notes?: string;
    },
  ) => Promise<void>;
};

const ConnectedAccountsContext = createContext<ConnectedAccountsContextType | undefined>(undefined);

function parseUpstoxCallbackResult() {
  const url = new URL(window.location.href);
  const result = url.searchParams.get('upstox');
  const reason = url.searchParams.get('reason');
  if (!result) return null;

  url.searchParams.delete('upstox');
  url.searchParams.delete('reason');
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);

  if (result === 'success') {
    return { status: 'connecting' as const, error: null };
  }

  return {
    status: 'error' as const,
    error: reason || 'Upstox callback failed.',
  };
}

export function ConnectedAccountsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const callbackParsedRef = useRef(false);
  const [upstox, setUpstox] = useState<UpstoxConnectionSummary | null>(null);
  const [upstoxHoldings, setUpstoxHoldings] = useState<ConnectedHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setUpstox(null);
      setUpstoxHoldings([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [status, holdings] = await Promise.all([
        getUpstoxConnectionStatus(),
        getUpstoxHoldings(),
      ]);

      setUpstox(status);
      setUpstoxHoldings(holdings);

      if (status.lastError && status.status !== 'connected') {
        setError(status.lastError);
      } else {
        setError(null);
      }
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : 'Failed to load connected accounts.');
      setUpstox((current) => current || {
        provider: 'upstox',
        status: 'error',
        displayName: 'Upstox',
        holdingsSummary: {
          totalHoldingsCount: 0,
          totalPositionsCount: 0,
          totalMarketValueByCurrency: [],
        },
        accounts: [],
      });
      setUpstoxHoldings([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!callbackParsedRef.current) {
      callbackParsedRef.current = true;
      const callbackResult = parseUpstoxCallbackResult();
      if (callbackResult) {
        setUpstox((current) => ({
          provider: 'upstox',
          status: callbackResult.status,
          displayName: current?.displayName || 'Upstox',
          connectedAt: current?.connectedAt,
          lastSyncAt: current?.lastSyncAt,
          lastError: callbackResult.error || undefined,
          accounts: current?.accounts || [],
          holdingsSummary: current?.holdingsSummary || {
            totalMarketValueByCurrency: [],
            totalHoldingsCount: 0,
            totalPositionsCount: 0,
          },
        }));
        setError(callbackResult.error);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connectUpstox = useCallback(() => {
    setError(null);
    setUpstox((current) => current
      ? { ...current, status: 'connecting' }
      : {
          provider: 'upstox',
          status: 'connecting',
          displayName: 'Upstox',
          accounts: [],
          holdingsSummary: {
            totalMarketValueByCurrency: [],
            totalHoldingsCount: 0,
            totalPositionsCount: 0,
          },
        });

    void startUpstoxConnectFlow().catch((connectError) => {
      setUpstox((current) => current
        ? { ...current, status: 'error' }
        : {
            provider: 'upstox',
            status: 'error',
            displayName: 'Upstox',
            accounts: [],
            holdingsSummary: {
              totalMarketValueByCurrency: [],
              totalHoldingsCount: 0,
              totalPositionsCount: 0,
            },
          });
      setError(connectError instanceof Error ? connectError.message : 'Failed to start Upstox connect flow.');
    });
  }, []);

  const refreshUpstox = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      await refreshUpstoxConnection();
      await reload();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Upstox refresh failed.');
      setUpstox((current) => current ? { ...current, status: 'error' } : current);
    } finally {
      setLoading(false);
    }
  }, [reload, user]);

  const disconnectUpstox = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      await disconnectUpstoxConnection();
      await reload();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Upstox disconnect failed.');
    } finally {
      setLoading(false);
    }
  }, [reload, user]);

  const saveUpstoxOverride = useCallback(async (
    holdingId: string,
    patch: {
      customLabel?: string;
      ownerOverride?: string;
      assetClassOverride?: string;
      hidden?: boolean;
      notes?: string;
    },
  ) => {
    if (!user) {
      throw new Error('You must be signed in to update connected holding metadata.');
    }

    await saveConnectedHoldingOverride(holdingId, patch);
    await reload();
  }, [reload, user]);

  const value = useMemo<ConnectedAccountsContextType>(() => ({
    upstox,
    upstoxHoldings,
    loading,
    error,
    connectUpstox,
    refreshUpstox,
    disconnectUpstox,
    reload,
    saveUpstoxOverride,
  }), [
    connectUpstox,
    disconnectUpstox,
    error,
    loading,
    refreshUpstox,
    reload,
    saveUpstoxOverride,
    upstox,
    upstoxHoldings,
  ]);

  return <ConnectedAccountsContext.Provider value={value}>{children}</ConnectedAccountsContext.Provider>;
}

export function useConnectedAccounts() {
  const context = useContext(ConnectedAccountsContext);
  if (!context) {
    throw new Error('useConnectedAccounts must be used within a ConnectedAccountsProvider.');
  }
  return context;
}
