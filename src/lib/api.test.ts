import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRICE_PROVIDER_SETTINGS,
  fetchPriceWithProviderOrder,
  fetchStockPrice,
  getTickerRecommendation,
  inferCurrencyFromTicker,
  normalizeTickerForProvider,
} from './api';

describe('api pricing helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createStorageMock() {
    const store = new Map<string, string>();
    return {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
    };
  }

  it('normalizes exchange-prefixed tickers for yahoo', () => {
    expect(normalizeTickerForProvider('NASDAQ:FTNT', 'yahoo')).toBe('FTNT');
    expect(normalizeTickerForProvider('NSE:RELIANCE', 'yahoo')).toBe('RELIANCE.NS');
    expect(normalizeTickerForProvider('TSE:XEQT', 'yahoo')).toBe('XEQT.TO');
  });

  it('infers quote currency from ticker patterns', () => {
    expect(inferCurrencyFromTicker('RELIANCE.NS')).toBe('INR');
    expect(inferCurrencyFromTicker('XEQT.TO')).toBe('CAD');
    expect(inferCurrencyFromTicker('FTNT')).toBe('USD');
    expect(inferCurrencyFromTicker('GC=F')).toBe('USD');
  });

  it('gives a useful recommendation when ticker format changes by provider', () => {
    expect(getTickerRecommendation('NSE:RELIANCE', 'yahoo')).toContain('RELIANCE.NS');
  });

  it('uses yahoo automatically when only unconfigured providers were requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        price: 123.45,
        previousClose: 120,
        currency: 'USD',
        sourceUrl: 'https://example.com',
        normalizedTicker: 'FTNT',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPriceWithProviderOrder(
      'NASDAQ:FTNT',
      ['alphavantage', 'finnhub'],
      {
        alphaVantageApiKey: '',
        finnhubApiKey: '',
        primaryProvider: 'alphavantage',
        secondaryProvider: 'finnhub',
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/finance?ticker=NASDAQ%3AFTNT');
    expect(result.provider).toBe('yahoo');
    expect(result.price).toBe(123.45);
  });

  it('returns a clean configuration error for missing Alpha Vantage key', async () => {
    const result = await fetchStockPrice('FTNT', 'alphavantage', {
      ...DEFAULT_PRICE_PROVIDER_SETTINGS,
      alphaVantageApiKey: '',
    });

    expect(result.price).toBeNull();
    expect(result.error).toContain('Missing Alpha Vantage API key');
  });

  it('surfaces yahoo response errors cleanly', async () => {
    const storageMock = createStorageMock();
    vi.stubGlobal('localStorage', storageMock);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Yahoo lookup failed (429/429) for FTNT.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchStockPrice('NASDAQ:FTNT', 'yahoo', DEFAULT_PRICE_PROVIDER_SETTINGS);

    expect(result.price).toBeNull();
    expect(result.error).toContain('429');
  });

  it('uses cached yahoo price during a 429 cooldown', async () => {
    const storageMock = createStorageMock();
    vi.stubGlobal('localStorage', storageMock);

    storageMock.setItem(
      'nexus-portfolio:price-cache:yahoo:NASDAQ:FTNT',
      JSON.stringify({
        price: 101.25,
        previousClose: 100.5,
        currency: 'USD',
        sourceUrl: 'https://finance.yahoo.com/quote/FTNT',
        normalizedTicker: 'FTNT',
        savedAt: Date.now(),
      }),
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Yahoo lookup failed (429/429) for FTNT.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchStockPrice('NASDAQ:FTNT', 'yahoo', DEFAULT_PRICE_PROVIDER_SETTINGS);

    expect(result.price).toBe(101.25);
    expect(result.error).toContain('last known Yahoo price');
  });

  it('moves yahoo behind configured providers while cooldown is active', async () => {
    const storageMock = createStorageMock();
    vi.stubGlobal('localStorage', storageMock);
    storageMock.setItem('nexus-portfolio:yahoo-cooldown-until', String(Date.now() + 60_000));

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ c: 55.2, pc: 54.9 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPriceWithProviderOrder(
      'NASDAQ:FTNT',
      ['yahoo', 'finnhub'],
      {
        ...DEFAULT_PRICE_PROVIDER_SETTINGS,
        finnhubApiKey: 'test-key',
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('finnhub.io');
    expect(result.provider).toBe('finnhub');
    expect(result.price).toBe(55.2);
  });
});
