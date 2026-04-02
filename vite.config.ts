import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fetchAutoMatchedPrice } from './src/lib/financeServer';

const rootDir = process.cwd();

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (env.MASSIVE_API_KEY && !process.env.MASSIVE_API_KEY) {
    process.env.MASSIVE_API_KEY = env.MASSIVE_API_KEY;
  }
  if (env.ALPHA_VANTAGE_API_KEY && !process.env.ALPHA_VANTAGE_API_KEY) {
    process.env.ALPHA_VANTAGE_API_KEY = env.ALPHA_VANTAGE_API_KEY;
  }
  if (env.UPSTOX_CLIENT_ID && !process.env.UPSTOX_CLIENT_ID) {
    process.env.UPSTOX_CLIENT_ID = env.UPSTOX_CLIENT_ID;
  }
  if (env.UPSTOX_CLIENT_SECRET && !process.env.UPSTOX_CLIENT_SECRET) {
    process.env.UPSTOX_CLIENT_SECRET = env.UPSTOX_CLIENT_SECRET;
  }
  if (env.UPSTOX_REDIRECT_URI && !process.env.UPSTOX_REDIRECT_URI) {
    process.env.UPSTOX_REDIRECT_URI = env.UPSTOX_REDIRECT_URI;
  }
  if (env.UPSTOX_ACCESS_TOKEN && !process.env.UPSTOX_ACCESS_TOKEN) {
    process.env.UPSTOX_ACCESS_TOKEN = env.UPSTOX_ACCESS_TOKEN;
  }

  return {
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    plugins: [
      react(), 
      tailwindcss(),
      {
        name: 'local-finance-api',
        configureServer(server) {
          server.middlewares.use('/api/health', (_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'ok' }));
          });

          server.middlewares.use('/api/finance', async (req, res) => {
            const requestUrl = new URL(req.url || '', 'http://localhost');
            const ticker = requestUrl.searchParams.get('ticker');

            if (!ticker) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Ticker is required' }));
              return;
            }

            try {
              const result = await fetchAutoMatchedPrice({
                ticker,
                name: requestUrl.searchParams.get('name') || undefined,
                assetClass: requestUrl.searchParams.get('assetClass') || undefined,
                country: requestUrl.searchParams.get('country') || undefined,
              });
              if (result.price == null) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  error: result.error,
                  previousClose: result.previousClose,
                  currency: result.currency,
                  sourceUrl: result.sourceUrl,
                  normalizedTicker: 'provider' in result ? result.normalizedTicker : result.yahooTicker,
                  provider: 'provider' in result ? result.provider : 'yahoo',
                }));
                return;
              }

              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                price: result.price,
                previousClose: result.previousClose,
                currency: result.currency,
                sourceUrl: result.sourceUrl,
                normalizedTicker: 'provider' in result ? result.normalizedTicker : result.yahooTicker,
                provider: 'provider' in result ? result.provider : 'yahoo',
              }));
            } catch (error) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to fetch data' }));
            }
          });

          server.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith('/api/finance-auto')) {
              next();
              return;
            }

            const requestUrl = new URL(req.url, 'http://localhost');
            const ticker = requestUrl.searchParams.get('ticker');

            if (!ticker) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Ticker is required' }));
              return;
            }

            try {
              const result = await fetchAutoMatchedPrice({
                ticker,
                name: requestUrl.searchParams.get('name') || undefined,
                assetClass: requestUrl.searchParams.get('assetClass') || undefined,
                country: requestUrl.searchParams.get('country') || undefined,
              });

              res.statusCode = result.price == null ? 404 : 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result));
            } catch (error) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to fetch data' }));
            }
          });
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: false,
        },
        manifest: {
          name: 'Nexus Portfolio',
          short_name: 'Nexus',
          description: 'A private, multi-currency global wealth tracker.',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
