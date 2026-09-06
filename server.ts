import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import path from "path";
import dotenv from "dotenv";
import { getKRXVolatilityHistoryPoints, syncKRXDate, getTradingDays } from "./src/krxVolatilityService.js";
import { getVKOSPIRealtime } from "./src/vkospiRealtimeService.js";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Realtime VKOSPI (Korea Investment Open API + CNBC Quote Fallback)
  app.get("/api/stock/vkospi/realtime", async (req, res) => {
    try {
      const quote = await getVKOSPIRealtime(req.query.refresh === "true");
      res.json(quote);
    } catch (error: any) {
      console.error("Error fetching real-time VKOSPI:", error.message);
      res.status(500).json({ error: "Failed to fetch real-time VKOSPI", details: error.message });
    }
  });

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
        let latestRealtimeVal: number | undefined;
        try {
          const rt = await getVKOSPIRealtime();
          if (rt && rt.last > 0) {
            latestRealtimeVal = rt.last;
          }
        } catch (e) {
          // ignore
        }
        const history = getKRXVolatilityHistoryPoints(latestRealtimeVal);
        return res.json(history);
      }

      // Handle KOSPI, KOSDAQ via high-accuracy Naver Finance Daily Chart API
      let naverSymbol = "KOSPI";
      if (type === "KOSDAQ") naverSymbol = "KOSDAQ";

      const naverUrl = `https://fchart.stock.naver.com/sise.nhn?symbol=${naverSymbol}&timeframe=day&count=260&requestType=0`;
      const response = await axios.get(naverUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        },
        timeout: 10000
      });

      const rawXml = String(response.data || "");
      const matches = [...rawXml.matchAll(/<item data="([^"]+)"/g)];

      if (!matches || matches.length === 0) {
        throw new Error(`Failed to parse Naver chart XML for ${naverSymbol}`);
      }

      const points: any[] = [];
      const rawValues: number[] = [];

      for (let i = 0; i < matches.length; i++) {
        const parts = matches[i][1].split("|");
        const dateStr = parts[0]; // YYYYMMDD
        const close = parseFloat(parts[4]);

        if (!isNaN(close) && close > 0) {
          rawValues.push(close);

          const yyyy = dateStr.slice(0, 4);
          const mm = dateStr.slice(4, 6);
          const dd = dateStr.slice(6, 8);
          const formattedDate = `${yyyy}-${mm}-${dd}`;
          const displayDate = `${yyyy.slice(2)}.${mm}.${dd}`;

          const prevVal = rawValues.length > 1 ? rawValues[rawValues.length - 2] : close;
          const change = Math.round((close - prevVal) * 100) / 100;
          const changeRate = prevVal > 0 ? Math.round((change / prevVal) * 10000) / 100 : 0;

          const maStart = Math.max(0, rawValues.length - 20);
          const maSlice = rawValues.slice(maStart);
          const ma20 = Math.round((maSlice.reduce((a, b) => a + b, 0) / maSlice.length) * 100) / 100;

          points.push({
            date: formattedDate,
            displayDate,
            value: close,
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
      let latestRealtimeVal: number | undefined;
      try {
        const rt = await getVKOSPIRealtime();
        if (rt && rt.last > 0) {
          latestRealtimeVal = rt.last;
        }
      } catch (e) {
        // ignore
      }
      const history = getKRXVolatilityHistoryPoints(latestRealtimeVal);
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

    if (type === 'volatility' && (!authKey || authKey === "YOUR_KRX_API_KEY")) {
      try {
        const realtime = await getVKOSPIRealtime();
        const dateStr = String(basDd || new Date().toISOString().slice(0, 10).replace(/-/g, ''));
        return res.json({
          OutBlock_1: [
            {
              BAS_DD: dateStr,
              IDX_NM: "코스피 200 변동성지수",
              CLSPRC_IDX: String(realtime.last),
              CMPPREVDD_IDX: String(realtime.change),
              FLUC_RT: String(realtime.changePct),
              OPNPRC_IDX: String(realtime.open ?? realtime.last),
              HGPRC_IDX: String(realtime.high ?? realtime.last),
              LWPRC_IDX: String(realtime.low ?? realtime.last),
              SOURCE: realtime.source,
            }
          ],
          realtime
        });
      } catch (realtimeErr: any) {
        console.warn("Realtime fallback failed in /api/stock/krx/volatility:", realtimeErr.message);
      }
    }

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
