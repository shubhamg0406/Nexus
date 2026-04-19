// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectedAccountsProvider, useConnectedAccounts } from './ConnectedAccountsContext';

vi.mock('./AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { uid: 'uid-1' } })),
}));

vi.mock('../lib/connectedAccountsApi', () => ({
  getUpstoxConnectionStatus: vi.fn(),
  getUpstoxHoldings: vi.fn(),
  refreshUpstoxConnection: vi.fn(),
  disconnectUpstoxConnection: vi.fn(),
  startUpstoxConnectFlow: vi.fn(),
  saveConnectedHoldingOverride: vi.fn(),
}));

function Harness() {
  const { upstox, connectUpstox, refreshUpstox } = useConnectedAccounts();
  return (
    <div>
      <div data-testid="status">{upstox?.status || 'none'}</div>
      <button onClick={connectUpstox}>connect</button>
      <button onClick={() => void refreshUpstox()}>refresh</button>
    </div>
  );
}

describe('ConnectedAccountsContext', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const api = await import('../lib/connectedAccountsApi');
    vi.mocked(api.getUpstoxConnectionStatus).mockResolvedValue({
      provider: 'upstox',
      status: 'disconnected',
      displayName: 'Upstox',
      accounts: [],
      holdingsSummary: {
        totalMarketValueByCurrency: [],
        totalHoldingsCount: 0,
        totalPositionsCount: 0,
      },
    });
    vi.mocked(api.getUpstoxHoldings).mockResolvedValue([]);
    vi.mocked(api.refreshUpstoxConnection).mockResolvedValue({
      status: 'success',
      metrics: { accountsUpserted: 1, holdingsUpserted: 2, holdingsDeactivated: 0 },
    });
    vi.mocked(api.startUpstoxConnectFlow).mockResolvedValue(undefined);
  });

  it('loads disconnected state and can move to connecting state', async () => {
    const user = userEvent.setup();

    render(
      <ConnectedAccountsProvider>
        <Harness />
      </ConnectedAccountsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('disconnected');
    });

    await user.click(screen.getByText('connect'));
    expect(screen.getByTestId('status').textContent).toBe('connecting');
  });

  it('supports reconnect refresh flow', async () => {
    const user = userEvent.setup();
    const api = await import('../lib/connectedAccountsApi');
    vi.mocked(api.getUpstoxConnectionStatus)
      .mockResolvedValueOnce({
        provider: 'upstox',
        status: 'connected',
        displayName: 'Upstox',
        accounts: [],
        holdingsSummary: {
          totalMarketValueByCurrency: [],
          totalHoldingsCount: 1,
          totalPositionsCount: 0,
        },
      })
      .mockResolvedValue({
        provider: 'upstox',
        status: 'connected',
        displayName: 'Upstox',
        accounts: [],
        holdingsSummary: {
          totalMarketValueByCurrency: [],
          totalHoldingsCount: 2,
          totalPositionsCount: 0,
        },
      });

    render(
      <ConnectedAccountsProvider>
        <Harness />
      </ConnectedAccountsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('connected');
    });

    await user.click(screen.getByText('refresh'));

    await waitFor(() => {
      expect(vi.mocked(api.refreshUpstoxConnection)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.getUpstoxConnectionStatus)).toHaveBeenCalledTimes(2);
    });
  });
});
