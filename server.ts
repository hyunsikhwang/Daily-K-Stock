import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import path from "path";
import dotenv from "dotenv";
import { getKRXVolatilityHistoryPoints, syncKRXDate, getTradingDays } from "./src/krxVolatilityService.js";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Proxy for Naver Finance API (CORS issue in browser)
  app.get("/api/stock/naver", async (req, res) => {
    const { koreaIndexType, thistime } = req.query;
    try {
      const response = await axios.get("https://stock.naver.com/api/domestic/indexSise/time", {
        params: {
          koreaIndexType,
          thistime,
          startIdx: 0,
          pageSize: 500,
        },
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching Naver data:", error);
      res.status(500).json({ error: "Failed to fetch Naver data" });
    }
  });

  // Proxy for Naver stock list (Treemap data)
  app.get("/api/stock/market", async (req, res) => {
    try {
      const response = await axios.get("https://stock.naver.com/api/domestic/market/stock/default", {
        params: {
          tradeType: "KRX",
          marketType: "ALL",
          orderType: "priceTop",
          startIdx: 0,
          pageSize: 10000,
        },
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching Naver market list:", error);
      res.status(500).json({ error: "Failed to fetch Naver market list" });
    }
  });

  // Dedicated 1-Year Index History Route (KOSPI, KOSDAQ, NIGHT, VOLATILITY)
  app.get("/api/stock/index/history", async (req, res) => {
    const type = String(req.query.type || "VOLATILITY").toUpperCase();
    try {
      if (type === "VOLATILITY") {
        const authKey = process.env.KRX_AUTH_KEY;
        if (authKey && authKey !== "YOUR_KRX_API_KEY") {
          const recentDays = getTradingDays(3);
          for (const dateStr of recentDays) {
            await syncKRXDate(dateStr, authKey);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
        const history = getKRXVolatilityHistoryPoints();
        return res.json(history);
      }

      // Handle KOSPI, KOSDAQ, and NIGHT via Yahoo Finance API with calculation
      let sym = "^KS11";
      if (type === "KOSDAQ") sym = "^KQ11";

      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1y&interval=1d`;
      const response = await axios.get(yahooUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: 10000
      });

      const result = response.data?.chart?.result?.[0];
      const timestamps: number[] = result?.timestamp || [];
      const quotes: (number | null)[] = result?.indicators?.quote?.[0]?.close || [];

      const points: any[] = [];
      const rawValues: number[] = [];

      // Night futures ratio relative to KOSPI baseline (approx ~995.40 / 6258.77)
      const scaleFactor = type === "NIGHT" ? (995.40 / 6258.77) : 1.0;

      for (let i = 0; i < timestamps.length; i++) {
        const rawVal = quotes[i];
        if (rawVal !== null && rawVal !== undefined && !isNaN(rawVal)) {
          const val = Math.round((rawVal * scaleFactor) * 100) / 100;
          rawValues.push(val);

          const d = new Date(timestamps[i] * 1000);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const dateStr = `${yyyy}-${mm}-${dd}`;
          const displayDate = `${String(yyyy).slice(2)}.${mm}.${dd}`;

          const prevVal = rawValues.length > 1 ? rawValues[rawValues.length - 2] : val;
          const change = Math.round((val - prevVal) * 100) / 100;
          const changeRate = prevVal > 0 ? Math.round((change / prevVal) * 10000) / 100 : 0;

          const maStart = Math.max(0, rawValues.length - 20);
          const maSlice = rawValues.slice(maStart);
          const ma20 = Math.round((maSlice.reduce((a, b) => a + b, 0) / maSlice.length) * 100) / 100;

          points.push({
            date: dateStr,
            displayDate,
            value: val,
            change,
            changeRate,
            ma20
          });
        }
      }

      if (points.length > 0) {
        return res.json(points);
      }
      res.status(500).json({ error: "No historical data returned" });
    } catch (error: any) {
      console.error(`Error generating ${type} index history:`, error.message);
      res.status(500).json({ error: `Failed to fetch ${type} index history` });
    }
  });

  // Dedicated 1-Year KRX Volatility Index History Route (legacy compatibility)
  app.get("/api/stock/krx/volatility/history", async (req, res) => {
    try {
      const authKey = process.env.KRX_AUTH_KEY;
      if (authKey && authKey !== "YOUR_KRX_API_KEY") {
        const recentDays = getTradingDays(3);
        for (const dateStr of recentDays) {
          await syncKRXDate(dateStr, authKey);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      const history = getKRXVolatilityHistoryPoints();
      res.json(history);
    } catch (error: any) {
      console.error("Error generating KRX volatility history:", error.message);
      res.status(500).json({ error: "Failed to fetch KRX volatility history" });
    }
  });

  // Proxy for KRX API
  app.get("/api/stock/krx/:type", async (req, res) => {
    const { type } = req.params; // 'futures' or 'volatility'
    const { basDd } = req.query;
    const authKey = process.env.KRX_AUTH_KEY;

    if (!authKey || authKey === "YOUR_KRX_API_KEY") {
      return res.status(500).json({ 
        error: "KRX_AUTH_KEY not configured. Please add it to your environment secrets." 
      });
    }

    const urls: Record<string, string> = {
      futures: "https://data-dbg.krx.co.kr/svc/apis/drv/fut_bydd_trd.json",
      volatility: "https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd",
    };

    const url = urls[type];
    if (!url) return res.status(400).json({ error: "Invalid KRX API type" });

    try {
      const response = await axios.get(url, {
        params: {
          AUTH_KEY: authKey,
          basDd,
        },
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "application/json,text/plain,*/*",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          "Referer": "https://data-dbg.krx.co.kr/",
        },
        timeout: 20000,
      });
      res.json(response.data);
    } catch (error: any) {
      console.error(`Error fetching KRX ${type} data for date ${basDd}:`, error.message);
      const status = error.response?.status || 500;
      const data = error.response?.data || { error: `Failed to fetch KRX ${type} data` };
      res.status(status).json(data);
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
