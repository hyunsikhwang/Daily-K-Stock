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
