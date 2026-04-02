import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRICE_PROVIDER_SETTINGS,
  fetchAutoMatchedPriceForAsset,
  fetchPriceWithProviderOrder,
  fetchStockPrice,
  getGoldPrice,
  getEffectiveProviderOrder,
  getTickerRecommendation,
  hasConfiguredNonYahooProvider,
  inferCurrencyFromTicker,
  isCanadianAutoMatchTicker,
  isIndianMutualFundAsset,
  isIndianStockAsset,
  isMassiveCandidateTicker,
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

  function stubWindowOrigin(origin: string = 'http://localhost:6868') {
    vi.stubGlobal('window', {
      location: {
        origin,
      },
    });
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

  it('detects Indian mutual fund assets for AMFI routing', () => {
    expect(isIndianMutualFundAsset('Mutual Funds', 'India')).toBe(true);
    expect(isIndianMutualFundAsset('MF', 'India')).toBe(true);
    expect(isIndianMutualFundAsset('Hybrid Mutual', 'India')).toBe(true);
    expect(isIndianMutualFundAsset('Flexi Cap Fund', 'India')).toBe(true);
    expect(isIndianMutualFundAsset('Anything', 'India', '119551')).toBe(true);
    expect(isIndianMutualFundAsset('Anything', 'India', 'INF200K01XY7')).toBe(true);
    expect(isIndianMutualFundAsset('Anything', 'India', 'OP0000YWL1.BO')).toBe(true);
    expect(isIndianMutualFundAsset('Stocks', 'India')).toBe(false);
  });

  it('detects Indian stock assets for Upstox routing', () => {
    expect(isIndianStockAsset('Stocks', 'India', 'NSE:RELIANCE')).toBe(true);
    expect(isIndianStockAsset('Equity', 'Canada', 'NSE:RELIANCE')).toBe(true);
    expect(isIndianStockAsset('Stocks', 'India', 'BOM:500325')).toBe(true);
    expect(isIndianStockAsset('Mutual Funds', 'India', '119551')).toBe(false);
  });

  it('detects U.S.-style Yahoo tickers for Massive routing', () => {
    expect(isMassiveCandidateTicker('NASDAQ:AAPL')).toBe(true);
    expect(isMassiveCandidateTicker('AAPL')).toBe(true);
    expect(isMassiveCandidateTicker('GOOG.TO')).toBe(false);
    expect(isMassiveCandidateTicker('NSE:RELIANCE')).toBe(false);
  });

  it('detects Canadian Yahoo tickers for Alpha Vantage routing', () => {
    expect(isCanadianAutoMatchTicker('TSE:XEQT', 'Canada')).toBe(true);
    expect(isCanadianAutoMatchTicker('XEQT.TO', 'Canada')).toBe(true);
    expect(isCanadianAutoMatchTicker('CVE:ABC', 'Canada')).toBe(true);
    expect(isCanadianAutoMatchTicker('NASDAQ:AAPL', 'Canada')).toBe(false);
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

  it('moves yahoo behind configured providers even before cooldown starts', () => {
    const order = getEffectiveProviderOrder(
      ['yahoo', 'finnhub'],
      {
        ...DEFAULT_PRICE_PROVIDER_SETTINGS,
        finnhubApiKey: 'test-key',
      },
    );

    expect(order).toEqual(['finnhub', 'yahoo']);
  });

  it('detects when a non-yahoo provider is configured', () => {
    expect(hasConfiguredNonYahooProvider(DEFAULT_PRICE_PROVIDER_SETTINGS)).toBe(false);
    expect(
      hasConfiguredNonYahooProvider({
        ...DEFAULT_PRICE_PROVIDER_SETTINGS,
        alphaVantageApiKey: 'demo',
      }),
    ).toBe(true);
  });

  it('fetches gold from the non-yahoo gold api and converts to CAD', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          price: 3000,
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          rates: {
            CAD: 1.4,
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getGoldPrice('CAD');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.gold-api.com/price/XAU');
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo((3000 / 31.1034768) * 1.4, 6);
  });

  it('routes Indian mutual funds through the server auto-match endpoint', async () => {
    stubWindowOrigin();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        price: 52.31,
        provider: 'amfi',
        normalizedTicker: '119551',
        currency: 'INR',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAutoMatchedPriceForAsset(
      {
        ticker: '119551',
        name: 'SBI Bluechip Fund Direct Plan Growth',
        assetClass: 'MF',
        country: 'India',
      },
      DEFAULT_PRICE_PROVIDER_SETTINGS,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/finance');
    expect(result.provider).toBe('amfi');
    expect(result.price).toBe(52.31);
  });

  it('routes Indian stocks through the server auto-match endpoint', async () => {
    stubWindowOrigin();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        price: 2450.1,
        provider: 'upstox',
        normalizedTicker: 'NSE_EQ|INE002A01018',
        currency: 'INR',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAutoMatchedPriceForAsset(
      {
        ticker: 'NSE:RELIANCE',
        name: 'Reliance Industries',
        assetClass: 'Stocks',
        country: 'India',
      },
      DEFAULT_PRICE_PROVIDER_SETTINGS,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/finance');
    expect(result.provider).toBe('upstox');
    expect(result.price).toBe(2450.1);
  });
});
