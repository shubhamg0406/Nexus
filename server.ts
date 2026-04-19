import express from 'express';
import { createServer as createViteServer, loadEnv } from 'vite';
import path from 'path';
import { fetchAutoMatchedPrice } from './src/lib/financeServer';
import { createSplitwiseRouter } from './src/server/splitwise/splitwiseRoutes';
import { createUpstoxRouter } from './src/server/providers/upstox/upstoxRoutes';
import { createSharedIntegrationsRouter } from './src/server/integrations/sharedRoutes';

function getNormalizedTicker(result: unknown) {
  const typed = result as { normalizedTicker?: string; yahooTicker?: string };
  return typed.normalizedTicker || typed.yahooTicker;
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/finance', async (req, res) => {
    const ticker = req.query.ticker as string;
    if (!ticker) {
      return res.status(400).json({ error: 'Ticker is required' });
    }

    try {
      const result = await fetchAutoMatchedPrice({
        ticker,
        name: req.query.name as string | undefined,
        assetClass: req.query.assetClass as string | undefined,
        country: req.query.country as string | undefined,
      });

      if (result.price !== null) {
        return res.json({
          price: result.price,
          previousClose: result.previousClose,
          currency: result.currency,
          sourceUrl: result.sourceUrl,
          normalizedTicker: getNormalizedTicker(result),
          provider: 'provider' in result ? result.provider : 'yahoo',
        });
      }

      return res.status(404).json({
        error: result.error,
        previousClose: result.previousClose,
        currency: result.currency,
        sourceUrl: result.sourceUrl,
        normalizedTicker: getNormalizedTicker(result),
        provider: 'provider' in result ? result.provider : 'yahoo',
      });
    } catch (error) {
      console.error('Error fetching finance data from Yahoo:', error);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }
  });

  app.get('/api/finance-auto', async (req, res) => {
    const ticker = req.query.ticker as string;
    if (!ticker) {
      return res.status(400).json({ error: 'Ticker is required' });
    }

    try {
      const result = await fetchAutoMatchedPrice({
        ticker,
        name: req.query.name as string | undefined,
        assetClass: req.query.assetClass as string | undefined,
        country: req.query.country as string | undefined,
      });

      if (result.price !== null) {
        return res.json(result);
      }
      return res.status(404).json(result);
    } catch (error) {
      console.error('Error fetching auto-matched finance data:', error);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }
  });

  app.use('/api/splitwise', createSplitwiseRouter());
  app.use('/api/integrations/splitwise', createSplitwiseRouter());
  app.use('/api/connections/upstox', createUpstoxRouter());
  app.use('/api/integrations', createSharedIntegrationsRouter());
  // Compatibility alias if redirect URI is configured without the /connections segment.
  app.use('/api/upstox', createUpstoxRouter());

  return app;
}

export async function startServer() {
  const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
  if (env.MASSIVE_API_KEY && !process.env.MASSIVE_API_KEY) {
    process.env.MASSIVE_API_KEY = env.MASSIVE_API_KEY;
  }

  const app = createApp();
  const PORT = Number(process.env.PORT || env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

void startServer();
