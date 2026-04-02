import { fetchAutoMatchedPrice } from '../src/lib/financeServer';

type RequestLike = {
  query: Record<string, string | string[] | undefined>;
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
};

export default async function handler(req: RequestLike, res: ResponseLike) {
  const rawTicker = req.query.ticker;
  const ticker = Array.isArray(rawTicker) ? rawTicker[0] : rawTicker;
  const rawName = req.query.name;
  const name = Array.isArray(rawName) ? rawName[0] : rawName;
  const rawAssetClass = req.query.assetClass;
  const assetClass = Array.isArray(rawAssetClass) ? rawAssetClass[0] : rawAssetClass;
  const rawCountry = req.query.country;
  const country = Array.isArray(rawCountry) ? rawCountry[0] : rawCountry;

  if (!ticker) {
    res.status(400).json({ error: 'Ticker is required' });
    return;
  }

  try {
    const result = await fetchAutoMatchedPrice({
      ticker,
      name,
      assetClass,
      country,
    });

    if (result.price == null) {
      res.status(404).json({
        error: result.error,
        previousClose: result.previousClose,
        currency: result.currency,
        sourceUrl: result.sourceUrl,
        normalizedTicker: result.normalizedTicker,
        provider: result.provider,
      });
      return;
    }

    res.status(200).json({
      price: result.price,
      previousClose: result.previousClose,
      currency: result.currency,
      sourceUrl: result.sourceUrl,
      normalizedTicker: result.normalizedTicker,
      provider: result.provider,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch data',
    });
  }
}
