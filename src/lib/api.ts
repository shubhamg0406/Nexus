export type PriceProvider = 'yahoo' | 'alphavantage' | 'finnhub';
export type ResolvedPriceProvider = PriceProvider | 'massive' | 'amfi' | 'upstox' | 'gold';

export interface PriceProviderSettings {
  alphaVantageApiKey: string;
  finnhubApiKey: string;
  primaryProvider: PriceProvider;
  secondaryProvider: PriceProvider;
}

export interface PriceFetchResult {
  price: number | null;
  previousClose?: number | null;
  provider: ResolvedPriceProvider;
  normalizedTicker?: string;
  currency?: string;
  sourceUrl?: string;
  error?: string;
}

interface CachedPriceResult {
  price: number;
  previousClose?: number | null;
  currency?: string;
  sourceUrl?: string;
  normalizedTicker?: string;
  savedAt: number;
}

export const DEFAULT_PRICE_PROVIDER_SETTINGS: PriceProviderSettings = {
  alphaVantageApiKey: '',
  finnhubApiKey: '',
  primaryProvider: 'yahoo',
  secondaryProvider: 'alphavantage',
};

const YAHOO_COOLDOWN_MS = 5 * 60 * 1000;

export async function fetchExchangeRates(base: string = 'USD') {
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    const data = await response.json();
    return data.rates;
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
    return null;
  }
}

export async function fetchHistoricalExchangeRate(date: string, from: string, to: string) {
  try {
    const response = await fetch(`https://api.frankfurter.app/${date}?from=${from}&to=${to}`);
    const data = await response.json();
    if (data && data.rates && data.rates[to]) {
      return data.rates[to];
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch historical exchange rate:', error);
    return null;
  }
}

export async function searchMutualFunds(query: string) {
  void query;
  return [];
}

export async function getMutualFundNav(ticker: string, settings: PriceProviderSettings = DEFAULT_PRICE_PROVIDER_SETTINGS) {
  const result = await fetchStockPrice(ticker, settings.primaryProvider, settings);
  return result.price;
}

export async function getStockPrice(ticker: string, settings: PriceProviderSettings = DEFAULT_PRICE_PROVIDER_SETTINGS) {
  const result = await fetchStockPrice(ticker, settings.primaryProvider, settings);
  return result.price;
}

export async function fetchPriceWithFallback(ticker: string, settings: PriceProviderSettings = DEFAULT_PRICE_PROVIDER_SETTINGS) {
  return fetchPriceWithProviderOrder(ticker, [settings.primaryProvider, settings.secondaryProvider], settings);
}

export async function fetchAutoMatchedPriceForAsset(
  asset: {
    ticker?: string;
    name: string;
    assetClass: string;
    country: string;
    preferredPriceProvider?: PriceProvider;
  },
  settings: PriceProviderSettings = DEFAULT_PRICE_PROVIDER_SETTINGS,
) {
  const ticker = asset.ticker?.trim() || '';
  if (!ticker) {
    return {
      price: null,
      provider: asset.preferredPriceProvider || settings.primaryProvider,
      error: 'Ticker is required.',
    } satisfies PriceFetchResult;
  }

  if (shouldAutoMatchWithServer(asset)) {
    const requestUrl = new URL('/api/finance', window.location.origin);
    requestUrl.searchParams.set('ticker', ticker);
    requestUrl.searchParams.set('name', asset.name);
    requestUrl.searchParams.set('assetClass', asset.assetClass);
    requestUrl.searchParams.set('country', asset.country);

    const response = await fetch(requestUrl.toString());
    const data = await safeJson(response);
    return {
      price: typeof data?.price === 'number' ? data.price : null,
      previousClose: typeof data?.previousClose === 'number' ? data.previousClose : null,
      provider: isResolvedPriceProvider(data?.provider) ? data.provider : settings.primaryProvider,
      normalizedTicker: typeof data?.normalizedTicker === 'string' ? data.normalizedTicker : ticker,
      currency: typeof data?.currency === 'string' ? data.currency : undefined,
      sourceUrl: typeof data?.sourceUrl === 'string' ? data.sourceUrl : undefined,
      error: typeof data?.error === 'string' ? data.error : undefined,
    } satisfies PriceFetchResult;
  }

  const providerOrder = asset.preferredPriceProvider
    ? [asset.preferredPriceProvider, settings.primaryProvider, settings.secondaryProvider]
    : [settings.primaryProvider, settings.secondaryProvider];

  return fetchPriceWithProviderOrder(ticker, providerOrder, settings);
}

export async function fetchPriceWithProviderOrder(
  ticker: string,
  providers: PriceProvider[],
  settings: PriceProviderSettings = DEFAULT_PRICE_PROVIDER_SETTINGS,
) {
  const uniqueProviders = getEffectiveProviderOrder(providers, settings);
  let lastFailure: PriceFetchResult | null = null;

  for (let index = 0; index < uniqueProviders.length; index += 1) {
    const provider = uniqueProviders[index];
    const result = await fetchStockPrice(ticker, provider, settings);
    if (result.price != null) {
      return result;
    }
    lastFailure = result;
    if (index < uniqueProviders.length - 1) {
      await delay(500);
    }
  }

  return lastFailure ?? {
    price: null,
    provider: settings.primaryProvider,
    error: 'Price lookup failed.',
  };
}

export function getEffectiveProviderOrder(
  providers: PriceProvider[],
  settings: PriceProviderSettings = DEFAULT_PRICE_PROVIDER_SETTINGS,
) {
  const requestedProviders = dedupeProviders(providers.length > 0 ? providers : [settings.primaryProvider, settings.secondaryProvider, 'yahoo']);
  const configuredProviders = requestedProviders.filter((provider) => isProviderConfigured(provider, settings));
  const baseProviders = configuredProviders.length > 0 ? configuredProviders : ['yahoo'];

  return prioritizeAvailableProviders(baseProviders, settings);
}

function isProviderConfigured(provider: PriceProvider, settings: PriceProviderSettings) {
  if (provider === 'yahoo') return true;
  if (provider === 'alphavantage') return Boolean(settings.alphaVantageApiKey?.trim());
  if (provider === 'finnhub') return Boolean(settings.finnhubApiKey?.trim());
  return false;
}

function shouldAutoMatchWithServer(asset: { ticker?: string; assetClass: string; country: string }) {
  const ticker = asset.ticker?.trim() || '';
  return (
    isIndianMutualFundAsset(asset.assetClass, asset.country, ticker) ||
    isIndianStockAsset(asset.assetClass, asset.country, ticker) ||
    isMassiveCandidateTicker(ticker) ||
    isCanadianAutoMatchTicker(ticker, asset.country)
  );
}

export async function fetchStockPrice(
  ticker: string,
  provider: PriceProvider,
  settings: PriceProviderSettings = DEFAULT_PRICE_PROVIDER_SETTINGS,
): Promise<PriceFetchResult> {
  const normalizedTicker = normalizeTickerForProvider(ticker, provider);
  if (!normalizedTicker) {
    return {
      price: null,
      provider,
      error: `Ticker format not recognized for ${provider}. ${getTickerRecommendation(ticker, provider)}`,
    };
  }

  try {
    switch (provider) {
      case 'yahoo':
        return await fetchYahooPrice(ticker, normalizedTicker);
      case 'alphavantage':
        return await fetchAlphaVantagePrice(normalizedTicker, settings.alphaVantageApiKey);
      case 'finnhub':
        return await fetchFinnhubPrice(normalizedTicker, settings.finnhubApiKey);
      default:
        return {
          price: null,
          provider,
          normalizedTicker,
          error: 'Unsupported provider.',
        };
    }
  } catch (error) {
    return {
      price: null,
      provider,
      normalizedTicker,
      error: error instanceof Error ? error.message : 'Unknown provider error',
    };
  }
}

export function normalizeTickerForProvider(ticker: string, provider: PriceProvider) {
  const rawTicker = ticker.trim();
  if (!rawTicker) return '';
  if (!rawTicker.includes(':')) {
    return rawTicker;
  }

  const [exchange, rawSymbol] = rawTicker.split(':');
  const symbol = rawSymbol?.trim();
  if (!exchange || !symbol) return rawTicker;

  const upperExchange = exchange.toUpperCase();
  const mappingByProvider: Record<PriceProvider, Record<string, string>> = {
    yahoo: {
      NASDAQ: symbol,
      NYSE: symbol,
      AMEX: symbol,
      NSE: `${symbol}.NS`,
      BOM: `${symbol}.BO`,
      TSE: `${symbol}.TO`,
      CVE: `${symbol}.V`,
      LON: `${symbol}.L`,
      FRA: `${symbol}.F`,
      TYO: `${symbol}.T`,
    },
    alphavantage: {
      NASDAQ: symbol,
      NYSE: symbol,
      AMEX: symbol,
      NSE: `${symbol}.NSE`,
      BOM: `${symbol}.BSE`,
      TSE: `${symbol}.TO`,
      CVE: `${symbol}.V`,
      LON: `${symbol}.LON`,
      FRA: `${symbol}.FRA`,
      TYO: `${symbol}.TYO`,
    },
    finnhub: {
      NASDAQ: symbol,
      NYSE: symbol,
      AMEX: symbol,
      NSE: `${symbol}.NS`,
      BOM: `${symbol}.BO`,
      TSE: `${symbol}.TO`,
      CVE: `${symbol}.V`,
      LON: `${symbol}.L`,
      FRA: `${symbol}.F`,
      TYO: `${symbol}.T`,
    },
  };

  return mappingByProvider[provider][upperExchange] || symbol;
}

export function inferCurrencyFromTicker(ticker: string) {
  const upperTicker = ticker.toUpperCase();
  if (upperTicker === 'GOLD' || upperTicker.includes('XAU')) {
    return 'USD';
  }
  if (upperTicker.endsWith('.NS') || upperTicker.endsWith('.BO') || upperTicker.includes('.NSE') || upperTicker.includes('.BSE')) {
    return 'INR';
  }
  if (upperTicker.endsWith('.TO') || upperTicker.endsWith('.V')) {
    return 'CAD';
  }
  return 'USD';
}

export function isIndianMutualFundAsset(assetClass: string, country: string, ticker?: string) {
  const normalizedAssetClass = assetClass.trim().toLowerCase();
  const normalizedCountry = country.trim().toLowerCase();
  const normalizedTicker = ticker?.trim().toUpperCase() || '';

  if (normalizedCountry !== 'india') return false;

  if (
    normalizedAssetClass === 'mutual fund' ||
    normalizedAssetClass === 'mutual funds' ||
    normalizedAssetClass === 'mf' ||
    normalizedAssetClass === 'mfs' ||
    normalizedAssetClass.includes('mutual') ||
    normalizedAssetClass.includes('fund')
  ) {
    return true;
  }

  return (
    /^\d{5,}$/.test(normalizedTicker) ||
    normalizedTicker.startsWith('INF') ||
    /^OP[0-9A-Z.]+$/.test(normalizedTicker)
  );
}

export function isIndianStockAsset(assetClass: string, country: string, ticker?: string) {
  const normalizedAssetClass = assetClass.trim().toLowerCase();
  const normalizedCountry = country.trim().toLowerCase();
  const normalizedTicker = ticker?.trim().toUpperCase() || '';

  return (
    (normalizedCountry === 'india' && normalizedAssetClass === 'stocks') ||
    normalizedTicker.startsWith('NSE:') ||
    normalizedTicker.startsWith('BOM:')
  );
}

export function isMassiveCandidateTicker(ticker: string) {
  const trimmed = ticker.trim().toUpperCase();
  if (!trimmed) return false;
  if (trimmed.startsWith('NASDAQ:') || trimmed.startsWith('NYSE:') || trimmed.startsWith('AMEX:')) return true;
  if (trimmed.includes(':')) return false;
  if (trimmed.includes('.')) return false;
  return /^[A-Z0-9.-]+$/.test(trimmed);
}

export function isCanadianAutoMatchTicker(ticker: string, country?: string) {
  const trimmed = ticker.trim().toUpperCase();
  return (
    trimmed.startsWith('TSE:') ||
    trimmed.startsWith('CVE:') ||
    trimmed.endsWith('.TO') ||
    trimmed.endsWith('.V')
  );
}

export function getTickerRecommendation(ticker: string, provider: PriceProvider) {
  const normalized = normalizeTickerForProvider(ticker, provider);
  if (!ticker) {
    return 'Add a ticker to enable live price fetching.';
  }
  if (normalized === ticker) {
    return `Verify the ticker exists on ${provider}.`;
  }
  return `Try ${normalized} for ${provider.toUpperCase()}.`;
}

export async function getGoldPrice(currency: 'INR' | 'CAD' | 'USD') {
  try {
    const quote = await fetchGoldSystemQuote();
    const usdPerOunce = quote.price;

    if (Number.isFinite(usdPerOunce) && usdPerOunce > 0) {
      const usdPerGram = usdPerOunce / 31.1034768;
      if (currency === 'USD') return usdPerGram;

      const rates = await fetchExchangeRates('USD');
      if (rates) {
        if (currency === 'INR' && rates.INR) return usdPerGram * rates.INR;
        if (currency === 'CAD' && rates.CAD) return usdPerGram * rates.CAD;
      }
    }

    // Fallback to the older XAU exchange-rate route if the gold endpoint is unavailable.
    const rates = await fetchExchangeRates('USD');
    if (rates && rates.XAU) {
      const fallbackUsdPerOunce = 1 / rates.XAU;
      const usdPerGram = fallbackUsdPerOunce / 31.1034768;

      if (currency === 'USD') return usdPerGram;
      if (currency === 'INR') return usdPerGram * rates.INR;
      if (currency === 'CAD') return usdPerGram * rates.CAD;
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch gold price:', error);
    return null;
  }
}

export async function fetchGoldSystemQuote(): Promise<PriceFetchResult> {
  try {
    const response = await fetch('https://api.gold-api.com/price/XAU');
    const data = await safeJson(response);
    const price = Number(data?.price);

    if (response.ok && Number.isFinite(price) && price > 0) {
      return {
        price,
        provider: 'gold',
        normalizedTicker: 'XAU',
        currency: 'USD',
        sourceUrl: 'https://gold-api.com/',
      };
    }

    return {
      price: null,
      provider: 'gold',
      normalizedTicker: 'XAU',
      currency: 'USD',
      sourceUrl: 'https://gold-api.com/',
      error: data?.error || 'Gold API did not return a valid gold quote.',
    };
  } catch (error) {
    return {
      price: null,
      provider: 'gold',
      normalizedTicker: 'XAU',
      currency: 'USD',
      sourceUrl: 'https://gold-api.com/',
      error: error instanceof Error ? error.message : 'Gold quote lookup failed.',
    };
  }
}

async function fetchYahooPrice(originalTicker: string, normalizedTicker: string): Promise<PriceFetchResult> {
  const cachedYahooResult = readCachedPrice(originalTicker, 'yahoo');
  if (isYahooCooldownActive()) {
    if (cachedYahooResult) {
      return {
        ...cachedYahooResult,
        provider: 'yahoo',
        error: 'Yahoo is temporarily rate-limiting requests. Using the last known Yahoo price for now.',
      };
    }

    return {
      price: null,
      provider: 'yahoo',
      normalizedTicker,
      error: 'Yahoo is temporarily rate-limiting requests. Please retry later or use another provider.',
    };
  }

  const response = await fetch(`/api/finance?ticker=${encodeURIComponent(originalTicker)}`);
  if (!response.ok) {
    const data = await safeJson(response);
    const error = data?.error || `Yahoo returned ${response.status}`;

    if (response.status === 429 || isYahooRateLimitMessage(error)) {
      setYahooCooldown();
      if (cachedYahooResult) {
        return {
          ...cachedYahooResult,
          provider: 'yahoo',
          error: 'Yahoo is temporarily rate-limiting requests. Using the last known Yahoo price for now.',
        };
      }
    }

    return {
      price: null,
      provider: 'yahoo',
      normalizedTicker,
      error,
    };
  }
  const data = await safeJson(response);
  if (!data) {
    return {
      price: null,
      provider: 'yahoo',
      normalizedTicker,
      error: 'Yahoo Finance proxy is unavailable from this app instance. Use the app server route or choose another provider.',
    };
  }
  const result: PriceFetchResult = {
    price: typeof data?.price === 'number' ? data.price : null,
    previousClose: typeof data?.previousClose === 'number' ? data.previousClose : null,
    provider: 'yahoo',
    normalizedTicker,
    currency: typeof data?.currency === 'string' ? data.currency : undefined,
    sourceUrl: typeof data?.sourceUrl === 'string' ? data.sourceUrl : buildProviderQuoteUrl('yahoo', normalizedTicker),
    error: typeof data?.price === 'number' ? undefined : 'Yahoo did not return a usable price.',
  };

  if (result.price != null) {
    clearYahooCooldown();
    writeCachedPrice(originalTicker, result);
  }

  return result;
}

async function fetchAlphaVantagePrice(ticker: string, apiKey: string): Promise<PriceFetchResult> {
  if (!apiKey) {
    return {
      price: null,
      provider: 'alphavantage',
      normalizedTicker: ticker,
      error: 'Missing Alpha Vantage API key.',
    };
  }

  const response = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`);
  const data = await safeJson(response);
  if (!data) {
    return {
      price: null,
      provider: 'alphavantage',
      normalizedTicker: ticker,
      error: 'Alpha Vantage returned an unreadable response.',
    };
  }
  const price = Number.parseFloat(data?.['Global Quote']?.['05. price']);
  const previousClose = Number.parseFloat(data?.['Global Quote']?.['08. previous close']);

  if (Number.isFinite(price) && price > 0) {
    return {
      price,
      previousClose: Number.isFinite(previousClose) ? previousClose : null,
      provider: 'alphavantage',
      normalizedTicker: ticker,
      currency: inferCurrencyFromTicker(ticker),
      sourceUrl: buildProviderQuoteUrl('alphavantage', ticker),
    };
  }

  return {
    price: null,
    provider: 'alphavantage',
    normalizedTicker: ticker,
    error: data?.Note || data?.Information || data?.['Error Message'] || 'Alpha Vantage did not return a valid quote.',
  };
}

async function fetchFinnhubPrice(ticker: string, apiKey: string): Promise<PriceFetchResult> {
  if (!apiKey) {
    return {
      price: null,
      provider: 'finnhub',
      normalizedTicker: ticker,
      error: 'Missing Finnhub API key.',
    };
  }

  const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`);
  const data = await safeJson(response);
  if (!data) {
    return {
      price: null,
      provider: 'finnhub',
      normalizedTicker: ticker,
      error: 'Finnhub returned an unreadable response.',
    };
  }
  const price = Number(data?.c);
  const previousClose = Number(data?.pc);

  if (Number.isFinite(price) && price > 0) {
    return {
      price,
      previousClose: Number.isFinite(previousClose) ? previousClose : null,
      provider: 'finnhub',
      normalizedTicker: ticker,
      currency: inferCurrencyFromTicker(ticker),
      sourceUrl: buildProviderQuoteUrl('finnhub', ticker),
    };
  }

  return {
    price: null,
    provider: 'finnhub',
    normalizedTicker: ticker,
    error: data?.error || 'Finnhub did not return a valid quote.',
  };
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function dedupeProviders(providers: PriceProvider[]) {
  return Array.from(new Set(providers));
}

function prioritizeAvailableProviders(
  providers: PriceProvider[],
  settings: PriceProviderSettings = DEFAULT_PRICE_PROVIDER_SETTINGS,
) {
  const preferNonYahoo = isYahooCooldownActive() || hasConfiguredNonYahooProvider(settings);
  if (!preferNonYahoo) return providers;

  return [...providers].sort((left, right) => {
    if (left === right) return 0;
    if (left === 'yahoo') return 1;
    if (right === 'yahoo') return -1;
    return 0;
  });
}

export function hasConfiguredNonYahooProvider(settings: PriceProviderSettings = DEFAULT_PRICE_PROVIDER_SETTINGS) {
  return Boolean(settings.alphaVantageApiKey?.trim() || settings.finnhubApiKey?.trim());
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function getYahooCooldownKey() {
  return 'nexus-portfolio:yahoo-cooldown-until';
}

function getPriceCacheKey(ticker: string, provider: PriceProvider) {
  return `nexus-portfolio:price-cache:${provider}:${ticker.trim().toUpperCase()}`;
}

function isYahooCooldownActive() {
  const storage = getStorage();
  if (!storage) return false;
  const rawValue = storage.getItem(getYahooCooldownKey());
  const cooldownUntil = rawValue ? Number(rawValue) : 0;
  if (!Number.isFinite(cooldownUntil) || cooldownUntil <= Date.now()) {
    storage.removeItem(getYahooCooldownKey());
    return false;
  }
  return true;
}

function setYahooCooldown() {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(getYahooCooldownKey(), String(Date.now() + YAHOO_COOLDOWN_MS));
}

function clearYahooCooldown() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(getYahooCooldownKey());
}

function readCachedPrice(ticker: string, provider: PriceProvider): CachedPriceResult | null {
  const storage = getStorage();
  if (!storage) return null;

  const rawValue = storage.getItem(getPriceCacheKey(ticker, provider));
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as Partial<CachedPriceResult>;
    if (typeof parsed.price !== 'number') return null;
    return {
      price: parsed.price,
      previousClose: typeof parsed.previousClose === 'number' ? parsed.previousClose : null,
      currency: typeof parsed.currency === 'string' ? parsed.currency : undefined,
      sourceUrl: typeof parsed.sourceUrl === 'string' ? parsed.sourceUrl : undefined,
      normalizedTicker: typeof parsed.normalizedTicker === 'string' ? parsed.normalizedTicker : undefined,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch {
    storage.removeItem(getPriceCacheKey(ticker, provider));
    return null;
  }
}

function writeCachedPrice(ticker: string, result: PriceFetchResult) {
  const storage = getStorage();
  if (!storage || result.price == null) return;

  const payload: CachedPriceResult = {
    price: result.price,
    previousClose: typeof result.previousClose === 'number' ? result.previousClose : null,
    currency: result.currency,
    sourceUrl: result.sourceUrl,
    normalizedTicker: result.normalizedTicker,
    savedAt: Date.now(),
  };

  storage.setItem(getPriceCacheKey(ticker, result.provider), JSON.stringify(payload));
}

function isYahooRateLimitMessage(message?: string) {
  if (!message) return false;
  const normalizedMessage = message.toLowerCase();
  return normalizedMessage.includes('429') || normalizedMessage.includes('rate limit');
}

function buildProviderQuoteUrl(provider: ResolvedPriceProvider, ticker: string) {
  switch (provider) {
    case 'yahoo':
      return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
    case 'alphavantage':
      return `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}`;
    case 'finnhub':
      return `https://finnhub.io/quote?symbol=${encodeURIComponent(ticker)}`;
    case 'massive':
      return `https://massive.com/stocks/${encodeURIComponent(ticker)}`;
    case 'amfi':
      return 'https://www.amfiindia.com/net-asset-value/nav-download';
    case 'upstox':
      return 'https://upstox.com/developer/api-documentation/market-quote/';
    case 'gold':
      return 'https://gold-api.com/';
    default:
      return undefined;
  }
}

function isResolvedPriceProvider(value: unknown): value is ResolvedPriceProvider {
  return value === 'yahoo' || value === 'alphavantage' || value === 'finnhub' || value === 'massive' || value === 'amfi' || value === 'upstox' || value === 'gold';
}
