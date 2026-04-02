import express from "express";
import { createServer as createViteServer, loadEnv } from "vite";
import path from "node:path";
import { fetchAutoMatchedPrice } from "./src/lib/financeServer";

async function startServer() {
  const env = loadEnv(process.env.NODE_ENV || "development", process.cwd(), "");
  if (env.MASSIVE_API_KEY && !process.env.MASSIVE_API_KEY) {
    process.env.MASSIVE_API_KEY = env.MASSIVE_API_KEY;
  }

  const app = express();
  const PORT = Number(process.env.PORT || env.PORT || 3000);

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/finance", async (req, res) => {
    const ticker = req.query.ticker as string;
    if (!ticker) {
      return res.status(400).json({ error: "Ticker is required" });
    }

    try {
      const result = await fetchAutoMatchedPrice({
        ticker,
        name: req.query.name as string | undefined,
        assetClass: req.query.assetClass as string | undefined,
        country: req.query.country as string | undefined,
      });

      if (result.price !== null) {
        res.json({
          price: result.price,
          previousClose: result.previousClose,
          currency: result.currency,
          sourceUrl: result.sourceUrl,
          normalizedTicker: 'provider' in result ? result.normalizedTicker : result.yahooTicker,
          provider: 'provider' in result ? result.provider : 'yahoo',
        });
      } else {
        res.status(404).json({
          error: result.error,
          previousClose: result.previousClose,
          currency: result.currency,
          sourceUrl: result.sourceUrl,
          normalizedTicker: 'provider' in result ? result.normalizedTicker : result.yahooTicker,
          provider: 'provider' in result ? result.provider : 'yahoo',
        });
      }
    } catch (error) {
      console.error("Error fetching finance data from Yahoo:", error);
      res.status(500).json({ error: "Failed to fetch data" });
    }
  });

  app.get("/api/finance-auto", async (req, res) => {
    const ticker = req.query.ticker as string;
    if (!ticker) {
      return res.status(400).json({ error: "Ticker is required" });
    }

    try {
      const result = await fetchAutoMatchedPrice({
        ticker,
        name: req.query.name as string | undefined,
        assetClass: req.query.assetClass as string | undefined,
        country: req.query.country as string | undefined,
      });

      if (result.price !== null) {
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error) {
      console.error("Error fetching auto-matched finance data:", error);
      res.status(500).json({ error: "Failed to fetch data" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
