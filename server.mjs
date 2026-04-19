var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/financeServer.ts
function getYahooTicker(ticker) {
  if (!ticker.includes(":")) return ticker;
  const [exchange, symbol] = ticker.split(":");
  switch (exchange.toUpperCase()) {
    case "NASDAQ":
    case "NYSE":
    case "AMEX":
      return symbol;
    case "NSE":
      return `${symbol}.NS`;
    case "BOM":
      return `${symbol}.BO`;
    case "TSE":
      return `${symbol}.TO`;
    case "CVE":
      return `${symbol}.V`;
    case "LON":
      return `${symbol}.L`;
    case "FRA":
      return `${symbol}.F`;
    case "TYO":
      return `${symbol}.T`;
    default:
      return symbol;
  }
}
async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
function buildYahooResult(ticker, yahooTicker, price, previousClose, currency, error) {
  return {
    price: typeof price === "number" ? price : null,
    previousClose: typeof previousClose === "number" ? previousClose : null,
    yahooTicker,
    currency: typeof currency === "string" ? currency : null,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(yahooTicker)}`,
    error
  };
}
function readServerYahooCache(yahooTicker) {
  return serverYahooCache.get(yahooTicker) ?? null;
}
function writeServerYahooCache(yahooTicker, price, previousClose, currency) {
  serverYahooCache.set(yahooTicker, {
    price,
    previousClose,
    currency,
    savedAt: Date.now()
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
async function fetchYahooFinancePrice(ticker) {
  const yahooTicker = getYahooTicker(ticker);
  const cachedResult = readServerYahooCache(yahooTicker);
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooTicker
  )}`;
  if (isServerYahooCooldownActive() && cachedResult) {
    return buildYahooResult(
      ticker,
      yahooTicker,
      cachedResult.price,
      cachedResult.previousClose,
      cachedResult.currency,
      "Yahoo is temporarily rate-limiting requests. Using the last known server-side Yahoo price for now."
    );
  }
  try {
    const yahooResponse = await fetch(yahooUrl, { headers: YAHOO_HEADERS });
    const yahooData = await safeJson(yahooResponse);
    const result = yahooData?.chart?.result?.[0];
    const meta = result?.meta;
    const chartPrice = meta?.regularMarketPrice;
    const chartPreviousClose = meta?.previousClose ?? meta?.chartPreviousClose ?? meta?.regularMarketPreviousClose;
    const chartCurrency = meta?.currency;
    if (yahooResponse.ok && typeof chartPrice === "number") {
      clearServerYahooCooldown();
      writeServerYahooCache(
        yahooTicker,
        chartPrice,
        typeof chartPreviousClose === "number" ? chartPreviousClose : null,
        typeof chartCurrency === "string" ? chartCurrency : null
      );
      return buildYahooResult(
        ticker,
        yahooTicker,
        chartPrice,
        chartPreviousClose,
        chartCurrency,
        null
      );
    }
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      yahooTicker
    )}`;
    const quoteResponse = await fetch(quoteUrl, { headers: YAHOO_HEADERS });
    const quoteData = await safeJson(quoteResponse);
    const quote = quoteData?.quoteResponse?.result?.[0];
    const quotePrice = quote?.regularMarketPrice;
    const quotePreviousClose = quote?.regularMarketPreviousClose ?? quote?.previousClose ?? quote?.chartPreviousClose;
    const quoteCurrency = quote?.currency;
    if (quoteResponse.ok && typeof quotePrice === "number") {
      clearServerYahooCooldown();
      writeServerYahooCache(
        yahooTicker,
        quotePrice,
        typeof quotePreviousClose === "number" ? quotePreviousClose : null,
        typeof quoteCurrency === "string" ? quoteCurrency : null
      );
      return buildYahooResult(
        ticker,
        yahooTicker,
        quotePrice,
        quotePreviousClose,
        quoteCurrency,
        null
      );
    }
    const statusMessage = [yahooResponse.status, quoteResponse.status].filter((status) => typeof status === "number" && status > 0).join("/");
    const isRateLimited = yahooResponse.status === 429 || quoteResponse.status === 429;
    if (isRateLimited) {
      setServerYahooCooldown();
      if (cachedResult) {
        return buildYahooResult(
          ticker,
          yahooTicker,
          cachedResult.price,
          cachedResult.previousClose,
          cachedResult.currency,
          "Yahoo is temporarily rate-limiting requests. Using the last known server-side Yahoo price for now."
        );
      }
    }
    return buildYahooResult(
      ticker,
      yahooTicker,
      null,
      chartPreviousClose ?? quotePreviousClose,
      chartCurrency ?? quoteCurrency,
      statusMessage ? `Yahoo lookup failed (${statusMessage}) for ${yahooTicker}. Try another provider or a different ticker format.` : `Price not found for ticker: ${ticker} (Yahoo: ${yahooTicker})`
    );
  } catch {
    if (cachedResult) {
      setServerYahooCooldown();
      return buildYahooResult(
        ticker,
        yahooTicker,
        cachedResult.price,
        cachedResult.previousClose,
        cachedResult.currency,
        "Yahoo is temporarily unavailable. Using the last known server-side Yahoo price for now."
      );
    }
    return buildYahooResult(
      ticker,
      yahooTicker,
      null,
      null,
      null,
      `Yahoo lookup failed for ${yahooTicker}. Try another provider or a different ticker format.`
    );
  }
}
var YAHOO_HEADERS, SERVER_YAHOO_COOLDOWN_MS, serverYahooCache, serverYahooCooldownUntil;
var init_financeServer = __esm({
  "src/lib/financeServer.ts"() {
    YAHOO_HEADERS = {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    };
    SERVER_YAHOO_COOLDOWN_MS = 5 * 60 * 1e3;
    serverYahooCache = /* @__PURE__ */ new Map();
    serverYahooCooldownUntil = 0;
  }
});

// vite.config.js
var vite_config_exports = {};
__export(vite_config_exports, {
  default: () => vite_config_default
});
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
var rootDir, vite_config_default;
var init_vite_config = __esm({
  "vite.config.js"() {
    init_financeServer();
    rootDir = process.cwd();
    vite_config_default = defineConfig(() => {
      return {
        envPrefix: ["VITE_", "NEXT_PUBLIC_"],
        plugins: [
          react(),
          tailwindcss(),
          {
            name: "local-finance-api",
            configureServer(server) {
              server.middlewares.use("/api/health", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ status: "ok" }));
              });
              server.middlewares.use("/api/finance", async (req, res) => {
                const requestUrl = new URL(req.url || "", "http://localhost");
                const ticker = requestUrl.searchParams.get("ticker");
                if (!ticker) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ error: "Ticker is required" }));
                  return;
                }
                try {
                  const result = await fetchYahooFinancePrice(ticker);
                  if (result.price == null) {
                    res.statusCode = 404;
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify({
                      error: result.error,
                      previousClose: result.previousClose,
                      currency: result.currency,
                      sourceUrl: result.sourceUrl,
                      normalizedTicker: result.yahooTicker
                    }));
                    return;
                  }
                  res.statusCode = 200;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({
                    price: result.price,
                    previousClose: result.previousClose,
                    currency: result.currency,
                    sourceUrl: result.sourceUrl,
                    normalizedTicker: result.yahooTicker
                  }));
                } catch (error) {
                  res.statusCode = 500;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to fetch data" }));
                }
              });
            }
          },
          VitePWA({
            registerType: "autoUpdate",
            devOptions: {
              enabled: false
            },
            manifest: {
              name: "Nexus Portfolio",
              short_name: "Nexus",
              description: "A private, multi-currency global wealth tracker.",
              theme_color: "#ffffff",
              icons: [
                {
                  src: "pwa-192x192.png",
                  sizes: "192x192",
                  type: "image/png"
                },
                {
                  src: "pwa-512x512.png",
                  sizes: "512x512",
                  type: "image/png"
                }
              ]
            }
          })
        ],
        resolve: {
          alias: {
            "@": rootDir
          }
        },
        server: {
          hmr: process.env.DISABLE_HMR !== "true"
        }
      };
    });
  }
});

// server.ts
init_financeServer();
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "node:path";
async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 7777;
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/finance", async (req, res) => {
    const ticker = req.query.ticker;
    if (!ticker) {
      return res.status(400).json({ error: "Ticker is required" });
    }
    try {
      const result = await fetchYahooFinancePrice(ticker);
      if (result.price !== null) {
        res.json({
          price: result.price,
          previousClose: result.previousClose,
          currency: result.currency,
          sourceUrl: result.sourceUrl,
          normalizedTicker: result.yahooTicker
        });
      } else {
        res.status(404).json({
          error: result.error,
          previousClose: result.previousClose,
          currency: result.currency,
          sourceUrl: result.sourceUrl,
          normalizedTicker: result.yahooTicker
        });
      }
    } catch (error) {
      console.error("Error fetching finance data from Yahoo:", error);
      res.status(500).json({ error: "Failed to fetch data" });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const viteConfig = (await Promise.resolve().then(() => (init_vite_config(), vite_config_exports))).default;
    const configObj = typeof viteConfig === "function" ? await viteConfig({ command: "serve", mode: "development" }) : viteConfig;
    const vite = await createViteServer({
      ...configObj,
      server: { ...configObj.server, middlewareMode: true },
      appType: "spa",
      configFile: false
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
startServer();
