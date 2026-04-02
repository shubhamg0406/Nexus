export function getYahooTicker(ticker: string) {
  if (!ticker.includes(':')) return ticker;
  const [exchange, symbol] = ticker.split(':');

  switch (exchange.toUpperCase()) {
    case 'NASDAQ':
    case 'NYSE':
    case 'AMEX':
      return symbol;
    case 'NSE':
      return `${symbol}.NS`;
    case 'BOM':
      return `${symbol}.BO`;
    case 'TSE':
      return `${symbol}.TO`;
    case 'CVE':
      return `${symbol}.V`;
    case 'LON':
      return `${symbol}.L`;
    case 'FRA':
      return `${symbol}.F`;
    case 'TYO':
      return `${symbol}.T`;
    default:
      return symbol;
  }
}

export interface ServerPriceResult {
  price: number | null;
  previousClose: number | null;
  currency: string | null;
  sourceUrl: string | null;
  normalizedTicker: string;
  provider: 'yahoo' | 'massive' | 'amfi' | 'alphavantage' | 'upstox';
  error: string | null;
}

const YAHOO_HEADERS = {
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
};

const SERVER_YAHOO_COOLDOWN_MS = 5 * 60 * 1000;
const SERVER_YAHOO_CACHE_TTL_MS = 15 * 60 * 1000;
const SERVER_AMFI_CACHE_TTL_MS = 60 * 1000;
const SERVER_CLOSE_CACHE_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const serverYahooCache = new Map<string, {
  price: number;
  previousClose: number | null;
  currency: string | null;
  savedAt: number;
}>();
const serverMarketCloseCache = new Map<string, {
  price: number;
  previousClose: number | null;
  currency: string | null;
  sourceUrl: string | null;
  normalizedTicker: string;
  provider: 'massive' | 'alphavantage';
  savedAt: number;
  dayKey: string;
}>();
const inFlightYahooRequests = new Map<string, Promise<ReturnType<typeof buildYahooResult>>>();
const inFlightCloseRequests = new Map<string, Promise<ServerPriceResult>>();
let amfiCache:
  | {
      entries: AmfiNavEntry[];
      savedAt: number;
    }
  | null = null;
let inFlightAmfiEntriesRequest: Promise<AmfiNavEntry[]> | null = null;
let serverYahooCooldownUntil = 0;

interface AmfiNavEntry {
  schemeCode: string;
  isinGrowth: string;
  isinDividend: string;
  schemeName: string;
  nav: number;
  date: string;
}

interface UpstoxInstrumentSearchEntry {
  exchange?: string;
  segment?: string;
  instrument_type?: string;
  instrument_key?: string;
  trading_symbol?: string;
  tradingsymbol?: string;
  short_name?: string;
  exchange_token?: string;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildYahooResult(
  ticker: string,
  yahooTicker: string,
  price: unknown,
  previousClose: unknown,
  currency: unknown,
  error: string | null,
) {
  return {
    price: typeof price === 'number' ? price : null,
    previousClose: typeof previousClose === 'number' ? previousClose : null,
    yahooTicker,
    currency: typeof currency === 'string' ? currency : null,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(yahooTicker)}`,
    error,
  };
}

function readServerYahooCache(yahooTicker: string) {
  return serverYahooCache.get(yahooTicker) ?? null;
}

function isFreshServerYahooCache(
  cachedResult: ReturnType<typeof readServerYahooCache>,
  maxAgeMs: number = SERVER_YAHOO_CACHE_TTL_MS,
) {
  if (!cachedResult) return false;
  return cachedResult.savedAt + maxAgeMs > Date.now();
}

function writeServerYahooCache(yahooTicker: string, price: number, previousClose: number | null, currency: string | null) {
  serverYahooCache.set(yahooTicker, {
    price,
    previousClose,
    currency,
    savedAt: Date.now(),
  });
}

function isServerYahooCooldownActive() {
  return serverYahooCooldownUntil > Date.now();
}

function setServerYahooCooldown() {
  serverYahooCooldownUntil = Date.now() + SERVER_YAHOO_COOLDOWN_MS;
}

function clearServerYahooCooldown() {
  serverYahooCooldownUntil = 0;
}

function getServerDayKey(value: Date = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readServerMarketCloseCache(provider: 'massive' | 'alphavantage', normalizedTicker: string) {
  return serverMarketCloseCache.get(`${provider}:${normalizedTicker}`) ?? null;
}

function writeServerMarketCloseCache(result: ServerPriceResult) {
  if ((result.provider !== 'massive' && result.provider !== 'alphavantage') || result.price == null) {
    return;
  }

  serverMarketCloseCache.set(`${result.provider}:${result.normalizedTicker}`, {
    price: result.price,
    previousClose: result.previousClose,
    currency: result.currency,
    sourceUrl: result.sourceUrl,
    normalizedTicker: result.normalizedTicker,
    provider: result.provider,
    savedAt: Date.now(),
    dayKey: getServerDayKey(),
  });
}

function buildCachedServerPriceResult(
  cached: NonNullable<ReturnType<typeof readServerMarketCloseCache>>,
  error: string | null = null,
): ServerPriceResult {
  return {
    price: cached.price,
    previousClose: cached.previousClose,
    currency: cached.currency,
    sourceUrl: cached.sourceUrl,
    normalizedTicker: cached.normalizedTicker,
    provider: cached.provider,
    error,
  };
}

function isFreshServerMarketCloseCache(cached: ReturnType<typeof readServerMarketCloseCache>) {
  if (!cached) return false;
  return cached.dayKey === getServerDayKey();
}

function isUsableServerMarketCloseCache(cached: ReturnType<typeof readServerMarketCloseCache>) {
  if (!cached) return false;
  return cached.savedAt + SERVER_CLOSE_CACHE_MAX_STALE_MS > Date.now();
}

export async function fetchYahooFinancePrice(ticker: string) {
  const yahooTicker = getYahooTicker(ticker);
  const cachedResult = readServerYahooCache(yahooTicker);
  const inFlightRequest = inFlightYahooRequests.get(yahooTicker);

  if (isFreshServerYahooCache(cachedResult)) {
    return buildYahooResult(
      ticker,
      yahooTicker,
      cachedResult.price,
      cachedResult.previousClose,
      cachedResult.currency,
      null,
    );
  }

  if (isServerYahooCooldownActive() && cachedResult) {
    return buildYahooResult(
      ticker,
      yahooTicker,
      cachedResult.price,
      cachedResult.previousClose,
      cachedResult.currency,
      'Yahoo is temporarily rate-limiting requests. Using the last known server-side Yahoo price for now.',
    );
  }

  if (inFlightRequest) {
    return inFlightRequest;
  }

  const request = (async () => {
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      yahooTicker,
    )}`;
    const quoteResponse = await fetch(quoteUrl, { headers: YAHOO_HEADERS });
    const quoteData = await safeJson(quoteResponse);
    const quote = quoteData?.quoteResponse?.result?.[0];
    const quotePrice = quote?.regularMarketPrice;
    const quotePreviousClose =
      quote?.regularMarketPreviousClose ?? quote?.previousClose ?? quote?.chartPreviousClose;
    const quoteCurrency = quote?.currency;

    if (quoteResponse.ok && typeof quotePrice === 'number') {
      clearServerYahooCooldown();
      writeServerYahooCache(
        yahooTicker,
        quotePrice,
        typeof quotePreviousClose === 'number' ? quotePreviousClose : null,
        typeof quoteCurrency === 'string' ? quoteCurrency : null,
      );
      return buildYahooResult(
        ticker,
        yahooTicker,
        quotePrice,
        quotePreviousClose,
        quoteCurrency,
        null,
      );
    }

    if (quoteResponse.status === 429) {
      setServerYahooCooldown();
      if (cachedResult) {
        return buildYahooResult(
          ticker,
          yahooTicker,
          cachedResult.price,
          cachedResult.previousClose,
          cachedResult.currency,
          'Yahoo is temporarily rate-limiting requests. Using the last known server-side Yahoo price for now.',
        );
      }
    }

    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      yahooTicker,
    )}`;
    const chartResponse = await fetch(chartUrl, { headers: YAHOO_HEADERS });
    const chartData = await safeJson(chartResponse);
    const chartResult = chartData?.chart?.result?.[0];
    const meta = chartResult?.meta;
    const chartPrice = meta?.regularMarketPrice;
    const chartPreviousClose =
      meta?.previousClose ?? meta?.chartPreviousClose ?? meta?.regularMarketPreviousClose;
    const chartCurrency = meta?.currency;

    if (chartResponse.ok && typeof chartPrice === 'number') {
      clearServerYahooCooldown();
      writeServerYahooCache(
        yahooTicker,
        chartPrice,
        typeof chartPreviousClose === 'number' ? chartPreviousClose : null,
        typeof chartCurrency === 'string' ? chartCurrency : null,
      );
      return buildYahooResult(
        ticker,
        yahooTicker,
        chartPrice,
        chartPreviousClose,
        chartCurrency,
        null,
      );
    }

    const statusMessage = [quoteResponse.status, chartResponse.status]
      .filter((status) => typeof status === 'number' && status > 0)
      .join('/');

    if (chartResponse.status === 429) {
      setServerYahooCooldown();
      if (cachedResult) {
        return buildYahooResult(
          ticker,
          yahooTicker,
          cachedResult.price,
          cachedResult.previousClose,
          cachedResult.currency,
          'Yahoo is temporarily rate-limiting requests. Using the last known server-side Yahoo price for now.',
        );
      }
    }

    return buildYahooResult(
      ticker,
      yahooTicker,
      null,
      chartPreviousClose ?? quotePreviousClose,
      chartCurrency ?? quoteCurrency,
      statusMessage
        ? `Yahoo lookup failed (${statusMessage}) for ${yahooTicker}. Try another provider or a different ticker format.`
        : `Price not found for ticker: ${ticker} (Yahoo: ${yahooTicker})`,
    );
  })()
    .catch(() => {
      if (cachedResult) {
        setServerYahooCooldown();
        return buildYahooResult(
          ticker,
          yahooTicker,
          cachedResult.price,
          cachedResult.previousClose,
          cachedResult.currency,
          'Yahoo is temporarily unavailable. Using the last known server-side Yahoo price for now.',
        );
      }
      return buildYahooResult(
        ticker,
        yahooTicker,
        null,
        null,
        null,
        `Yahoo lookup failed for ${yahooTicker}. Try another provider or a different ticker format.`,
      );
    })
    .finally(() => {
      inFlightYahooRequests.delete(yahooTicker);
    });

  inFlightYahooRequests.set(yahooTicker, request);
  return request;
}

export async function fetchAutoMatchedPrice(params: {
  ticker: string;
  name?: string;
  assetClass?: string;
  country?: string;
}): Promise<ServerPriceResult> {
  const ticker = params.ticker.trim();
  if (!ticker) {
    return {
      price: null,
      previousClose: null,
      currency: null,
      sourceUrl: null,
      normalizedTicker: '',
      provider: 'yahoo',
      error: 'Ticker is required.',
    };
  }

  if (isIndianMutualFund(params)) {
    return fetchAmfiNavPrice({
      ticker,
      name: params.name || '',
    });
  }

  if (isIndianStock(params)) {
    const upstoxResult = await fetchUpstoxIndiaStockPrice(ticker);
    if (upstoxResult.price != null || hasUpstoxSystemConfig()) {
      return upstoxResult;
    }
  }

  if (isMassiveCandidate(ticker)) {
    return fetchMassivePreviousClosePrice(ticker);
  }

  if (isCanadianAlphaVantageCandidate(ticker, params.country)) {
    return fetchAlphaVantageCanadaClosePrice(ticker);
  }

  const yahooResult = await fetchYahooFinancePrice(ticker);
  return {
    price: yahooResult.price,
    previousClose: yahooResult.previousClose,
    currency: yahooResult.currency,
    sourceUrl: yahooResult.sourceUrl,
    normalizedTicker: yahooResult.yahooTicker,
    provider: 'yahoo',
    error: yahooResult.error,
  };
}

async function fetchAlphaVantageCanadaClosePrice(ticker: string): Promise<ServerPriceResult> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  const normalizedTicker = normalizeTickerForAlphaVantageCanada(ticker);
  const cachedResult = normalizedTicker ? readServerMarketCloseCache('alphavantage', normalizedTicker) : null;
  const inFlightKey = normalizedTicker ? `alphavantage:${normalizedTicker}` : null;

  if (!normalizedTicker) {
    return {
      price: null,
      previousClose: null,
      currency: 'CAD',
      sourceUrl: null,
      normalizedTicker: ticker,
      provider: 'alphavantage',
      error: 'Ticker is not a supported Canadian stock symbol for Alpha Vantage auto-matching.',
    };
  }

  if (isFreshServerMarketCloseCache(cachedResult)) {
    return buildCachedServerPriceResult(cachedResult);
  }

  if (inFlightKey) {
    const existingRequest = inFlightCloseRequests.get(inFlightKey);
    if (existingRequest) {
      return existingRequest;
    }
  }

  if (!apiKey) {
    return {
      price: null,
      previousClose: null,
      currency: 'CAD',
      sourceUrl: null,
      normalizedTicker,
      provider: 'alphavantage',
      error: 'Alpha Vantage API key is missing.',
    };
  }

  const url =
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(normalizedTicker)}` +
    `&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`;

  const request = (async () => {
    const response = await fetch(url);
    const data = await safeJson(response);
    const timeSeries = data?.['Time Series (Daily)'];
    const sortedDates = timeSeries ? Object.keys(timeSeries).sort((left, right) => right.localeCompare(left)) : [];
    const latestEntry = sortedDates[0] ? timeSeries?.[sortedDates[0]] : null;
    const previousEntry = sortedDates[1] ? timeSeries?.[sortedDates[1]] : null;
    const closePrice = Number.parseFloat(latestEntry?.['4. close'] || '');
    const previousClose = Number.parseFloat(previousEntry?.['4. close'] || '');

    if (response.ok && Number.isFinite(closePrice) && closePrice > 0) {
      const result = {
        price: closePrice,
        previousClose: Number.isFinite(previousClose) ? previousClose : null,
        currency: 'CAD',
        sourceUrl: buildAlphaVantageQuoteUrl(normalizedTicker),
        normalizedTicker,
        provider: 'alphavantage',
        error: null,
      } satisfies ServerPriceResult;
      writeServerMarketCloseCache(result);
      return result;
    }

    if (isUsableServerMarketCloseCache(cachedResult)) {
      return buildCachedServerPriceResult(
        cachedResult,
        'Alpha Vantage did not return a fresh close price today. Using the last cached Canada close for now.',
      );
    }

    return {
      price: null,
      previousClose: null,
      currency: 'CAD',
      sourceUrl: buildAlphaVantageQuoteUrl(normalizedTicker),
      normalizedTicker,
      provider: 'alphavantage',
      error: data?.Note || data?.Information || data?.['Error Message'] || `Alpha Vantage did not return a usable close price for ${normalizedTicker}.`,
    };
  })().catch(() => {
    if (isUsableServerMarketCloseCache(cachedResult)) {
      return buildCachedServerPriceResult(
        cachedResult,
        'Alpha Vantage is temporarily unavailable. Using the last cached Canada close for now.',
      );
    }
    return {
      price: null,
      previousClose: null,
      currency: 'CAD',
      sourceUrl: buildAlphaVantageQuoteUrl(normalizedTicker),
      normalizedTicker,
      provider: 'alphavantage',
      error: `Alpha Vantage lookup failed for ${normalizedTicker}.`,
    };
  }).finally(() => {
    if (inFlightKey) {
      inFlightCloseRequests.delete(inFlightKey);
    }
  });

  if (inFlightKey) {
    inFlightCloseRequests.set(inFlightKey, request);
  }

  return request;
}

async function fetchMassivePreviousClosePrice(ticker: string): Promise<ServerPriceResult> {
  const apiKey = process.env.MASSIVE_API_KEY?.trim();
  const normalizedTicker = normalizeTickerForMassive(ticker);
  const cachedResult = normalizedTicker ? readServerMarketCloseCache('massive', normalizedTicker) : null;
  const inFlightKey = normalizedTicker ? `massive:${normalizedTicker}` : null;

  if (!normalizedTicker) {
    return {
      price: null,
      previousClose: null,
      currency: null,
      sourceUrl: null,
      normalizedTicker: ticker,
      provider: 'massive',
      error: 'Ticker is not a supported U.S. symbol for Massive auto-matching.',
    };
  }

  if (isFreshServerMarketCloseCache(cachedResult)) {
    return buildCachedServerPriceResult(cachedResult);
  }

  if (inFlightKey) {
    const existingRequest = inFlightCloseRequests.get(inFlightKey);
    if (existingRequest) {
      return existingRequest;
    }
  }

  if (!apiKey) {
    return {
      price: null,
      previousClose: null,
      currency: null,
      sourceUrl: null,
      normalizedTicker,
      provider: 'massive',
      error: 'Massive API key is missing.',
    };
  }

  const now = new Date();
  const toDate = formatDateForApi(now);
  const fromDate = formatDateForApi(new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000));
  const url =
    `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(normalizedTicker)}` +
    `/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=10&apiKey=${encodeURIComponent(apiKey)}`;

  const request = (async () => {
    const response = await fetch(url);
    const data = await safeJson(response);
    const results = Array.isArray(data?.results) ? data.results : [];
    const latestBar = results.at(-1);
    const priorBar = results.length > 1 ? results.at(-2) : null;
    const closePrice = Number(latestBar?.c);
    const previousClose = Number(priorBar?.c);

    if (response.ok && Number.isFinite(closePrice) && closePrice > 0) {
      const result = {
        price: closePrice,
        previousClose: Number.isFinite(previousClose) ? previousClose : null,
        currency: inferServerCurrencyFromTicker(normalizedTicker),
        sourceUrl: `https://massive.com/stocks/${encodeURIComponent(normalizedTicker)}`,
        normalizedTicker,
        provider: 'massive',
        error: null,
      } satisfies ServerPriceResult;
      writeServerMarketCloseCache(result);
      return result;
    }

    if (isUsableServerMarketCloseCache(cachedResult)) {
      return buildCachedServerPriceResult(
        cachedResult,
        'Massive did not return a fresh close price today. Using the last cached U.S. close for now.',
      );
    }

    return {
      price: null,
      previousClose: null,
      currency: inferServerCurrencyFromTicker(normalizedTicker),
      sourceUrl: `https://massive.com/stocks/${encodeURIComponent(normalizedTicker)}`,
      normalizedTicker,
      provider: 'massive',
      error: data?.error || data?.message || `Massive did not return a usable close price for ${normalizedTicker}.`,
    };
  })().catch(() => {
    if (isUsableServerMarketCloseCache(cachedResult)) {
      return buildCachedServerPriceResult(
        cachedResult,
        'Massive is temporarily unavailable. Using the last cached U.S. close for now.',
      );
    }
    return {
      price: null,
      previousClose: null,
      currency: inferServerCurrencyFromTicker(normalizedTicker),
      sourceUrl: `https://massive.com/stocks/${encodeURIComponent(normalizedTicker)}`,
      normalizedTicker,
      provider: 'massive',
      error: `Massive lookup failed for ${normalizedTicker}.`,
    };
  }).finally(() => {
    if (inFlightKey) {
      inFlightCloseRequests.delete(inFlightKey);
    }
  });

  if (inFlightKey) {
    inFlightCloseRequests.set(inFlightKey, request);
  }

  return request;
}

async function fetchAmfiNavPrice(params: { ticker: string; name: string }): Promise<ServerPriceResult> {
  const entries = await getAmfiNavEntries();
  const match = findBestAmfiMatch(entries, params);

  if (!match) {
    return {
      price: null,
      previousClose: null,
      currency: 'INR',
      sourceUrl: 'https://www.amfiindia.com/net-asset-value/nav-download',
      normalizedTicker: params.ticker,
      provider: 'amfi',
      error: 'No AMFI scheme match found from the existing asset name and ticker.',
    };
  }

  return {
    price: match.nav,
    previousClose: null,
    currency: 'INR',
    sourceUrl: 'https://www.amfiindia.com/net-asset-value/nav-download',
    normalizedTicker: match.schemeCode,
    provider: 'amfi',
    error: null,
  };
}

async function getAmfiNavEntries() {
  if (amfiCache && amfiCache.savedAt + SERVER_AMFI_CACHE_TTL_MS > Date.now()) {
    return amfiCache.entries;
  }

  if (inFlightAmfiEntriesRequest) {
    return inFlightAmfiEntriesRequest;
  }

  const request = (async () => {
    const response = await fetch('https://portal.amfiindia.com/spages/NAVAll.txt');
    const text = await response.text();
    const entries = parseAmfiNavText(text);
    amfiCache = {
      entries,
      savedAt: Date.now(),
    };
    return entries;
  })().finally(() => {
    inFlightAmfiEntriesRequest = null;
  });

  inFlightAmfiEntriesRequest = request;
  return request;
}

function parseAmfiNavText(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(';'))
    .map((line) => line.split(';'))
    .filter((parts) => parts.length >= 6 && /^\d+$/.test(parts[0]?.trim() || ''))
    .map((parts) => ({
      schemeCode: parts[0].trim(),
      isinGrowth: parts[1].trim(),
      isinDividend: parts[2].trim(),
      schemeName: parts[3].trim(),
      nav: Number(parts[4].trim()),
      date: parts[5].trim(),
    }))
    .filter((entry) => Number.isFinite(entry.nav) && entry.nav > 0);
}

function findBestAmfiMatch(entries: AmfiNavEntry[], params: { ticker: string; name: string }) {
  const directCodeMatch = entries.find((entry) => entry.schemeCode === params.ticker.trim());
  if (directCodeMatch) return directCodeMatch;

  const upperTicker = params.ticker.trim().toUpperCase();
  const isinMatch = entries.find((entry) => entry.isinGrowth === upperTicker || entry.isinDividend === upperTicker);
  if (isinMatch) return isinMatch;

  const query = params.name.trim() || params.ticker.trim();
  const queryTokens = tokenizeFundName(query);
  const queryFlags = extractFundFlags(query);

  let bestMatch: AmfiNavEntry | null = null;
  let bestScore = 0;

  for (const entry of entries) {
    const entryTokens = tokenizeFundName(entry.schemeName);
    const entryFlags = extractFundFlags(entry.schemeName);
    const commonTokenCount = countCommonTokens(queryTokens, entryTokens);
    if (commonTokenCount === 0) continue;

    let score = commonTokenCount * 10;
    if (sameTokens(queryTokens, entryTokens)) score += 30;
    if (queryFlags.direct === entryFlags.direct) score += 6;
    if (queryFlags.regular === entryFlags.regular) score += 6;
    if (queryFlags.growth === entryFlags.growth) score += 6;
    if (queryFlags.idcw === entryFlags.idcw) score += 4;
    if (normalizeFundName(entry.schemeName).includes(normalizeFundName(query))) score += 10;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestScore >= 20 ? bestMatch : null;
}

function tokenizeFundName(value: string) {
  return normalizeFundName(value)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !AMFI_STOPWORDS.has(token));
}

function normalizeFundName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFundFlags(value: string) {
  const normalized = normalizeFundName(value);
  return {
    direct: normalized.includes('direct'),
    regular: normalized.includes('regular'),
    growth: normalized.includes('growth'),
    idcw: normalized.includes('idcw') || normalized.includes('dividend'),
  };
}

function countCommonTokens(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function sameTokens(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((token) => rightSet.has(token));
}

function isIndianMutualFund(params: { ticker?: string; assetClass?: string; country?: string }) {
  const assetClass = params.assetClass?.trim().toLowerCase();
  const country = params.country?.trim().toLowerCase();
  const ticker = params.ticker?.trim().toUpperCase() || '';

  if (country !== 'india') return false;

  if (
    assetClass === 'mutual fund' ||
    assetClass === 'mutual funds' ||
    assetClass === 'mf' ||
    assetClass === 'mfs' ||
    assetClass?.includes('mutual') ||
    assetClass?.includes('fund')
  ) {
    return true;
  }

  return /^\d{5,}$/.test(ticker) || ticker.startsWith('INF') || /^OP[0-9A-Z.]+$/.test(ticker);
}

function isIndianStock(params: { ticker?: string; assetClass?: string; country?: string }) {
  const ticker = params.ticker?.trim().toUpperCase() || '';
  const assetClass = params.assetClass?.trim().toLowerCase();
  const country = params.country?.trim().toLowerCase();
  return (
    (country === 'india' && assetClass === 'stocks') ||
    ticker.startsWith('NSE:') ||
    ticker.startsWith('BOM:')
  );
}

function hasUpstoxSystemConfig() {
  return Boolean(process.env.UPSTOX_CLIENT_ID?.trim() && process.env.UPSTOX_CLIENT_SECRET?.trim());
}

function normalizeTickerForUpstoxSearch(ticker: string) {
  const rawTicker = ticker.trim().toUpperCase();
  if (!rawTicker) return null;
  if (!rawTicker.includes(':')) {
    return {
      query: rawTicker,
      exchange: undefined as 'NSE' | 'BSE' | undefined,
    };
  }

  const [exchange, symbol] = rawTicker.split(':');
  if (!symbol) return null;
  if (exchange === 'NSE') return { query: symbol.trim(), exchange: 'NSE' as const };
  if (exchange === 'BOM') return { query: symbol.trim(), exchange: 'BSE' as const };
  return null;
}

function getUpstoxHeaders(accessToken: string) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

function extractUpstoxSearchResults(payload: any): UpstoxInstrumentSearchEntry[] {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.results)) return payload.data.results;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function selectUpstoxInstrumentMatch(
  results: UpstoxInstrumentSearchEntry[],
  query: string,
  exchange?: 'NSE' | 'BSE',
) {
  const normalizedQuery = query.trim().toUpperCase();
  const filtered = results.filter((entry) => {
    if (exchange && String(entry.exchange || '').toUpperCase() !== exchange) return false;
    const segment = String(entry.segment || '').toUpperCase();
    const instrumentType = String(entry.instrument_type || '').toUpperCase();
    return (segment.includes('_EQ') || segment === 'EQ' || segment === '') && (instrumentType === 'EQ' || instrumentType === '');
  });

  return (
    filtered.find((entry) =>
      String(entry.trading_symbol || entry.tradingsymbol || '').toUpperCase() === normalizedQuery ||
      String(entry.exchange_token || '').toUpperCase() === normalizedQuery ||
      String(entry.short_name || '').toUpperCase() === normalizedQuery
    ) ||
    filtered[0] ||
    null
  );
}

async function fetchUpstoxIndiaStockPrice(ticker: string): Promise<ServerPriceResult> {
  const target = normalizeTickerForUpstoxSearch(ticker);
  if (!target) {
    return {
      price: null,
      previousClose: null,
      currency: 'INR',
      sourceUrl: null,
      normalizedTicker: ticker,
      provider: 'upstox',
      error: 'Ticker is not a supported India stock symbol for Upstox.',
    };
  }

  const accessToken = process.env.UPSTOX_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return {
      price: null,
      previousClose: null,
      currency: 'INR',
      sourceUrl: null,
      normalizedTicker: ticker,
      provider: 'upstox',
      error: 'Upstox is configured for system India stock pricing, but the server access token is missing or expired.',
    };
  }

  try {
    const searchUrl = new URL('https://api.upstox.com/v1/instruments/search');
    searchUrl.searchParams.set('query', target.query);
    searchUrl.searchParams.set('segment', 'EQ');
    if (target.exchange) {
      searchUrl.searchParams.set('exchange', target.exchange);
    }

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: getUpstoxHeaders(accessToken),
    });
    const searchData = await safeJson(searchResponse);

    if (searchResponse.status === 401) {
      return {
        price: null,
        previousClose: null,
        currency: 'INR',
        sourceUrl: null,
        normalizedTicker: ticker,
        provider: 'upstox',
        error: 'The Upstox access token has expired. Upstox system pricing must be re-authorized daily.',
      };
    }

    const match = selectUpstoxInstrumentMatch(extractUpstoxSearchResults(searchData), target.query, target.exchange);
    if (!searchResponse.ok || !match?.instrument_key) {
      return {
        price: null,
        previousClose: null,
        currency: 'INR',
        sourceUrl: null,
        normalizedTicker: ticker,
        provider: 'upstox',
        error: `Upstox could not resolve an India stock instrument for ${ticker}.`,
      };
    }

    const quoteUrl = new URL('https://api.upstox.com/v2/market-quote/quotes');
    quoteUrl.searchParams.set('instrument_key', match.instrument_key);
    const quoteResponse = await fetch(quoteUrl.toString(), {
      headers: getUpstoxHeaders(accessToken),
    });
    const quoteData = await safeJson(quoteResponse);

    if (quoteResponse.status === 401) {
      return {
        price: null,
        previousClose: null,
        currency: 'INR',
        sourceUrl: null,
        normalizedTicker: match.instrument_key,
        provider: 'upstox',
        error: 'The Upstox access token has expired. Upstox system pricing must be re-authorized daily.',
      };
    }

    const quoteRecord = quoteData?.data?.[match.instrument_key] || Object.values(quoteData?.data || {})[0];
    const lastPrice = typeof quoteRecord?.last_price === 'number' ? quoteRecord.last_price : null;
    const previousClose = typeof quoteRecord?.ohlc?.close === 'number' ? quoteRecord.ohlc.close : null;

    return {
      price: lastPrice,
      previousClose,
      currency: 'INR',
      sourceUrl: `https://upstox.com/stocks/${encodeURIComponent(String(match.trading_symbol || match.tradingsymbol || target.query))}-share-price/`,
      normalizedTicker: match.instrument_key,
      provider: 'upstox',
      error: lastPrice == null ? `Upstox did not return a usable quote for ${ticker}.` : null,
    };
  } catch {
    return {
      price: null,
      previousClose: null,
      currency: 'INR',
      sourceUrl: null,
      normalizedTicker: ticker,
      provider: 'upstox',
      error: `Upstox lookup failed for ${ticker}.`,
    };
  }
}

function isMassiveCandidate(ticker: string) {
  return Boolean(normalizeTickerForMassive(ticker));
}

function isCanadianAlphaVantageCandidate(ticker: string, country?: string) {
  const normalizedCountry = country?.trim().toLowerCase();
  return normalizedCountry === 'canada' || Boolean(normalizeTickerForAlphaVantageCanada(ticker));
}

function normalizeTickerForMassive(ticker: string) {
  const rawTicker = ticker.trim().toUpperCase();
  if (!rawTicker) return '';
  if (rawTicker.startsWith('NASDAQ:') || rawTicker.startsWith('NYSE:') || rawTicker.startsWith('AMEX:')) {
    return rawTicker.split(':')[1] || '';
  }
  if (rawTicker.includes(':')) return '';
  if (rawTicker.includes('.')) return '';
  return /^[A-Z0-9.-]+$/.test(rawTicker) ? rawTicker : '';
}

function normalizeTickerForAlphaVantageCanada(ticker: string) {
  const rawTicker = ticker.trim().toUpperCase();
  if (!rawTicker) return '';
  if (rawTicker.startsWith('TSE:')) {
    const symbol = rawTicker.split(':')[1] || '';
    return symbol ? `${symbol}.TRT` : '';
  }
  if (rawTicker.startsWith('CVE:')) {
    const symbol = rawTicker.split(':')[1] || '';
    return symbol ? `${symbol}.TRV` : '';
  }
  if (rawTicker.endsWith('.TO')) {
    return `${rawTicker.slice(0, -3)}.TRT`;
  }
  if (rawTicker.endsWith('.V')) {
    return `${rawTicker.slice(0, -2)}.TRV`;
  }
  return '';
}

function inferServerCurrencyFromTicker(ticker: string) {
  if (ticker.endsWith('.TO') || ticker.endsWith('.V')) return 'CAD';
  if (ticker.endsWith('.NS') || ticker.endsWith('.BO')) return 'INR';
  return 'USD';
}

function formatDateForApi(value: Date) {
  return value.toISOString().slice(0, 10);
}

function buildAlphaVantageQuoteUrl(ticker: string) {
  return `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}`;
}

const AMFI_STOPWORDS = new Set([
  'fund',
  'plan',
  'option',
  'mutual',
  'direct',
  'regular',
  'growth',
  'idcw',
  'dividend',
  'payout',
  'reinvestment',
  'reinvest',
  'monthly',
  'weekly',
  'daily',
  'quarterly',
  'annual',
  'bonus',
  'income',
]);
