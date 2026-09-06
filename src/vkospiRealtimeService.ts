import axios from 'axios';
import fs from 'fs';
import path from 'path';

export interface VkospiRealtimeQuote {
  last: number;
  change: number;
  changePct: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  exchange: string;
  marketStatus: string;
  lastTime: string;
  name: string;
  symbol: string;
  source: 'KIS' | 'CNBC' | 'KRX' | 'FALLBACK';
  fetchedAt: string;
  isRealtime: boolean;
}

const TOKEN_CACHE_FILE = path.join(process.cwd(), '.kis_token_cache.json');
let inMemoryTokenCache: {
  app_key?: string;
  access_token?: string;
  expires_at?: string;
  last_token_request_at?: string;
} | null = null;

function loadTokenCache(): typeof inMemoryTokenCache {
  if (inMemoryTokenCache) return inMemoryTokenCache;
  try {
    if (fs.existsSync(TOKEN_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf-8'));
      inMemoryTokenCache = data;
      return inMemoryTokenCache;
    }
  } catch (err) {
    // Ignore cache load error
  }
  return null;
}

function saveTokenCache(data: any) {
  inMemoryTokenCache = data;
  try {
    fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    // Ignore write error in sandboxed environment
  }
}

function getCachedToken(appKey: string): string | null {
  const cache = loadTokenCache();
  if (!cache || cache.app_key !== appKey || !cache.access_token) return null;
  if (!cache.expires_at) return cache.access_token;

  try {
    const exp = new Date(cache.expires_at).getTime();
    const now = Date.now();
    // Valid if more than 2 minutes remain
    if (exp - now > 2 * 60 * 1000) {
      return cache.access_token;
    }
  } catch (e) {
    return cache.access_token;
  }
  return null;
}

function toFloat(val: any): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val).replace(/,/g, '').replace(/%/g, '').trim();
  if (!s || s.toUpperCase() === 'N/A' || s === '-' || s.toUpperCase() === 'NULL') return null;
  const f = parseFloat(s);
  return isNaN(f) ? null : f;
}

export async function fetchFromKIS(): Promise<VkospiRealtimeQuote> {
  const appKey = process.env.KIS_APP_KEY || "PScWMhmwS0TZMHXUr3RUZWtFANIKqmQCvViN";
  const appSecret = process.env.KIS_APP_SECRET || "fCtbnM5MN/iR/8sFgkx1rnpt888mDHhVzgnyccLzl/mqyN+opXLKwyDhIdNT7JO+pYWrmwgjxEvzRlGzKu7RQzrZDHu8zbdkrXmSSTCV3joU1P6W1iLWjuyWzUkTopleVYMOUfMMePcOcmLQcQKT6gQaABG02CtTuTlLF/XbB5FyD4hg1Sk=";
  const baseUrl = (process.env.KIS_BASE_URL || "https://openapi.koreainvestment.com:9443").replace(/\/$/, "");
  const vkospiCode = process.env.KIS_VKOSPI_CODE || "0503";

  if (!appKey || !appSecret || appKey.includes("발급받은")) {
    throw new Error("KIS API credentials not configured");
  }

  let token = getCachedToken(appKey);
  if (!token) {
    // Request new token
    const tokenRes = await axios.post(`${baseUrl}/oauth2/tokenP`, {
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret
    }, {
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      timeout: 10000
    });

    token = tokenRes.data?.access_token;
    if (!token) {
      throw new Error("Failed to obtain KIS access token");
    }

    const expStr = tokenRes.data?.access_token_token_expired;
    let expiresAt: string;
    if (expStr) {
      expiresAt = expStr.includes("T") ? expStr : expStr.replace(" ", "T");
    } else {
      expiresAt = new Date(Date.now() + 23 * 3600 * 1000).toISOString();
    }

    saveTokenCache({
      app_key: appKey,
      access_token: token,
      expires_at: expiresAt,
      last_token_request_at: new Date().toISOString()
    });
  }

  // Request inquire-index-price
  const priceRes = await axios.get(`${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-index-price`, {
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "authorization": `Bearer ${token}`,
      "appkey": appKey,
      "appsecret": appSecret,
      "tr_id": "FHPUP02100000",
      "custtype": "P"
    },
    params: {
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: vkospiCode
    },
    timeout: 10000
  });

  const payload = priceRes.data;
  if (String(payload?.rt_cd) !== "0") {
    throw new Error(`KIS API returned rt_cd=${payload?.rt_cd}: ${payload?.msg1 || 'Unknown error'}`);
  }

  const out = Array.isArray(payload.output) ? payload.output[0] : payload.output;
  if (!out) {
    throw new Error("KIS API output is empty");
  }

  const last = toFloat(out.bstp_nmix_prpr);
  if (last === null) {
    throw new Error("Failed to parse KIS last price");
  }

  let change = toFloat(out.bstp_nmix_prdy_vrss) || 0;
  let changePct = toFloat(out.bstp_nmix_prdy_ctrt) || 0;
  const sign = String(out.prdy_vrss_sign || "");
  if (["4", "5"].includes(sign) && change > 0) {
    change = -Math.abs(change);
    changePct = -Math.abs(changePct);
  } else if (["1", "2"].includes(sign) && change < 0) {
    change = Math.abs(change);
    changePct = Math.abs(changePct);
  }

  const open = toFloat(out.bstp_nmix_oprc);
  const high = toFloat(out.bstp_nmix_hgpr);
  const low = toFloat(out.bstp_nmix_lwpr);
  const previousClose = last !== null ? Math.round((last - change) * 100) / 100 : null;
  const yearHigh = toFloat(out.dryy_bstp_nmix_hgpr);
  const yearLow = toFloat(out.dryy_bstp_nmix_lwpr);

  return {
    last,
    change,
    changePct,
    open,
    high,
    low,
    previousClose,
    yearHigh,
    yearLow,
    exchange: "한국거래소 (한국투자증권 Open API)",
    marketStatus: "REG_MKT",
    lastTime: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
    name: "VKOSPI (코스피200 변동성지수)",
    symbol: `U/${vkospiCode}`,
    source: "KIS",
    fetchedAt: new Date().toISOString(),
    isRealtime: true
  };
}

export async function fetchFromCNBC(): Promise<VkospiRealtimeQuote> {
  const url = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=.KSVKOSPI&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1";
  const res = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "application/json,text/plain,*/*"
    },
    timeout: 10000
  });

  const payload = res.data;
  const quotes = payload?.FormattedQuoteResult?.FormattedQuote || payload?.QuickQuoteResult?.QuickQuote || [];
  if (!quotes || quotes.length === 0) {
    throw new Error("CNBC quote data is empty");
  }

  const q = quotes[0];
  const last = toFloat(q.last || q.price);
  if (last === null) {
    throw new Error("Failed to parse CNBC last price");
  }

  const change = toFloat(q.change) || 0;
  const changePct = toFloat(q.change_pct || q.change_percent) || 0;
  const open = toFloat(q.open);
  const high = toFloat(q.high);
  const low = toFloat(q.low);
  const previousClose = toFloat(q.previous_day_closing || q.previous_close) || (last - change);
  const yearHigh = toFloat(q.yrhiprice);
  const yearLow = toFloat(q.yrloprice);

  let formattedTime = q.last_timedate || q.last_time || "";
  if (q.last_time && q.last_time.includes("T")) {
    try {
      const d = new Date(q.last_time);
      formattedTime = d.toLocaleTimeString('ko-KR', { hour12: false });
    } catch {
      // keep formattedTime
    }
  }

  return {
    last,
    change,
    changePct,
    open,
    high,
    low,
    previousClose,
    yearHigh,
    yearLow,
    exchange: String(q.exchange || "Korea Stock Exchange (CNBC)"),
    marketStatus: String(q.curmktstatus || "REG_MKT"),
    lastTime: formattedTime || new Date().toLocaleTimeString('ko-KR', { hour12: false }),
    name: "VKOSPI (코스피200 변동성지수)",
    symbol: String(q.symbol || ".KSVKOSPI"),
    source: "CNBC",
    fetchedAt: new Date().toISOString(),
    isRealtime: true
  };
}

let lastSuccessfulQuote: VkospiRealtimeQuote | null = null;
let lastFetchTime = 0;

export async function getVKOSPIRealtime(forceRefresh = false): Promise<VkospiRealtimeQuote> {
  const now = Date.now();
  // Cache for 3 seconds to avoid hammering upstream on simultaneous requests
  if (!forceRefresh && lastSuccessfulQuote && (now - lastFetchTime < 3000)) {
    return lastSuccessfulQuote;
  }

  const errors: string[] = [];

  // 1. Try KIS Open API first
  try {
    const kisQuote = await fetchFromKIS();
    lastSuccessfulQuote = kisQuote;
    lastFetchTime = now;
    return kisQuote;
  } catch (err: any) {
    errors.push(`KIS: ${err.message}`);
  }

  // 2. Try CNBC Quote API fallback
  try {
    const cnbcQuote = await fetchFromCNBC();
    lastSuccessfulQuote = cnbcQuote;
    lastFetchTime = now;
    return cnbcQuote;
  } catch (err: any) {
    errors.push(`CNBC: ${err.message}`);
  }

  // 3. Return last cached quote if available
  if (lastSuccessfulQuote) {
    return {
      ...lastSuccessfulQuote,
      fetchedAt: new Date().toISOString()
    };
  }

  throw new Error(`Failed to fetch real-time VKOSPI from all sources: ${errors.join("; ")}`);
}
