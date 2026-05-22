import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import path from "path";
import dotenv from "dotenv";

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
