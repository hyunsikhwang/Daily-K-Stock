import axios from 'axios';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const KST_TZ = 'Asia/Seoul';

export interface StockData {
  thistime: string;
  nowVal: string;
  changeVal: string;
  changeRate: string;
}

export interface MarketStockItem {
  itemCode: string;
  stockName: string;
  closePrice: string;
  compareToPreviousClosePrice: string;
  fluctuationsRatio: string;
  marketValueAmount: string; // usually represented in '억' (100M KRW)
  sosok?: string;            // '0' or '001' is KOSPI, '1' or '002' is KOSDAQ
}

export interface KRXRow {
  PROD_NM?: string;
  MKT_NM?: string;
  ISU_NM?: string;
  BAS_DD?: string;
  TDD_CLSPRC?: string;
  CMPPREVDD_PRC?: string;
  IDX_NM?: string;
  IDX_CLSS?: string;
  CLSPRC_IDX?: string;
  CMPPREVDD_IDX?: string;
  FLUC_RT?: string;
}

export interface RealtimeVKOSPI {
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


export const fetchRealtimeVKOSPI = async (): Promise<RealtimeVKOSPI | null> => {
  try {
    const response = await axios.get('/api/stock/vkospi/realtime');
    return response.data || null;
  } catch (error) {
    console.error('Error fetching real-time VKOSPI:', error);
    return null;
  }
};

export const fetchNaverIndexData = async (indexType: 'KOSPI' | 'KOSDAQ', dateStr: string): Promise<StockData[]> => {
  try {
    const response = await axios.get('/api/stock/naver', {
      params: { koreaIndexType: indexType, thistime: dateStr }
    });
    return response.data || [];
  } catch (error) {
    console.error(`Error fetching ${indexType}:`, error);
    return [];
  }
};

export const fetchKRXData = async (type: 'futures' | 'volatility', basDd: string): Promise<any> => {
  try {
    const response = await axios.get(`/api/stock/krx/${type}`, {
      params: { basDd }
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching KRX ${type}:`, error);
    return null;
  }
};

export const getKSTDateStr = (date: Date = new Date()) => {
  const kstDate = toZonedTime(date, KST_TZ);
  return format(kstDate, 'yyyyMMdd');
};

export const getKSTTimeStr = (date: Date = new Date()) => {
  const kstDate = toZonedTime(date, KST_TZ);
  return format(kstDate, 'HH:mm:ss');
};

export const fetchNaverMarketStocks = async (): Promise<any> => {
  try {
    const response = await axios.get('/api/stock/market');
    return response.data;
  } catch (error) {
    console.error('Error fetching Naver market stock list:', error);
    return null;
  }
};

export interface VolatilityHistoryPoint {
  date: string;
  displayDate: string;
  value: number;
  change: number;
  changeRate: number;
  ma20: number;
}

export const fetchKRXVolatilityHistory = async (): Promise<VolatilityHistoryPoint[]> => {
  return fetchIndexHistory('VOLATILITY');
};

export const fetchIndexHistory = async (type: string = 'VOLATILITY'): Promise<VolatilityHistoryPoint[]> => {
  try {
    const response = await axios.get('/api/stock/index/history', {
      params: { type: type.toUpperCase() }
    });
    if (Array.isArray(response.data) && response.data.length > 0) {
      return response.data;
    }
  } catch (error) {
    console.error(`Error fetching ${type} index history:`, error);
  }
  return [];
};

export const generateIndexHistory = (type: string = 'VOLATILITY', currentVal: number = 0, refDate: Date = new Date()): VolatilityHistoryPoint[] => {
  if (type.toUpperCase() === 'VOLATILITY') {
    return generateVolatilityHistory(currentVal || 75.59, refDate);
  }

  // Baseline defaults if currentVal not provided
  let defaultVal = 6258.77;
  if (type.toUpperCase() === 'KOSDAQ') defaultVal = 798.81;

  const baseVal = currentVal > 0 ? currentVal : defaultVal;
  const points: VolatilityHistoryPoint[] = [];
  const tradingDays: Date[] = [];
  
  let curr = new Date(refDate);
  for (let i = 0; i < 365; i++) {
    const dayOfWeek = curr.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      tradingDays.unshift(new Date(curr));
    }
    curr.setDate(curr.getDate() - 1);
  }
  
  const totalDays = tradingDays.length;
  if (totalDays === 0) return [];

  const rawValues: number[] = new Array(totalDays);
  rawValues[totalDays - 1] = baseVal;

  for (let i = totalDays - 2; i >= 0; i--) {
    const nextVal = rawValues[i + 1];
    const progress = i / totalDays;
    const wave = Math.sin(i * 0.08) * (baseVal * 0.04) + Math.cos(i * 0.15) * (baseVal * 0.02);
    let prevVal = Math.round((baseVal * (0.85 + progress * 0.15) + wave) * 100) / 100;
    if (Math.abs(prevVal - nextVal) > baseVal * 0.03) {
      prevVal = Math.round((nextVal + (prevVal > nextVal ? -baseVal * 0.008 : baseVal * 0.008)) * 100) / 100;
    }
    rawValues[i] = Math.max(1.0, prevVal);
  }

  for (let i = 0; i < totalDays; i++) {
    const d = tradingDays[i];
    const val = rawValues[i];
    const prevVal = i > 0 ? rawValues[i - 1] : val;
    const change = Math.round((val - prevVal) * 100) / 100;
    const changeRate = prevVal > 0 ? Math.round((change / prevVal) * 10000) / 100 : 0;
    
    const maStart = Math.max(0, i - 19);
    const maSlice = rawValues.slice(maStart, i + 1);
    const ma20 = Math.round((maSlice.reduce((a, b) => a + b, 0) / maSlice.length) * 100) / 100;

    points.push({
      date: format(d, 'yyyy-MM-dd'),
      displayDate: format(d, 'yy.MM.dd'),
      value: val,
      change,
      changeRate,
      ma20,
    });
  }

  return points;
};

export const generateVolatilityHistory = (currentVal: number = 75.59, refDate: Date = new Date()): VolatilityHistoryPoint[] => {
  const points: VolatilityHistoryPoint[] = [];
  const tradingDays: Date[] = [];
  
  let curr = new Date(refDate);
  for (let i = 0; i < 365; i++) {
    const dayOfWeek = curr.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      tradingDays.unshift(new Date(curr));
    }
    curr.setDate(curr.getDate() - 1);
  }
  
  const totalDays = tradingDays.length;
  if (totalDays === 0) return [];

  const rawValues: number[] = new Array(totalDays);
  rawValues[totalDays - 1] = currentVal > 0 ? currentVal : 75.59;

  for (let i = totalDays - 2; i >= 0; i--) {
    const nextVal = rawValues[i + 1];
    const progress = i / totalDays;
    const baseTarget = 22.0 + progress * 50.0;
    const noise = Math.sin(i * 0.15) * 1.5;
    let prevVal = Math.round((baseTarget + noise) * 100) / 100;
    if (Math.abs(prevVal - nextVal) > 5) {
      prevVal = Math.round((nextVal + (prevVal > nextVal ? -1.8 : 1.8)) * 100) / 100;
    }
    rawValues[i] = Math.max(14.5, prevVal);
  }

  for (let i = 0; i < totalDays; i++) {
    const d = tradingDays[i];
    const val = rawValues[i];
    const prevVal = i > 0 ? rawValues[i - 1] : val;
    const change = Math.round((val - prevVal) * 100) / 100;
    const changeRate = prevVal > 0 ? Math.round((change / prevVal) * 10000) / 100 : 0;
    
    const maStart = Math.max(0, i - 19);
    const maSlice = rawValues.slice(maStart, i + 1);
    const ma20 = Math.round((maSlice.reduce((a, b) => a + b, 0) / maSlice.length) * 100) / 100;

    points.push({
      date: format(d, 'yyyy-MM-dd'),
      displayDate: format(d, 'yy.MM.dd'),
      value: val,
      change,
      changeRate,
      ma20,
    });
  }

  return points;
};

