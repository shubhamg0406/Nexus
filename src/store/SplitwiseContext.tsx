import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  connectSplitwise,
  disconnectSplitwise,
  getSplitwiseStatus,
  getSplitwiseSummary,
  syncSplitwise,
} from '../lib/splitwiseApi';
import type {
  SplitwiseConnectionStatus,
  SplitwiseSummaryResponse,
} from '../lib/splitwiseTypes';
import { useAuth } from './AuthContext';
import { normalizeSplitwiseStatus } from '../lib/splitwiseCallback';

export type SplitwiseContextType = {
  status: SplitwiseConnectionStatus;
  summary: SplitwiseSummaryResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  connect: () => void;
  disconnect: () => Promise<void>;
};

const SplitwiseContext = createContext<SplitwiseContextType | undefined>(undefined);

export function SplitwiseProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<SplitwiseConnectionStatus>('disconnected');
  const [summary, setSummary] = useState<SplitwiseSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setStatus('disconnected');
      setSummary(null);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const statusResponse = await getSplitwiseStatus();
      const nextStatus = normalizeSplitwiseStatus(statusResponse.status);
      setStatus(nextStatus);

      if (nextStatus === 'connected') {
        const staleThreshold = 6 * 60 * 60 * 1000;
        const stale = !statusResponse.lastSyncAt || (Date.now() - statusResponse.lastSyncAt) > staleThreshold;
        if (stale) {
          await syncSplitwise().catch(() => undefined);
        }
        const nextSummary = await getSplitwiseSummary();
        setSummary(nextSummary);
      } else {
        setSummary(null);
      }

      if (statusResponse.lastError && nextStatus !== 'connected') {
        setError(statusResponse.lastError);
      } else {
        setError(null);
      }
    } catch (refreshError) {
      setSummary(null);
      setStatus('error');
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh Splitwise status.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setStatus('disconnected');
      setSummary(null);
      setError(null);
      setLoading(false);
      return;
    }

    void refresh();
  }, [user, refresh]);

  const connect = useCallback(() => {
    setStatus('connecting');
    setLoading(true);
    setError(null);
    void connectSplitwise()
      .then(() => refresh())
      .catch((connectError) => {
        setStatus('error');
        setError(connectError instanceof Error ? connectError.message : 'Failed to start Splitwise connection.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [refresh]);

  const disconnect = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      await disconnectSplitwise();
      setStatus('disconnected');
      setSummary(null);
      setError(null);
    } catch (disconnectError) {
      setStatus('error');
      setError(disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect Splitwise.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const value = useMemo(
    () => ({
      status,
      summary,
      loading,
      error,
      refresh,
      connect,
      disconnect,
    }),
    [status, summary, loading, error, refresh, connect, disconnect],
  );

  return <SplitwiseContext.Provider value={value}>{children}</SplitwiseContext.Provider>;
}

export function useSplitwise() {
  const context = useContext(SplitwiseContext);
  if (!context) {
    throw new Error('useSplitwise must be used within a SplitwiseProvider');
  }
  return context;
}
