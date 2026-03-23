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

const YAHOO_HEADERS = {
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
};

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

export async function fetchYahooFinancePrice(ticker: string) {
  const yahooTicker = getYahooTicker(ticker);
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooTicker,
  )}`;

  try {
    const yahooResponse = await fetch(yahooUrl, { headers: YAHOO_HEADERS });
    const yahooData = await safeJson(yahooResponse);
    const result = yahooData?.chart?.result?.[0];
    const meta = result?.meta;
    const chartPrice = meta?.regularMarketPrice;
    const chartPreviousClose =
      meta?.previousClose ?? meta?.chartPreviousClose ?? meta?.regularMarketPreviousClose;
    const chartCurrency = meta?.currency;

    if (yahooResponse.ok && typeof chartPrice === 'number') {
      return buildYahooResult(
        ticker,
        yahooTicker,
        chartPrice,
        chartPreviousClose,
        chartCurrency,
        null,
      );
    }

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
      return buildYahooResult(
        ticker,
        yahooTicker,
        quotePrice,
        quotePreviousClose,
        quoteCurrency,
        null,
      );
    }

    const statusMessage = [yahooResponse.status, quoteResponse.status]
      .filter((status) => typeof status === 'number' && status > 0)
      .join('/');

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
  } catch {
    return buildYahooResult(
      ticker,
      yahooTicker,
      null,
      null,
      null,
      `Yahoo lookup failed for ${yahooTicker}. Try another provider or a different ticker format.`,
    );
  }
}
