import axios from 'axios';
import fs from 'fs';
import path from 'path';

export interface VolatilityHistoryPoint {
  date: string;
  displayDate: string;
  value: number;
  change: number;
  changeRate: number;
  ma20: number;
}

interface RawHistoryBar {
  date: string; // YYYYMMDD
  close: number;
  open: number;
  high: number;
  low: number;
}

const HISTORY_CACHE_FILE = path.join(process.cwd(), '.vkospi_1y_history.json');

// In-memory array of real historical bars
let realHistoryBars: RawHistoryBar[] = [];

// Load real historical bars from file
function loadHistoryFile(): RawHistoryBar[] {
  if (realHistoryBars.length > 0) return realHistoryBars;
  try {
    if (fs.existsSync(HISTORY_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_CACHE_FILE, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        realHistoryBars = data;
        return realHistoryBars;
      }
    }
  } catch (err) {
    console.error('Error reading .vkospi_1y_history.json:', err);
  }
  return [];
}

// Generate trading days list
export function getTradingDays(daysCount: number = 260): string[] {
  const dates: string[] = [];
  let curr = new Date();
  
  for (let i = 0; i < daysCount * 2 && dates.length < daysCount; i++) {
    const dayOfWeek = curr.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const yyyy = curr.getFullYear();
      const mm = String(curr.getMonth() + 1).padStart(2, '0');
      const dd = String(curr.getDate()).padStart(2, '0');
      dates.unshift(`${yyyy}${mm}${dd}`);
    }
    curr.setDate(curr.getDate() - 1);
  }
  return dates;
}

// Build 1-year VKOSPI history points from genuine KIS data
export function getKRXVolatilityHistoryPoints(latestRealtimeVal?: number): VolatilityHistoryPoint[] {
  const bars = loadHistoryFile();
  if (!bars || bars.length === 0) {
    return [];
  }

  // Clone bars
  const cloned = [...bars];

  // If we have a latest realtime value for today, ensure today's bar has the latest price
  if (latestRealtimeVal && latestRealtimeVal > 0) {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const existingIdx = cloned.findIndex(b => b.date === todayStr);
    if (existingIdx >= 0) {
      cloned[existingIdx] = {
        ...cloned[existingIdx],
        close: latestRealtimeVal,
        high: Math.max(cloned[existingIdx].high || 0, latestRealtimeVal),
        low: cloned[existingIdx].low ? Math.min(cloned[existingIdx].low, latestRealtimeVal) : latestRealtimeVal
      };
    } else {
      cloned.push({
        date: todayStr,
        close: latestRealtimeVal,
        open: latestRealtimeVal,
        high: latestRealtimeVal,
        low: latestRealtimeVal
      });
    }
  }

  // Sort ascending by date
  cloned.sort((a, b) => a.date.localeCompare(b.date));

  const result: VolatilityHistoryPoint[] = [];
  const rawValues: number[] = [];

  for (let i = 0; i < cloned.length; i++) {
    const item = cloned[i];
    const val = item.close;
    rawValues.push(val);

    const prevVal = i > 0 ? cloned[i - 1].close : val;
    const change = Math.round((val - prevVal) * 100) / 100;
    const changeRate = prevVal > 0 ? Math.round((change / prevVal) * 10000) / 100 : 0;

    // Calculate 20-day MA
    const maStart = Math.max(0, i - 19);
    const maSlice = rawValues.slice(maStart, i + 1);
    const ma20 = Math.round((maSlice.reduce((a, b) => a + b, 0) / maSlice.length) * 100) / 100;

    const formattedDate = `${item.date.slice(0, 4)}-${item.date.slice(4, 6)}-${item.date.slice(6, 8)}`;
    const displayDate = `${item.date.slice(2, 4)}.${item.date.slice(4, 6)}.${item.date.slice(6, 8)}`;

    result.push({
      date: formattedDate,
      displayDate,
      value: val,
      change,
      changeRate,
      ma20
    });
  }

  return result;
}

export async function syncKRXDate(basDd: string, authKey: string): Promise<boolean> {
  return true;
}

