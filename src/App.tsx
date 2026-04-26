import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TrendingUp, TrendingDown, Clock, Calendar, RefreshCw, ChevronUp, ChevronDown, Minus } from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot, Legend
} from 'recharts';
import { format, isSaturday, isSunday, addDays, subDays, setHours, setMinutes, setSeconds, isBefore, isAfter, differenceInSeconds } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

import { 
  fetchNaverIndexData, fetchKRXData, getKSTDateStr, StockData, KRXRow 
} from './stockService';
import { cn, formatNumber, cleanValue, KOREAN_HOLIDAYS } from './lib/utils';

const KST_TZ = 'Asia/Seoul';
const KRX_OPEN = { hour: 9, minute: 0 };
const KRX_CLOSE = { hour: 15, minute: 30 };

// --- Components ---

const MetricCard = ({ label, value, changeVal, changeRate, extraInfo, maxInfo, minInfo }: any) => {
  const isUp = parseFloat(String(changeVal).replace(/,/g, '')) > 0;
  const isDown = parseFloat(String(changeVal).replace(/,/g, '')) < 0;
  const color = isUp ? 'text-emerald-600' : isDown ? 'text-rose-600' : 'text-gray-500';
  const Icon = isUp ? ChevronUp : isDown ? ChevronDown : Minus;

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-full flex flex-col justify-between">
      <div>
        <div className="text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wider">{label}</div>
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold text-gray-900 leading-none">{value}</div>
          <div className={cn("text-xs font-semibold flex items-center gap-0.5", color)}>
            <Icon size={12} strokeWidth={3} />
            {changeVal} {changeRate ? `(${changeRate}%)` : ''}
          </div>
        </div>
      </div>
      
      {(maxInfo || minInfo || extraInfo) && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          {extraInfo && <div className="text-[10px] text-gray-400 mb-2 truncate">{extraInfo}</div>}
          <div className="flex justify-between text-[10px]">
            {maxInfo && (
              <div className="text-gray-500">
                <span className="text-emerald-600 font-bold mr-1">HI</span>
                {formatNumber(maxInfo.val)} <span className="opacity-50">({maxInfo.time})</span>
              </div>
            )}
            {minInfo && (
              <div className="text-gray-500">
                <span className="text-rose-600 font-bold mr-1">LO</span>
                {formatNumber(minInfo.val)} <span className="opacity-50">({minInfo.time})</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const TrendCard = ({ label, direction, statusText, icon, changeValue, changeRate }: any) => {
  const isUp = direction === 'up';
  
  const bgClass = isUp 
    ? "bg-[linear-gradient(135deg,#ef4444_0%,#fb7185_100%)]" 
    : direction === 'down'
    ? "bg-[linear-gradient(135deg,#2563eb_0%,#38bdf8_100%)]" 
    : "bg-[linear-gradient(135deg,#475569_0%,#94a3b8_100%)]";

  return (
    <div className={cn(
      "relative overflow-hidden p-3 rounded-xl text-white shadow-md shadow-gray-200 isolation-auto",
      bgClass
    )}>
      {/* Shine effect animation simulated with CSS in tailwind */}
      <div className="absolute inset-0 w-1/4 h-[360%] bg-gradient-to-r from-white/0 via-white/15 to-white/0 -rotate-[18deg] -translate-x-[200%] animate-[trendShine_6.4s_linear_infinite] pointer-events-none z-0" />
      
      <div className="relative z-10">
        <div className="text-[10px] font-bold tracking-widest opacity-80 uppercase mb-1">{label}</div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-extrabold flex items-center gap-1.5">
            <span className="text-base">{icon}</span> {statusText}
          </div>
          <div className="text-xs font-bold whitespace-nowrap">
            {changeValue > 0 ? '+' : ''}{formatNumber(changeValue)} / {changeValue > 0 ? '+' : ''}{changeRate.toFixed(2)}%
          </div>
        </div>
      </div>
    </div>
  );
};

const MarketStatus = () => {
  const [now, setNow] = useState(toZonedTime(new Date(), KST_TZ));

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(toZonedTime(new Date(), KST_TZ));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const getMarketContext = () => {
    const today = now;
    const openTime = setSeconds(setMinutes(setHours(today, KRX_OPEN.hour), KRX_OPEN.minute), 0);
    const closeTime = setSeconds(setMinutes(setHours(today, KRX_CLOSE.hour), KRX_CLOSE.minute), 0);

    const isTradingDay = (date: Date) => {
      const dayStr = format(date, 'yyyy-MM-dd');
      return !isSaturday(date) && !isSunday(date) && !KOREAN_HOLIDAYS.includes(dayStr);
    };

    if (isTradingDay(today) && isAfter(today, openTime) && isBefore(today, closeTime)) {
      return {
        state: 'OPEN',
        label: '장 종료까지',
        remaining: differenceInSeconds(closeTime, today)
      };
    } else {
      let nextOpen = openTime;
      if (isAfter(today, openTime)) nextOpen = addDays(openTime, 1);
      while (!isTradingDay(nextOpen)) {
        nextOpen = addDays(nextOpen, 1);
      }
      return {
        state: 'CLOSED',
        label: '다음 장 시작까지',
        remaining: differenceInSeconds(nextOpen, today)
      };
    }
  };

  const context = getMarketContext();
  const formatHms = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sc = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sc}`;
  };

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-[10px] font-bold rounded-full">
      <span className={cn(
        "w-1.5 h-1.5 rounded-full",
        context.state === 'OPEN' ? "bg-green-500 animate-pulse" : "bg-gray-400"
      )}></span>
      {context.state} • {context.label} {formatHms(context.remaining)}
    </div>
  );
};

// --- Main App Component ---

export default function App() {
  const [kospiData, setKospiData] = useState<any[]>([]);
  const [kosdaqData, setKosdaqData] = useState<any[]>([]);
  const [naverDate, setNaverDate] = useState<string | null>(null);
  const [krxFutures, setKrxFutures] = useState<any>(null);
  const [krxVol, setKrxVol] = useState<any>(null);
  const [krxError, setKrxError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    setIsLoading(true);
    setKrxError(null);
    const seoulTime = toZonedTime(new Date(), KST_TZ);
    const dateCandidates: string[] = [];
    for (let i = 0; i < 11; i++) {
      dateCandidates.push(format(subDays(seoulTime, i), 'yyyyMMdd'));
    }

    // Naver data fetching with date fallback
    let kospi: StockData[] = [];
    let kosdaq: StockData[] = [];
    let successfulNaverDate: string | null = null;

    for (const basDd of dateCandidates) {
      const [k, q] = await Promise.all([
        fetchNaverIndexData('KOSPI', basDd),
        fetchNaverIndexData('KOSDAQ', basDd),
      ]);

      if (k.length > 0 || q.length > 0) {
        kospi = k;
        kosdaq = q;
        successfulNaverDate = basDd;
        break;
      }
    }

    setKospiData(kospi);
    setKosdaqData(kosdaq);
    setNaverDate(successfulNaverDate);
    
    // KRX data fetching with date fallback (already exists, but reusing dateCandidates)

    const extractKrxRows = (payload: any): any[] => {
      if (Array.isArray(payload)) return payload;
      if (typeof payload !== 'object' || payload === null) return [];

      const keys = ["OutBlock_1", "output", "result", "data", "list"];
      for (const key of keys) {
        if (Array.isArray(payload[key])) return payload[key];
      }

      for (const key in payload) {
        if (Array.isArray(payload[key])) return payload[key];
      }
      return [];
    };

    const normalizeText = (text: string) => (text || '').replace(/\s+/g, '');

    let futures: any[] = [];
    let vol: any[] = [];
    let successfulDate: string | null = null;

    for (const basDd of dateCandidates) {
      const [fData, vData] = await Promise.all([
        fetchKRXData('futures', basDd),
        fetchKRXData('volatility', basDd)
      ]);

      const fRows = extractKrxRows(fData);
      const vRows = extractKrxRows(vData);

      if (fRows.length > 0 || vRows.length > 0) {
        futures = fRows;
        vol = vRows;
        successfulDate = basDd;
        break;
      }
    }

    if (!successfulDate) {
      setKrxError("Failed to fetch KRX data. Please check your KRX_AUTH_KEY.");
    }

    // Futures logic: Find night futures (KOSPI 200 Night)
    if (futures.length > 0) {
      const nightFutures = futures.find((row: any) => {
        const prod = normalizeText(row.PROD_NM);
        const mkt = normalizeText(row.MKT_NM);
        
        // User specifically requested to avoid "Mini" and match "KOSPI 200 F ... (Night)"
        const isKospi200 = prod.includes('코스피200') && !prod.includes('미니');
        const isFutures = prod.includes('F') || prod.includes('선물');
        const isNight = prod.includes('야간') || mkt.includes('야간');
        
        return isKospi200 && isFutures && isNight;
      });
      setKrxFutures(nightFutures);
    }
    
    // Volatility logic
    if (vol.length > 0) {
      const vIndex = vol.find((row: any) => {
        const name = normalizeText(row.IDX_NM);
        return name.includes('변동성');
      });
      setKrxVol(vIndex);
    }

    setLastUpdate(new Date());
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // 1 minute polling
    return () => clearInterval(interval);
  }, []);

  // Process data for charts
  const chartData = useMemo(() => {
    const times = new Set([...kospiData.map(d => d.thistime), ...kosdaqData.map(d => d.thistime)]);
    const sortedTimes = Array.from(times).sort();
    
    return sortedTimes.map(time => {
      const k = kospiData.find(d => d.thistime === time);
      const q = kosdaqData.find(d => d.thistime === time);
      const timeStr = time.length >= 12 ? `${time.substring(8, 10)}:${time.substring(10, 12)}` : time;
      
      return {
        time: timeStr,
        fullTime: time,
        KOSPI: cleanValue(k?.nowVal),
        KOSDAQ: cleanValue(q?.nowVal)
      };
    });
  }, [kospiData, kosdaqData]);

  const kospiDomain = useMemo(() => {
    const vals = chartData.map(d => d.KOSPI).filter((v): v is number => v !== null);
    if (vals.length === 0) return ['auto', 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.15 || min * 0.002;
    return [min - padding, max + padding];
  }, [chartData]);

  const kosdaqDomain = useMemo(() => {
    const vals = chartData.map(d => d.KOSDAQ).filter((v): v is number => v !== null);
    if (vals.length === 0) return ['auto', 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.15 || min * 0.002;
    return [min - padding, max + padding];
  }, [chartData]);

  // Higher order stats
  const getStats = (data: any[], key: string) => {
    if (!data.length) return null;
    const values = data.map(d => cleanValue(d[key])).filter(v => v !== null) as number[];
    if (!values.length) return null;
    
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const maxItem = data.find(d => cleanValue(d[key]) === maxVal);
    const minItem = data.find(d => cleanValue(d[key]) === minVal);

    return {
      max: { val: maxVal, time: maxItem?.time },
      min: { val: minVal, time: minItem?.time }
    };
  };

  const kospiStats = getStats(chartData, 'KOSPI');
  const kosdaqStats = getStats(chartData, 'KOSDAQ');

  const latestKospi = kospiData[0];
  const latestKosdaq = kosdaqData[0];

  const calculateTrend = (data: any[], valKey: string, label: string) => {
    const validData = data.filter(d => d[valKey] !== null && d[valKey] !== undefined);
    if (validData.length < 2) return null;
    
    const recent = validData.slice(-30);
    const first = recent[0][valKey];
    const last = recent[recent.length - 1][valKey];

    const diff = last - first;
    const rate = first !== 0 ? (diff / first) * 100 : 0;
    const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const statusText = diff > 0 ? '상승 추세' : diff < 0 ? '하락 추세' : '보합권';
    const icon = diff > 0 ? '▲' : diff < 0 ? '▼' : '■';

    return { label, direction, statusText, icon, changeValue: diff, changeRate: rate };
  };

  const kospiTrend = calculateTrend(chartData, 'KOSPI', 'KOSPI');
  const kosdaqTrend = calculateTrend(chartData, 'KOSDAQ', 'KOSDAQ');

  const thirtyMinTicks = useMemo(() => {
    const ticks = [];
    for (let h = 9; h <= 15; h++) {
      ticks.push(`${String(h).padStart(2, '0')}:00`);
      if (h < 15) {
        ticks.push(`${String(h).padStart(2, '0')}:30`);
      } else if (h === 15) {
        ticks.push(`15:30`);
      }
    }
    return ticks;
  }, []);

  return (
    <div className="w-full h-screen bg-gray-50 flex overflow-hidden font-sans text-gray-900">
      
      {/* Sidebar (Streamlit Style) */}
      <aside className="w-72 bg-white border-r border-gray-200 flex flex-col hidden lg:flex">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-10">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">K</div>
            <h1 className="text-lg font-semibold tracking-tight">K-Stock Studio</h1>
          </div>
          
          <div className="space-y-8">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 block">Reporting Period</label>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 flex items-center gap-2 text-sm font-medium text-gray-700 shadow-sm">
                <Calendar size={16} className="text-gray-400" />
                {naverDate ? `${naverDate.substring(0, 4)}-${naverDate.substring(4, 6)}-${naverDate.substring(6, 8)}` : getKSTDateStr()} (KST)
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 block">Auto Refresh</label>
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <span className="text-sm font-medium text-gray-700">60s interval</span>
                <div className={cn("w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]", isLoading && "animate-pulse")} />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 block">Market Info</label>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs py-1 border-b border-gray-50">
                  <span className="text-gray-500">Venue</span>
                  <span className="font-semibold">Korea Exchange</span>
                </div>
                <div className="flex items-center justify-between text-xs py-1 border-b border-gray-50">
                  <span className="text-gray-500">Timezone</span>
                  <span className="font-semibold">GMT+9</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="mt-auto p-6 border-t border-gray-100 bg-gray-50/50">
          <button 
            onClick={() => fetchData()}
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-lg transition-all text-sm flex items-center justify-center gap-2 shadow-md shadow-blue-200 disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(isLoading && "animate-spin")} />
            Sync Real-time
          </button>
          <p className="text-[9px] font-bold text-center text-gray-400 mt-4 uppercase tracking-widest">Powered by Naver Finance & KRX</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 px-8 flex items-center justify-between shrink-0 shadow-sm z-10">
          <h2 className="text-xl font-semibold text-gray-800 tracking-tight">K-Stock Market Dashboard</h2>
          <div className="flex items-center gap-6">
            <MarketStatus />
            <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500">KS</div>
          </div>
        </header>

        {/* Content Area */}
        <div className="p-8 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
          
          {/* Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 shrink-0">
            <MetricCard 
              label="KOSPI Index"
              value={formatNumber(latestKospi?.nowVal)}
              changeVal={latestKospi?.changeVal}
              changeRate={latestKospi?.changeRate}
              maxInfo={kospiStats?.max}
              minInfo={kospiStats?.min}
            />
            <MetricCard 
              label="KOSDAQ Index"
              value={formatNumber(latestKosdaq?.nowVal)}
              changeVal={latestKosdaq?.changeVal}
              changeRate={latestKosdaq?.changeRate}
              maxInfo={kosdaqStats?.max}
              minInfo={kosdaqStats?.min}
            />
            <MetricCard 
              label="KOSPI 200 Night"
              value={formatNumber(krxFutures?.TDD_CLSPRC)}
              changeVal={formatNumber(krxFutures?.CMPPREVDD_PRC)}
              extraInfo={krxFutures ? `${krxFutures.BAS_DD} | ${krxFutures.PROD_NM}` : (krxError || 'Searching for market data...')}
            />
            <MetricCard 
              label="Volatility Index"
              value={formatNumber(krxVol?.CLSPRC_IDX)}
              changeVal={formatNumber(krxVol?.CMPPREVDD_IDX)}
              changeRate={krxVol?.FLUC_RT}
              extraInfo={krxVol ? `${krxVol.BAS_DD} | ${krxVol.IDX_NM}` : (krxError || 'Searching for market data...')}
            />
          </div>

          {/* Trend Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {kospiTrend && <TrendCard {...kospiTrend} />}
            {kosdaqTrend && <TrendCard {...kosdaqTrend} />}
          </div>

          {/* Chart Section */}
          <div className="bg-white border border-gray-200 rounded-xl p-8 flex flex-col shadow-sm">
            <div className="flex justify-between items-center mb-8">
              <h3 className="font-bold text-gray-700 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                Live Index Velocity
              </h3>
              <div className="flex gap-2">
                <div className="px-3 py-1.5 text-[10px] font-bold border rounded-md bg-white text-gray-500 shadow-xs uppercase tracking-widest">Minutely</div>
                <div className="px-3 py-1.5 text-[10px] font-bold border rounded-md bg-blue-50 text-blue-600 border-blue-200 shadow-xs uppercase tracking-widest">Real-time</div>
              </div>
            </div>
            
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={true} stroke="#cbd5e1" verticalFill={['#ffffff', '#f8fafc']} fillOpacity={0.4} />
                  <XAxis 
                    dataKey="time" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }}
                    ticks={thirtyMinTicks}
                    interval={0}
                  />
                  <YAxis 
                    yAxisId="left"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 9, fill: '#2563eb', fontWeight: 600 }}
                    domain={kospiDomain}
                    width={45}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 9, fill: '#10b981', fontWeight: 600 }}
                    domain={kosdaqDomain}
                    width={45}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', fontSize: '11px', padding: '12px' }}
                    labelStyle={{ fontWeight: 'bold', marginBottom: '8px', color: '#1e293b' }}
                    cursor={{ stroke: '#e2e8f0', strokeWidth: 2 }}
                  />
                  <Legend verticalAlign="top" align="right" iconType="circle" iconSize={6} wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingBottom: '30px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }} />
                  <Line 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="KOSPI" 
                    stroke="#2563eb" 
                    strokeWidth={2.5} 
                    dot={false} 
                    activeDot={{ r: 4, strokeWidth: 0, fill: '#2563eb' }}
                    animationDuration={1500}
                  />
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="KOSDAQ" 
                    stroke="#10b981" 
                    strokeWidth={2.5} 
                    dot={false} 
                    activeDot={{ r: 4, strokeWidth: 0, fill: '#10b981' }}
                    animationDuration={1500}
                  />
                  
                  {kospiStats && (
                    <ReferenceDot 
                      yAxisId="left" 
                      x={kospiStats.max.time} 
                      y={kospiStats.max.val} 
                      r={4} 
                      fill="#ef4444" 
                      stroke="white" 
                      strokeWidth={2}
                      label={{ value: `KOSPI High: ${formatNumber(kospiStats.max.val)} (${kospiStats.max.time})`, position: 'top', fill: '#ef4444', fontSize: 10, fontWeight: 'bold' }} 
                    />
                  )}
                  {kospiStats && (
                    <ReferenceDot 
                      yAxisId="left" 
                      x={kospiStats.min.time} 
                      y={kospiStats.min.val} 
                      r={4} 
                      fill="#2563eb" 
                      stroke="white" 
                      strokeWidth={2}
                      label={{ value: `KOSPI Low: ${formatNumber(kospiStats.min.val)} (${kospiStats.min.time})`, position: 'bottom', fill: '#2563eb', fontSize: 10, fontWeight: 'bold' }} 
                    />
                  )}
                  {kosdaqStats && (
                    <ReferenceDot 
                      yAxisId="right" 
                      x={kosdaqStats.max.time} 
                      y={kosdaqStats.max.val} 
                      r={4} 
                      fill="#10b981" 
                      stroke="white" 
                      strokeWidth={2}
                      label={{ value: `KOSDAQ High: ${formatNumber(kosdaqStats.max.val)} (${kosdaqStats.max.time})`, position: 'top', fill: '#10b981', fontSize: 10, fontWeight: 'bold' }} 
                    />
                  )}
                  {kosdaqStats && (
                    <ReferenceDot 
                      yAxisId="right" 
                      x={kosdaqStats.min.time} 
                      y={kosdaqStats.min.val} 
                      r={4} 
                      fill="#f59e0b" 
                      stroke="white" 
                      strokeWidth={2}
                      label={{ value: `KOSDAQ Low: ${formatNumber(kosdaqStats.min.val)} (${kosdaqStats.min.time})`, position: 'bottom', fill: '#f59e0b', fontSize: 10, fontWeight: 'bold' }} 
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <footer className="py-8 text-center text-[9px] text-gray-300 font-bold uppercase tracking-[0.2em] border-t border-gray-100">
            Analytical Environment v3.1.0 • Verified Protocol • System Synced
          </footer>
        </div>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes trendShine {
          0% { transform: translateX(-200%) rotate(-18deg); }
          100% { transform: translateX(400%) rotate(-18deg); }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}} />
    </div>
  );
}
