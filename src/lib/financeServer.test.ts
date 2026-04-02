import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAutoMatchedPrice } from './financeServer';

describe('financeServer refresh policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MASSIVE_API_KEY;
    delete process.env.ALPHA_VANTAGE_API_KEY;
    delete process.env.UPSTOX_CLIENT_ID;
    delete process.env.UPSTOX_CLIENT_SECRET;
    delete process.env.UPSTOX_ACCESS_TOKEN;
  });

  it('caches U.S. close prices for the rest of the day', async () => {
    process.env.MASSIVE_API_KEY = 'massive-test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { c: 209.5 },
          { c: 212.75 },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchAutoMatchedPrice({
      ticker: 'NASDAQ:AAPL',
      assetClass: 'Stocks',
      country: 'United States',
      name: 'Apple',
    });
    const second = await fetchAutoMatchedPrice({
      ticker: 'NASDAQ:AAPL',
      assetClass: 'Stocks',
      country: 'United States',
      name: 'Apple',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.provider).toBe('massive');
    expect(second.provider).toBe('massive');
    expect(second.price).toBe(212.75);
  });

  it('caches Canada close prices for the rest of the day', async () => {
    process.env.ALPHA_VANTAGE_API_KEY = 'alpha-test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'Time Series (Daily)': {
          '2026-04-02': { '4. close': '34.40' },
          '2026-04-01': { '4. close': '34.05' },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchAutoMatchedPrice({
      ticker: 'TSE:XEQT',
      assetClass: 'Stocks',
      country: 'Canada',
      name: 'XEQT',
    });
    const second = await fetchAutoMatchedPrice({
      ticker: 'TSE:XEQT',
      assetClass: 'Stocks',
      country: 'Canada',
      name: 'XEQT',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.provider).toBe('alphavantage');
    expect(second.provider).toBe('alphavantage');
    expect(second.price).toBe(34.4);
  });

  it('does not daily-cache Upstox-backed India stock prices', async () => {
    process.env.UPSTOX_CLIENT_ID = 'upstox-client';
    process.env.UPSTOX_CLIENT_SECRET = 'upstox-secret';
    process.env.UPSTOX_ACCESS_TOKEN = 'upstox-token';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              exchange: 'NSE',
              segment: 'NSE_EQ',
              instrument_type: 'EQ',
              instrument_key: 'NSE_EQ|INE002A01018',
              trading_symbol: 'RELIANCE',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            'NSE_EQ|INE002A01018': {
              last_price: 2450.1,
              ohlc: {
                close: 2430.5,
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              exchange: 'NSE',
              segment: 'NSE_EQ',
              instrument_type: 'EQ',
              instrument_key: 'NSE_EQ|INE002A01018',
              trading_symbol: 'RELIANCE',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            'NSE_EQ|INE002A01018': {
              last_price: 2451.2,
              ohlc: {
                close: 2430.5,
              },
            },
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchAutoMatchedPrice({
      ticker: 'NSE:RELIANCE',
      assetClass: 'Stocks',
      country: 'India',
      name: 'Reliance Industries',
    });
    const second = await fetchAutoMatchedPrice({
      ticker: 'NSE:RELIANCE',
      assetClass: 'Stocks',
      country: 'India',
      name: 'Reliance Industries',
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(first.provider).toBe('upstox');
    expect(second.provider).toBe('upstox');
    expect(second.price).toBe(2451.2);
  });

  it('routes OP-style India mutual fund tickers to AMFI instead of Yahoo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      text: async () => [
        '122639;INF879O01027;-;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;86.3439;01-Apr-2026',
      ].join('\n'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAutoMatchedPrice({
      ticker: 'OP0000YWL1.BO',
      assetClass: 'Funds',
      country: 'India',
      name: 'Parag Parikh Flexi Cap Fund - Direct Plan Growth',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('portal.amfiindia.com');
    expect(result.provider).toBe('amfi');
    expect(result.price).toBe(86.3439);
  });
});
