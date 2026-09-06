import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TrendingUp, TrendingDown, Clock, Calendar, RefreshCw, ChevronUp, ChevronDown, Minus, Activity, X, Info, AlertTriangle } from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot, Legend, Treemap, ComposedChart, Area, ReferenceLine
} from 'recharts';
import { format, isSaturday, isSunday, addDays, subDays, setHours, setMinutes, setSeconds, isBefore, isAfter, differenceInSeconds } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

import { 
  fetchNaverIndexData, fetchKRXData, getKSTDateStr, StockData, KRXRow, fetchNaverMarketStocks, MarketStockItem, generateVolatilityHistory, VolatilityHistoryPoint, fetchKRXVolatilityHistory, fetchIndexHistory, generateIndexHistory, fetchRealtimeVKOSPI, RealtimeVKOSPI
} from './stockService';
import { cn, formatNumber, cleanValue, KOREAN_HOLIDAYS, TrendIntensity, getTrendIntensity } from './lib/utils';
import { computeIntraday5MinTrend } from './lib/intradayTrend';
import { IntradayTrendCard } from './components/IntradayTrendCard';

const KST_TZ = 'Asia/Seoul';
const KRX_OPEN = { hour: 9, minute: 0 };
const KRX_CLOSE = { hour: 15, minute: 30 };

// --- Helpers for Market Stocks (Treemap) ---
const extractMarketStocks = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object' || payload === null) return [];

  const keys = ["stocks", "output", "result", "data", "list"];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && Array.isArray(payload[key].stocks)) return payload[key].stocks;
  }

  for (const key in payload) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && Array.isArray(payload[key].stocks)) return payload[key].stocks;
  }
  return [];
};

const normalizeStockItem = (item: any) => {
  const code = item.itemcode || item.itemCode || item.code || item.symbol || '';
  const name = item.itemname || item.itemName || item.name || '';
  
  const cleanNum = (val: any): number => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    const cleaned = String(val).replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  const closePrice = cleanNum(item.nowPrice || item.closePrice || item.nowVal || item.price);
  
  let changeValue = cleanNum(item.prevChangePrice || item.compareToPreviousClosePrice || item.changeVal || item.change);
  let fluctuationsRatio = cleanNum(item.prevChangeRate || item.fluctuationsRatio || item.changeRate || item.rate);
  
  // Apply correct negative sign for declining stocks on Naver (upDownGb: 4 is 하한, 5 is 하락)
  const upDownGb = String(item.upDownGb || '');
  if (upDownGb === '4' || upDownGb === '5') {
    changeValue = -Math.abs(changeValue);
    fluctuationsRatio = -Math.abs(fluctuationsRatio);
  }

  let marketValueAmount = cleanNum(item.marketSum || item.marketValueAmount || item.marketCap);
  if (marketValueAmount > 100000000) {
    marketValueAmount = marketValueAmount / 100000000;
  }
  
  const sosok = String(item.sosok !== undefined ? item.sosok : (item.marketType || item.market || ''));

  return {
    code,
    name,
    closePrice,
    changeValue,
    fluctuationsRatio,
    marketValueAmount,
    sosok
  };
};

// --- Customized Treemap Component (Pure HTML5 & CSS Layout for Perfect White Font Color & Peak Speed) ---
interface TreemapItem {
  code: string;
  name: string;
  closePrice: number;
  changeValue: number;
  fluctuationsRatio: number;
  marketValueAmount: number;
  sosok: string;
  value: number;
}

interface RectLayout {
  item: TreemapItem;
  x: number;
  y: number;
  width: number;
  height: number;
}

const computeTreemap = (
  items: TreemapItem[],
  x: number,
  y: number,
  width: number,
  height: number
): RectLayout[] => {
  if (!items || items.length === 0) return [];
  const layouts: RectLayout[] = [];

  const divide = (
    subItems: TreemapItem[],
    rx: number,
    ry: number,
    rw: number,
    rh: number
  ) => {
    if (subItems.length === 0) return;
    if (subItems.length === 1) {
      layouts.push({
        item: subItems[0],
        x: rx,
        y: ry,
        width: rw,
        height: rh,
      });
      return;
    }

    // Split across the longer dimension to maintain stock block squareness
    const splitHorizontally = rw < rh;

    const totalWeight = subItems.reduce((sum, item) => sum + item.value, 0);
    let cumulative = 0;
    let splitIdx = 0;
    let minDifference = totalWeight;

    for (let i = 0; i < subItems.length - 1; i++) {
      cumulative += subItems[i].value;
      const remains = totalWeight - cumulative;
      const diff = Math.abs(cumulative - remains);
      if (diff < minDifference) {
        minDifference = diff;
        splitIdx = i;
      }
    }

    const leftItems = subItems.slice(0, splitIdx + 1);
    const rightItems = subItems.slice(splitIdx + 1);

    const leftWeight = leftItems.reduce((sum, item) => sum + item.value, 0);
    const ratio = totalWeight > 0 ? leftWeight / totalWeight : 0.5;

    if (splitHorizontally) {
      // Split vertically (y-axis)
      const h1 = rh * ratio;
      divide(leftItems, rx, ry, rw, h1);
      divide(rightItems, rx, ry + h1, rw, rh - h1);
    } else {
      // Split horizontally (x-axis)
      const w1 = rw * ratio;
      divide(leftItems, rx, ry, w1, rh);
      divide(rightItems, rx + w1, ry, rw - w1, rh);
    }
  };

  divide(items, x, y, width, height);
  return layouts;
};

const TreemapComponent = ({
  data,
  colorMode,
  hoveredStockCode,
  onHoverStock
}: {
  data: TreemapItem[];
  colorMode: 'KR' | 'US';
  hoveredStockCode: string | null;
  onHoverStock: (stock: any | null) => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 430 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({
        width: width || 600,
        height: height || 430
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const rects = useMemo(() => {
    if (!data || data.length === 0) return [];
    const sortedData = [...data].sort((a, b) => b.value - a.value);
    return computeTreemap(sortedData, 0, 0, dimensions.width, dimensions.height);
  }, [data, dimensions]);

  return (
    <div ref={containerRef} className="w-full h-full relative select-none overflow-hidden rounded-lg" style={{ minHeight: '430px' }}>
      {rects.map((rect, idx) => {
        const { item, x, y, width, height } = rect;
        const isHovered = item.code === hoveredStockCode;
        const rate = item.fluctuationsRatio;
        const isUp = rate > 0;
        const isDown = rate < 0;
        const absRate = Math.abs(rate);

        let color = '#111319'; // flat gray-ish for flat or unchanged

        if (colorMode === 'KR') {
          if (isUp) {
            if (absRate >= 5.0) color = '#e51c23'; // vibrant classic red
            else if (absRate >= 3.0) color = '#cc1115'; // vivid red
            else if (absRate >= 2.0) color = '#b30e13'; // rich red
            else if (absRate >= 1.0) color = '#8c0a0e'; // wine red
            else if (absRate >= 0.5) color = '#610609'; // dark wine red
            else if (absRate >= 0.1) color = '#3b0305'; // deep dark burgundy
          } else if (isDown) {
            if (absRate >= 5.0) color = '#00b8d4'; // vibrant cerulean cyan
            else if (absRate >= 3.0) color = '#008bbb'; // electric medium blue
            else if (absRate >= 2.0) color = '#0073aa'; // vivid blue
            else if (absRate >= 1.0) color = '#005b8a'; // classic sapphire blue
            else if (absRate >= 0.5) color = '#004066'; // deep navy blue
            else if (absRate >= 0.1) color = '#00263f'; // very dark navy
          }
        } else {
          if (isUp) {
            if (absRate >= 5.0) color = '#00df5a'; // brilliant electric green
            else if (absRate >= 3.0) color = '#00a844'; // bright green
            else if (absRate >= 2.0) color = '#0e833f'; // emerald green
            else if (absRate >= 1.0) color = '#0a6230'; // medium dark emerald
            else if (absRate >= 0.5) color = '#064421'; // dark forest green
            else if (absRate >= 0.1) color = '#042a15'; // very dark green
          } else if (isDown) {
            if (absRate >= 5.0) color = '#e51c23'; // vibrant classic red
            else if (absRate >= 3.0) color = '#cc1115'; // vivid red
            else if (absRate >= 2.0) color = '#b30e13'; // rich red
            else if (absRate >= 1.0) color = '#8c0a0e'; // wine red
            else if (absRate >= 0.5) color = '#610609'; // dark red
            else if (absRate >= 0.1) color = '#3b0305'; // very dark burgundy
          }
        }

        // Perfect high-readability responsive text dimensions with auto line-breaking and micro scaling
        const nameLength = item.name.length || 1;
        
        // Let's find the ideal single-line font size to see if it can fit on one line
        // Each Korean/English mixed char average width is approximately its font size.
        const idealSingleLineFontSize = (width * 0.91) / nameLength;
        
        let dynamicFontSize = 12;
        let isWrapping = false;

        if (idealSingleLineFontSize >= 11.5) {
          // Plenty of space to render normally on one line
          dynamicFontSize = Math.min(13.5, idealSingleLineFontSize);
          isWrapping = false;
        } else if (idealSingleLineFontSize >= 7.0) {
          // Scale down slightly to fit on a SINGLE line! No wrapping needed, extremely clean and readable.
          dynamicFontSize = idealSingleLineFontSize;
          isWrapping = false;
        } else {
          // Cell is too narrow to fit on one line, so wrap is inevitable.
          isWrapping = true;
          
          // Let's calculate expected wrapped lines and scale down even further as requested
          const approxRowsExpected = Math.ceil(nameLength / Math.max(2, Math.floor(width / 7)));
          const heightLimit = (height * 0.78) / (approxRowsExpected + 1); // safe height division
          const widthLimit = (width * 0.9) / Math.max(2, Math.ceil(nameLength / approxRowsExpected));
          
          // Shrink font size even more so that wrapped lines fit perfectly inside the tiny box
          const wrappedFontSize = Math.min(widthLimit, heightLimit) * 0.82;
          dynamicFontSize = Math.max(5.0, Math.min(7.2, wrappedFontSize));
        }

        let rateFontSize = Math.max(4.8, Math.min(11, dynamicFontSize * 0.82));
        if (isWrapping) {
          // Further reduce rate font size under wrapping conditions to maintain strict hierarchy
          rateFontSize = Math.max(4.3, Math.min(6.8, dynamicFontSize * 0.78));
        }

        return (
          <div
            key={item.code}
            className="absolute transition-all duration-150 flex flex-col items-center justify-center border text-center select-none overflow-hidden p-[1px] leading-tight"
            style={{
              left: `${x}px`,
              top: `${y}px`,
              width: `${width}px`,
              height: `${height}px`,
              backgroundColor: color,
              borderColor: isHovered ? '#ffffff' : '#0d0f14',
              borderWidth: isHovered ? '2px' : '0.3px',
              zIndex: isHovered ? 10 : 1,
              cursor: 'pointer',
            }}
            onMouseEnter={() => onHoverStock(item)}
            onMouseLeave={() => onHoverStock(null)}
          >
            <div 
              className="font-bold tracking-tight text-white select-none break-all w-full overflow-hidden text-ellipsis leading-[1.1] px-[1px]"
              style={{ fontSize: `${dynamicFontSize}px`, fontFamily: 'Pretendard, Inter, sans-serif' }}
            >
              {item.name}
            </div>
            <div 
              className="font-medium tracking-tight text-white/95 select-none leading-none mt-[1px] break-all w-full overflow-hidden text-ellipsis"
              style={{ fontSize: `${rateFontSize}px`, fontFamily: 'Pretendard, Inter, sans-serif' }}
            >
              {rate > 0 ? '+' : ''}{rate.toFixed(2)}%
            </div>
          </div>
        );
      })}
    </div>
  );
};

// --- Components ---

const MetricCard = ({ 
  label, 
  value, 
  changeVal, 
  changeRate, 
  extraInfo, 
  maxInfo, 
  minInfo, 
  onClick, 
  isClickable, 
  isActive, 
  toggleBadge, 
  liveBadge, 
  sourceText, 
  subDetail,
  isKoreanMode = true
}: any) => {
  const numericRate = useMemo(() => {
    if (changeRate !== undefined && changeRate !== null && changeRate !== '') {
      const clean = String(changeRate).replace(/[+%]/g, '').trim();
      const n = parseFloat(clean);
      if (!isNaN(n)) return n;
    }
    if (changeVal !== undefined && changeVal !== null && changeVal !== '') {
      const n = parseFloat(String(changeVal).replace(/,/g, ''));
      if (!isNaN(n)) return n > 0 ? 0.6 : n < 0 ? -0.6 : 0;
    }
    return 0;
  }, [changeRate, changeVal]);

  const intensity = useMemo(() => {
    return getTrendIntensity(numericRate, isKoreanMode);
  }, [numericRate, isKoreanMode]);

  const isUp = intensity.direction === 'up';
  const isDown = intensity.direction === 'down';
  const Icon = isUp ? ChevronUp : isDown ? ChevronDown : Minus;

  return (
    <div 
      onClick={onClick}
      className={cn(
        "bg-white p-5 rounded-xl border border-gray-200 shadow-sm h-full flex flex-col justify-between transition-all duration-200 select-none relative overflow-hidden",
        isClickable && "cursor-pointer hover:border-amber-400 hover:shadow-md active:scale-[0.995]",
        isActive && "ring-2 ring-amber-500 border-amber-500 bg-amber-50/20"
      )}
    >
      {/* Top Intensity Accent Indicator Bar */}
      <div 
        className="absolute top-0 left-0 right-0 h-[3px] transition-colors duration-300"
        style={{ backgroundColor: intensity.hexColor }}
      />

      <div>
        <div className="flex items-center justify-between mb-2 gap-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
            {liveBadge && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {liveBadge}
              </span>
            )}
          </div>
          {toggleBadge && (
            <div className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 transition-all whitespace-nowrap",
              isActive 
                ? "bg-amber-500 text-white shadow-xs" 
                : "bg-amber-100 text-amber-800 hover:bg-amber-200"
            )}>
              <Activity size={10} className={cn(isActive && "animate-pulse")} />
              <span>{isActive ? "1년 차트 닫기 ▲" : "1년 차트 보기 ▼"}</span>
            </div>
          )}
        </div>

        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-2xl font-bold text-gray-900 leading-none">{value}</div>
          
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className={cn("text-xs font-bold flex items-center gap-0.5", intensity.colorClass)}>
              <Icon size={13} strokeWidth={3} />
              <span>{changeVal}</span>
              <span>{changeRate ? `(${changeRate}%)` : ''}</span>
            </div>
            
            {/* Intuitive Degree Badge */}
            <span 
              className={cn("text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-md border flex items-center gap-1", intensity.badgeClass)}
              title={`${intensity.statusText} (${intensity.levelText})`}
            >
              <span>{intensity.label}</span>
              <span className="opacity-75 text-[8.5px]">L{intensity.level}</span>
            </span>
          </div>
        </div>

        {subDetail && (
          <div className="mt-1.5 text-[11px] font-medium text-slate-600 flex items-center gap-2 flex-wrap">
            {subDetail}
          </div>
        )}
      </div>
      
      {(maxInfo || minInfo || extraInfo || sourceText) && (
        <div className="mt-3 pt-2.5 border-t border-gray-100 flex flex-col gap-1.5">
          {extraInfo && <div className="text-[10px] text-gray-500 truncate">{extraInfo}</div>}
          <div className="flex justify-between items-center text-[10px]">
            {maxInfo ? (
              <div className="text-gray-500">
                <span className={cn("font-bold mr-1", isKoreanMode ? "text-rose-600" : "text-emerald-600")}>HI</span>
                {formatNumber(maxInfo.val)} <span className="opacity-50">({maxInfo.time})</span>
              </div>
            ) : <div />}
            {minInfo ? (
              <div className="text-gray-500">
                <span className={cn("font-bold mr-1", isKoreanMode ? "text-blue-600" : "text-rose-600")}>LO</span>
                {formatNumber(minInfo.val)} <span className="opacity-50">({minInfo.time})</span>
              </div>
            ) : <div />}
          </div>
          {sourceText && (
            <div className="text-[9.5px] font-medium text-indigo-600 bg-indigo-50/70 border border-indigo-100/80 px-2 py-0.5 rounded flex items-center justify-between">
              <span className="truncate">{sourceText}</span>
              <span className="text-[8.5px] opacity-75 shrink-0 ml-1">실시간 연동</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const INDEX_CONFIG: Record<string, {
  title: string;
  badge: string;
  description: string;
  footerNote: string;
  borderColor: string;
  accentBg: string;
  textColor: string;
  badgeStyle: string;
  strokeColor: string;
  gradientId: string;
  cardBg: string;
  cardBorder: string;
}> = {
  KOSPI: {
    title: '코스피 (KOSPI) 지수 1년 추이',
    badge: 'KOSPI Index',
    description: '한국 종합주가지수 (KOSPI) - 대한민국 대표 유가증권시장의 종합 시가총액 변동 추이입니다.',
    footerNote: '20일 이동평균선(보라색 점선) 상회 시 단기 상승 추세, 하회 시 단기 조정 국면을 의미합니다.',
    borderColor: 'border-blue-400/80',
    accentBg: 'bg-blue-600',
    textColor: 'text-blue-700',
    badgeStyle: 'text-blue-700 bg-blue-50 border-blue-200',
    strokeColor: '#2563eb',
    gradientId: 'kospiGradient',
    cardBg: 'bg-blue-50/50',
    cardBorder: 'border-blue-100',
  },
  KOSDAQ: {
    title: '코스닥 (KOSDAQ) 지수 1년 추이',
    badge: 'KOSDAQ Index',
    description: '코스닥 지수 (KOSDAQ) - 기술주 및 중소·벤처기업 중심 시장의 종합지수 변동 추이입니다.',
    footerNote: '20일 이동평균선(보라색 점선) 상회 시 단기 상승 추세, 하회 시 단기 조정 국면을 의미합니다.',
    borderColor: 'border-emerald-400/80',
    accentBg: 'bg-emerald-600',
    textColor: 'text-emerald-700',
    badgeStyle: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    strokeColor: '#059669',
    gradientId: 'kosdaqGradient',
    cardBg: 'bg-emerald-50/50',
    cardBorder: 'border-emerald-100',
  },
  VOLATILITY: {
    title: '코스피 변동성 지수 (VKOSPI) 1년 추이',
    badge: 'VKOSPI',
    description: '한국형 공포지수(VKOSPI) - 지수가 높을수록 주식 시장의 미래 변동성 기대치가 큼을 의미합니다.',
    footerNote: 'VKOSPI 해석: 30 미만(안정적인 장세), 30~50(일반적 시장 환경), 50~70(변동성 경계), 70 이상(급락 위험 및 고변동성 장세).',
    borderColor: 'border-amber-400/80',
    accentBg: 'bg-amber-500',
    textColor: 'text-amber-700',
    badgeStyle: 'text-amber-700 bg-amber-50 border-amber-200',
    strokeColor: '#d97706',
    gradientId: 'volGradient',
    cardBg: 'bg-amber-50/50',
    cardBorder: 'border-amber-100',
  },
};

const IndexChartSection = ({ 
  type, 
  currentVal, 
  targetDate, 
  onClose,
  realtimeVol,
}: { 
  type: 'KOSPI' | 'KOSDAQ' | 'VOLATILITY'; 
  currentVal: number; 
  targetDate: Date; 
  onClose: () => void;
  realtimeVol?: RealtimeVKOSPI | null;
}) => {
  const [range, setRange] = useState<'1Y' | '6M' | '3M' | '1M'>('1Y');
  const [realHistory, setRealHistory] = useState<VolatilityHistoryPoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const config = INDEX_CONFIG[type] || INDEX_CONFIG.KOSPI;

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    fetchIndexHistory(type).then(data => {
      if (isMounted) {
        if (data && data.length > 0) {
          setRealHistory(data);
        } else {
          setRealHistory(generateIndexHistory(type, currentVal, targetDate));
        }
        setIsLoading(false);
      }
    }).catch(err => {
      console.error(`Failed to load ${type} index history:`, err);
      if (isMounted) {
        setRealHistory(generateIndexHistory(type, currentVal, targetDate));
        setIsLoading(false);
      }
    });
    return () => { isMounted = false; };
  }, [type, currentVal, targetDate]);

  const fullHistory = useMemo(() => {
    if (realHistory && realHistory.length > 0) return realHistory;
    return generateIndexHistory(type, currentVal, targetDate);
  }, [type, realHistory, currentVal, targetDate]);

  const filteredData = useMemo(() => {
    if (!fullHistory || fullHistory.length === 0) return [];
    if (range === '1M') return fullHistory.slice(-21);
    if (range === '6M') return fullHistory.slice(-125);
    if (range === '3M') return fullHistory.slice(-63);
    return fullHistory;
  }, [fullHistory, range]);

  const stats = useMemo(() => {
    if (!filteredData || filteredData.length === 0) return null;
    let maxVal = -Infinity;
    let minVal = Infinity;
    let maxItem = filteredData[0];
    let minItem = filteredData[0];
    let sum = 0;

    filteredData.forEach(d => {
      sum += d.value;
      if (d.value > maxVal) {
        maxVal = d.value;
        maxItem = d;
      }
      if (d.value < minVal) {
        minVal = d.value;
        minItem = d;
      }
    });

    const avg = sum / filteredData.length;
    const latest = filteredData[filteredData.length - 1];

    let regime = '상승 추세 (20D 상회)';
    let regimeColor = 'text-emerald-700 bg-emerald-50 border-emerald-200';

    if (type === 'VOLATILITY') {
      const valToJudge = realtimeVol?.last ?? latest.value;
      if (valToJudge < 30) {
        regime = '안정 (30 미만)';
        regimeColor = 'text-emerald-700 bg-emerald-50 border-emerald-200';
      } else if (valToJudge >= 70) {
        regime = '고변동성 (70 이상)';
        regimeColor = 'text-rose-700 bg-rose-50 border-rose-200';
      } else if (valToJudge >= 50) {
        regime = '주의 (50~70)';
        regimeColor = 'text-amber-700 bg-amber-50 border-amber-200';
      } else {
        regime = '보통 (30~50)';
        regimeColor = 'text-blue-700 bg-blue-50 border-blue-200';
      }
    } else {
      if (latest.value >= latest.ma20 * 1.015) {
        regime = '상승 추세 (20D 이평 상회)';
        regimeColor = 'text-emerald-700 bg-emerald-50 border-emerald-200';
      } else if (latest.value < latest.ma20 * 0.985) {
        regime = '조정/하락 (20D 이평 하회)';
        regimeColor = 'text-rose-700 bg-rose-50 border-rose-200';
      } else {
        regime = '보합/횡보 (20D 이평 부근)';
        regimeColor = 'text-blue-700 bg-blue-50 border-blue-200';
      }
    }

    return {
      max: maxItem,
      min: minItem,
      avg: Math.round(avg * 100) / 100,
      latest,
      regime,
      regimeColor,
    };
  }, [type, filteredData, realtimeVol]);

  const yDomain = useMemo(() => {
    if (!stats) return [0, 100];
    const margin = (stats.max.value - stats.min.value) * 0.08 || 5;
    const min = Math.floor(stats.min.value - margin);
    const max = Math.ceil(stats.max.value + margin);
    return [Math.max(0, min), max];
  }, [stats]);

  const xAxisInterval = useMemo(() => {
    if (range === '1M') return 3;
    if (range === '3M') return 8;
    if (range === '6M') return 15;
    return 24;
  }, [range]);

  return (
    <div className={cn("bg-white border-2 rounded-2xl p-6 shadow-lg my-2 transition-all", config.borderColor)}>
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-5 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 text-white rounded-lg shadow-sm", config.accentBg)}>
              <Activity size={18} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight flex items-center gap-2">
              {config.title}
              {type === 'VOLATILITY' && realtimeVol && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  실시간 {realtimeVol.source === 'KIS' ? '한국투자증권' : 'CNBC'}
                </span>
              )}
            </h3>
            {stats && (
              <span className={cn("text-xs font-bold px-2.5 py-0.5 rounded-full border shadow-2xs", stats.regimeColor)}>
                {stats.regime}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1 pl-8">
            {config.description}
          </p>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-bold text-gray-600">
            {(['1Y', '6M', '3M', '1M'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "px-3 py-1 rounded-md transition-all cursor-pointer",
                  range === r ? cn("bg-white shadow-xs font-extrabold", config.textColor) : "hover:text-gray-900"
                )}
              >
                {r === '1Y' ? '1년' : r === '6M' ? '6개월' : r === '3M' ? '3개월' : '1개월'}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
            title="차트 닫기"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 my-5">
          <div className={cn("border p-3.5 rounded-xl", config.cardBg, config.cardBorder)}>
            <div className={cn("text-[11px] font-bold mb-1 opacity-90", config.textColor)}>
              {type === 'VOLATILITY' && realtimeVol ? '실시간 VKOSPI 지수' : '현재 지수 / 가격'}
            </div>
            <div className="text-xl font-extrabold text-gray-900 flex items-baseline gap-2">
              {type === 'VOLATILITY' && realtimeVol 
                ? formatNumber(realtimeVol.last) 
                : formatNumber(stats.latest.value)}
              {type === 'VOLATILITY' && realtimeVol ? (
                <span className={cn("text-xs font-bold", realtimeVol.change > 0 ? "text-rose-600" : realtimeVol.change < 0 ? "text-blue-600" : "text-gray-500")}>
                  {realtimeVol.change > 0 ? `+${formatNumber(realtimeVol.change)}` : formatNumber(realtimeVol.change)} ({realtimeVol.changePct > 0 ? '+' : ''}{realtimeVol.changePct.toFixed(2)}%)
                </span>
              ) : (
                <span className={cn("text-xs font-bold", stats.latest.change > 0 ? "text-rose-600" : stats.latest.change < 0 ? "text-blue-600" : "text-gray-500")}>
                  {stats.latest.change > 0 ? `+${stats.latest.change}` : stats.latest.change} ({stats.latest.changeRate > 0 ? '+' : ''}{stats.latest.changeRate}%)
                </span>
              )}
            </div>
          </div>

          <div className="bg-rose-50/50 border border-rose-100 p-3.5 rounded-xl">
            <div className="text-[11px] font-bold text-rose-700/80 mb-1">기간 최고치 (High)</div>
            <div className="text-xl font-extrabold text-rose-950 flex items-baseline gap-2">
              {formatNumber(stats.max.value)}
              <span className="text-[10px] font-semibold text-rose-600 opacity-80">
                ({stats.max.displayDate})
              </span>
            </div>
          </div>

          <div className="bg-blue-50/50 border border-blue-100 p-3.5 rounded-xl">
            <div className="text-[11px] font-bold text-blue-700/80 mb-1">기간 최저치 (Low)</div>
            <div className="text-xl font-extrabold text-blue-950 flex items-baseline gap-2">
              {formatNumber(stats.min.value)}
              <span className="text-[10px] font-semibold text-blue-600 opacity-80">
                ({stats.min.displayDate})
              </span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 p-3.5 rounded-xl">
            <div className="text-[11px] font-bold text-slate-500 mb-1">기간 평균 (Average)</div>
            <div className="text-xl font-extrabold text-slate-800 flex items-baseline gap-2">
              {formatNumber(stats.avg)}
              <span className="text-[10px] font-semibold text-slate-500">
                (이평 20D)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Real-time VKOSPI Detail Strip */}
      {type === 'VOLATILITY' && realtimeVol && (
        <div className="mb-4 p-3 bg-amber-50/60 border border-amber-200/70 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-bold text-amber-900">당일 시세 상세:</span>
            {realtimeVol.open !== null && (
              <span className="text-gray-700">시가 <b className="text-gray-900">{formatNumber(realtimeVol.open)}</b></span>
            )}
            {realtimeVol.high !== null && (
              <span className="text-gray-700">고가 <b className="text-rose-600">{formatNumber(realtimeVol.high)}</b></span>
            )}
            {realtimeVol.low !== null && (
              <span className="text-gray-700">저가 <b className="text-blue-600">{formatNumber(realtimeVol.low)}</b></span>
            )}
            {realtimeVol.previousClose !== null && (
              <span className="text-gray-700">전일종가 <b className="text-gray-900">{formatNumber(realtimeVol.previousClose)}</b></span>
            )}
            {realtimeVol.yearHigh !== null && (
              <span className="text-gray-700">52주최고 <b className="text-rose-700">{formatNumber(realtimeVol.yearHigh)}</b></span>
            )}
            {realtimeVol.yearLow !== null && (
              <span className="text-gray-700">52주최저 <b className="text-blue-700">{formatNumber(realtimeVol.yearLow)}</b></span>
            )}
          </div>
          <div className="text-[11px] text-amber-800 font-medium ml-auto">
            출처: <b>{realtimeVol.source === 'KIS' ? '한국투자증권 Open API (실전)' : 'CNBC 실시간 시세'}</b> · 갱신 {realtimeVol.lastTime}
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="h-[360px] w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={filteredData} margin={{ top: 15, right: 20, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id={config.gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={config.strokeColor} stopOpacity={0.4} />
                <stop offset="95%" stopColor={config.strokeColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis 
              dataKey="displayDate" 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: '#64748b', fontWeight: 500 }}
              interval={xAxisInterval}
            />
            <YAxis 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: config.strokeColor, fontWeight: 600 }}
              domain={yDomain}
              width={45}
            />
            <Tooltip 
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload as VolatilityHistoryPoint;
                return (
                  <div className="bg-slate-900/95 text-white p-3 rounded-xl shadow-xl text-xs space-y-1 border border-slate-700 backdrop-blur-md">
                    <div className="font-bold text-slate-300 pb-1 border-b border-slate-700/80 flex items-center justify-between gap-3">
                      <span>{d.date}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase bg-slate-800 text-slate-300">
                        {config.badge}
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-4 font-extrabold text-sm pt-1" style={{ color: config.strokeColor }}>
                      <span>{config.badge}:</span>
                      <span>{formatNumber(d.value)}</span>
                    </div>
                    <div className="flex justify-between items-center gap-4 text-slate-300 text-[11px]">
                      <span>전일 대비:</span>
                      <span className={d.change > 0 ? "text-rose-400 font-bold" : d.change < 0 ? "text-blue-400 font-bold" : "text-slate-400"}>
                        {d.change > 0 ? `+${d.change}` : d.change} ({d.changeRate > 0 ? '+' : ''}{d.changeRate}%)
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-4 text-slate-400 text-[10px]">
                      <span>20일 이동평균:</span>
                      <span>{formatNumber(d.ma20)}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Legend 
              verticalAlign="top" 
              align="right" 
              wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', paddingBottom: '12px' }} 
            />
            
            {type === 'VOLATILITY' && (
              <>
                <ReferenceLine 
                  y={50.0} 
                  stroke="#f59e0b" 
                  strokeDasharray="4 4" 
                  strokeWidth={1.5}
                  label={{ value: "주의 (50.0)", fill: "#d97706", fontSize: 10, fontWeight: "bold", position: "insideTopRight" }}
                />
                <ReferenceLine 
                  y={70.0} 
                  stroke="#ef4444" 
                  strokeDasharray="4 4" 
                  strokeWidth={1.5}
                  label={{ value: "고변동성 (70.0)", fill: "#dc2626", fontSize: 10, fontWeight: "bold", position: "insideTopRight" }}
                />
              </>
            )}

            <Area 
              type="monotone" 
              dataKey="value" 
              name={`${config.badge} 지수`} 
              stroke={config.strokeColor} 
              strokeWidth={2.5}
              fill={`url(#${config.gradientId})`} 
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff', fill: config.strokeColor }}
            />
            <Line 
              type="monotone" 
              dataKey="ma20" 
              name="20일 이동평균" 
              stroke="#8b5cf6" 
              strokeWidth={1.5} 
              strokeDasharray="3 3"
              dot={false}
            />

            {stats && (
              <ReferenceDot 
                x={stats.max.displayDate} 
                y={stats.max.value} 
                r={5} 
                fill="#ef4444" 
                stroke="#ffffff" 
                strokeWidth={2}
                label={{ value: `최고 ${formatNumber(stats.max.value)}`, position: 'top', fill: '#dc2626', fontSize: 10, fontWeight: 'bold' }} 
              />
            )}
            {stats && (
              <ReferenceDot 
                x={stats.min.displayDate} 
                y={stats.min.value} 
                r={5} 
                fill="#2563eb" 
                stroke="#ffffff" 
                strokeWidth={2}
                label={{ value: `최저 ${formatNumber(stats.min.value)}`, position: 'bottom', fill: '#1d4ed8', fontSize: 10, fontWeight: 'bold' }} 
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Footer explanation */}
      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2 text-[11px] text-gray-500">
        <Info size={14} className={cn("shrink-0", config.textColor)} />
        <span>
          <b>{config.badge} 지수 안내:</b> {config.footerNote}
        </span>
      </div>
    </div>
  );
};

const TrendCard = ({ 
  label, 
  direction, 
  statusText, 
  icon, 
  changeValue, 
  changeRate, 
  intensity,
  first,
  last,
  timeRange
}: any) => {
  // If intensity is not provided directly, compute it
  const trendIntensity: TrendIntensity = intensity || getTrendIntensity(changeRate, true);

  return (
    <div className={cn(
      "relative overflow-hidden p-4 rounded-xl text-white shadow-md border transition-all duration-300 isolation-auto flex flex-col justify-between gap-3",
      trendIntensity.gradientClass,
      trendIntensity.borderClass
    )}>
      {/* Shine effect animation simulated with CSS in tailwind */}
      <div className="absolute inset-0 w-1/4 h-[360%] bg-gradient-to-r from-white/0 via-white/20 to-white/0 -rotate-[18deg] -translate-x-[200%] animate-[trendShine_6.4s_linear_infinite] pointer-events-none z-0" />
      
      <div className="relative z-10 space-y-2.5">
        {/* Top bar: Market Label + Intensity Tier Badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black tracking-wider uppercase px-2 py-0.5 rounded bg-black/25 text-white/95 border border-white/15 backdrop-blur-xs">
              {label}
            </span>
            <span className="text-[10px] text-white/80 font-medium">
              {timeRange || '최근 30분 추세'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/30 border border-white/20 backdrop-blur-xs text-[10px] font-extrabold text-white">
            <span 
              className={cn("w-1.5 h-1.5 rounded-full", trendIntensity.level >= 4 && "animate-ping")} 
              style={{ backgroundColor: trendIntensity.hexColor === '#64748b' ? '#cbd5e1' : '#ffffff' }} 
            />
            <span>{trendIntensity.levelText}</span>
          </div>
        </div>

        {/* Status Headline + Value / Rate */}
        <div className="flex items-baseline justify-between gap-2 flex-wrap pt-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">{trendIntensity.icon}</span>
            <span className="text-base font-extrabold tracking-tight">{trendIntensity.statusText}</span>
          </div>
          <div className="text-right">
            <div className="text-base font-extrabold tracking-tight">
              {changeValue > 0 ? '+' : ''}{formatNumber(changeValue)} pt
            </div>
            <div className="text-xs font-semibold text-white/90">
              {changeRate > 0 ? '+' : ''}{changeRate.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* 5-Step Visual Intensity Meter */}
        <div className="pt-2 border-t border-white/15">
          <div className="flex items-center justify-between text-[10px] font-semibold text-white/85 mb-1.5">
            <span className="flex items-center gap-1">
              <span>추세 강도:</span>
              <b className="font-extrabold text-white">{trendIntensity.label} ({trendIntensity.level}/5)</b>
            </span>
            <span className="text-[9.5px] text-white/75">
              {trendIntensity.direction === 'up' ? `상승 탄력 ${trendIntensity.gaugePercent}%` : trendIntensity.direction === 'down' ? `하락 압력 ${trendIntensity.gaugePercent}%` : '중립'}
            </span>
          </div>
          
          {/* Segmented Meter Bar */}
          <div className="grid grid-cols-5 gap-1 h-1.5">
            {[1, 2, 3, 4, 5].map((step) => {
              const isActive = step <= trendIntensity.level;
              return (
                <div 
                  key={step} 
                  className={cn(
                    "h-full rounded-xs transition-all duration-300",
                    isActive 
                      ? "bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)]" 
                      : "bg-black/30 border border-white/10"
                  )} 
                />
              );
            })}
          </div>
        </div>

        {/* Context Description */}
        <div className="p-2 rounded-lg bg-black/20 border border-white/10 text-[10.5px] leading-relaxed text-white/90 font-medium flex items-start gap-1.5">
          <Info size={13} className="shrink-0 mt-0.5 opacity-80" />
          <span>{trendIntensity.description}</span>
        </div>
      </div>
    </div>
  );
};

const TrendIntensitySpectrum = ({ isKoreanMode = true }: { isKoreanMode?: boolean }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tiers = [
    { label: '급락', range: '≤ -2.0%', level: 5, bg: isKoreanMode ? 'bg-blue-900 text-white' : 'bg-red-900 text-white' },
    { label: '강한 하락', range: '-1.2%~-2%', level: 4, bg: isKoreanMode ? 'bg-blue-700 text-white' : 'bg-red-600 text-white' },
    { label: '하락세', range: '-0.5%~-1.2%', level: 3, bg: isKoreanMode ? 'bg-blue-500 text-white' : 'bg-rose-500 text-white' },
    { label: '소폭 하락', range: '-0.15%~-0.5%', level: 2, bg: isKoreanMode ? 'bg-sky-400 text-white' : 'bg-rose-300 text-gray-900' },
    { label: '보합', range: '±0.15%', level: 1, bg: 'bg-slate-400 text-white' },
    { label: '소폭 상승', range: '+0.15%~+0.5%', level: 2, bg: isKoreanMode ? 'bg-rose-300 text-gray-900' : 'bg-emerald-400 text-white' },
    { label: '상승세', range: '+0.5%~+1.2%', level: 3, bg: isKoreanMode ? 'bg-rose-500 text-white' : 'bg-emerald-600 text-white' },
    { label: '강한 상승', range: '+1.2%~+2%', level: 4, bg: isKoreanMode ? 'bg-red-600 text-white' : 'bg-emerald-700 text-white' },
    { label: '급등', range: '≥ +2.0%', level: 5, bg: isKoreanMode ? 'bg-red-800 text-white' : 'bg-emerald-900 text-white' },
  ];

  return (
    <div className="bg-white px-3.5 py-2 rounded-lg border border-gray-200 text-xs shadow-2xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Activity size={12} className="text-gray-400" />
          <span className="text-[11px] font-semibold text-gray-600">누적 bar 색상 강도 (9단계):</span>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className={cn("px-1.5 py-0.5 rounded font-bold", isKoreanMode ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-red-50 text-red-700 border border-red-200")}>
              하락 (짙을수록 급락)
            </span>
            <span className="text-gray-300">◀</span>
            <span className="px-1.5 py-0.5 rounded font-bold bg-gray-100 text-gray-600 border border-gray-200">
              보합 (회색)
            </span>
            <span className="text-gray-300">▶</span>
            <span className={cn("px-1.5 py-0.5 rounded font-bold", isKoreanMode ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200")}>
              상승 (짙을수록 급등)
            </span>
          </div>
        </div>

        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="text-[11px] text-gray-400 hover:text-gray-700 underline font-medium cursor-pointer"
        >
          {isOpen ? '색상표 접기' : '단계별 상세 색상표'}
        </button>
      </div>

      {isOpen && (
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-1 pt-2.5 mt-2 border-t border-gray-100">
          {tiers.map((t, idx) => (
            <div 
              key={idx} 
              className={cn("p-1 rounded flex flex-col items-center justify-center text-center", t.bg)}
            >
              <div className="text-[9.5px] font-extrabold tracking-tight leading-tight">{t.label}</div>
              <div className="text-[8px] opacity-90 font-medium">{t.range}</div>
            </div>
          ))}
        </div>
      )}
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
  const [krxVol, setKrxVol] = useState<any>(null);
  const [realtimeVol, setRealtimeVol] = useState<RealtimeVKOSPI | null>(null);
  const [krxError, setKrxError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [targetDate, setTargetDate] = useState<Date>(toZonedTime(new Date(), KST_TZ));
  const [activeChart, setActiveChart] = useState<'KOSPI' | 'KOSDAQ' | 'VOLATILITY' | null>(null);
  
  // Treemap States
  const [marketStocks, setMarketStocks] = useState<any[]>([]);
  const [isTreemapLoading, setIsTreemapLoading] = useState(false);
  const [treemapMarket, setTreemapMarket] = useState<'ALL' | 'KOSPI' | 'KOSDAQ'>('ALL');
  const [treemapColorMode, setTreemapColorMode] = useState<'KR' | 'US'>('KR');
  const [treemapLimit, setTreemapLimit] = useState<number>(100);
  const [hoveredStock, setHoveredStock] = useState<any | null>(null);

  const fetchData = async (dateToUse: Date = targetDate) => {
    setIsLoading(true);
    setKrxError(null);
    const baseDate = toZonedTime(dateToUse, KST_TZ);
    const dateCandidates: string[] = [];
    for (let i = 0; i < 11; i++) {
      dateCandidates.push(format(subDays(baseDate, i), 'yyyyMMdd'));
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

    let vol: any[] = [];
    let successfulDate: string | null = null;

    for (const basDd of dateCandidates) {
      const vData = await fetchKRXData('volatility', basDd);
      const vRows = extractKrxRows(vData);

      if (vRows.length > 0) {
        vol = vRows;
        successfulDate = basDd;
        break;
      }
    }

    if (!successfulDate) {
      setKrxError("Failed to fetch KRX data. Please check your KRX_AUTH_KEY.");
    }
    
    // Volatility logic
    if (vol.length > 0) {
      const vIndex = vol.find((row: any) => {
        const name = normalizeText(row.IDX_NM);
        return name.includes('변동성');
      });
      setKrxVol(vIndex);
    }

    // Real-time VKOSPI fetching (KIS / Naver / CNBC)
    try {
      const liveVol = await fetchRealtimeVKOSPI();
      if (liveVol) {
        setRealtimeVol(liveVol);
      }
    } catch (e) {
      console.warn('Realtime quotes fetch error:', e);
    }

    // Fetch Naver Market Stock list for Treemap
    setIsTreemapLoading(true);
    try {
      const allStocksRes = await fetchNaverMarketStocks();
      if (allStocksRes) {
        const extracted = extractMarketStocks(allStocksRes);
        const normalized = extracted.map(normalizeStockItem);
        // Sort by marketValueAmount descending (largest first)
        normalized.sort((a, b) => b.marketValueAmount - a.marketValueAmount);
        setMarketStocks(normalized);
      }
    } catch (err) {
      console.error('Failed to populate Treemap data:', err);
    } finally {
      setIsTreemapLoading(false);
    }

    setLastUpdate(new Date());
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData(targetDate);
    // Only set interval for the current day to avoid unnecessary polling for past data
    const isToday = format(targetDate, 'yyyy-MM-dd') === format(toZonedTime(new Date(), KST_TZ), 'yyyy-MM-dd');
    
    let interval: any;
    let rtInterval: any;

    if (isToday) {
      interval = setInterval(() => fetchData(targetDate), 60000);
      
      // Fast polling dedicated to real-time VKOSPI
      rtInterval = setInterval(async () => {
        try {
          const liveVol = await fetchRealtimeVKOSPI();
          if (liveVol) setRealtimeVol(liveVol);
        } catch {
          // silent fallback
        }
      }, 5000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
      if (rtInterval) clearInterval(rtInterval);
    };
  }, [targetDate]);

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
        KOSPI_change: cleanValue(k?.changeVal),
        KOSPI_rate: cleanValue(k?.changeRate),
        KOSDAQ: cleanValue(q?.nowVal),
        KOSDAQ_change: cleanValue(q?.changeVal),
        KOSDAQ_rate: cleanValue(q?.changeRate)
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

  // 5-Minute Intraday Cumulative Trend Summaries (09:00 ~ 15:30)
  const kospiIntradayTrend = useMemo(() => {
    const latestVal = cleanValue(latestKospi?.nowVal) ?? 2500;
    const latestChange = cleanValue(latestKospi?.changeVal) ?? 12.5;
    const latestRate = cleanValue(latestKospi?.changeRate) ?? 0.5;
    return computeIntraday5MinTrend(
      chartData, 
      'KOSPI', 
      'KOSPI', 
      treemapColorMode === 'KR',
      latestVal,
      latestChange,
      latestRate
    );
  }, [chartData, latestKospi, treemapColorMode]);

  const kosdaqIntradayTrend = useMemo(() => {
    const latestVal = cleanValue(latestKosdaq?.nowVal) ?? 750;
    const latestChange = cleanValue(latestKosdaq?.changeVal) ?? 5.2;
    const latestRate = cleanValue(latestKosdaq?.changeRate) ?? 0.7;
    return computeIntraday5MinTrend(
      chartData, 
      'KOSDAQ', 
      'KOSDAQ', 
      treemapColorMode === 'KR',
      latestVal,
      latestChange,
      latestRate
    );
  }, [chartData, latestKosdaq, treemapColorMode]);

  const calculateTrend = (data: any[], valKey: string, label: string) => {
    const validData = data.filter(d => d[valKey] !== null && d[valKey] !== undefined);
    if (validData.length < 2) return null;
    
    const recent = validData.slice(-30);
    const first = recent[0][valKey];
    const last = recent[recent.length - 1][valKey];

    const diff = last - first;
    const rate = first !== 0 ? (diff / first) * 100 : 0;
    const intensity = getTrendIntensity(rate, treemapColorMode === 'KR');

    return { 
      label, 
      valKey,
      first,
      last,
      intensity, 
      changeValue: diff, 
      changeRate: rate,
      direction: intensity.direction,
      statusText: intensity.statusText,
      icon: intensity.icon
    };
  };

  const kospiTrend = calculateTrend(chartData, 'KOSPI', 'KOSPI 지수 추세');
  const kosdaqTrend = calculateTrend(chartData, 'KOSDAQ', 'KOSDAQ 지수 추세');

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

  const filteredTreemapData = useMemo(() => {
    let list = [...marketStocks];

    // 1. Filter by market type
    if (treemapMarket === 'KOSPI') {
      list = list.filter(s => s.sosok === '0' || String(s.sosok).includes('KOSPI') || String(s.sosok).trim() === '001');
    } else if (treemapMarket === 'KOSDAQ') {
      list = list.filter(s => s.sosok === '1' || String(s.sosok).includes('KOSDAQ') || String(s.sosok).trim() === '002');
    }

    // 2. Sort by marketValueAmount descending to ensure major caps are first
    list.sort((a, b) => (b.marketValueAmount || 0) - (a.marketValueAmount || 0));

    // 3. Keep only the requested Top N items (dynamic limit)
    const limitedList = list.slice(0, treemapLimit);

    // 4. Map to Recharts children format
    const childrenList = limitedList.map(item => ({
      ...item,
      name: item.name,
      value: item.marketValueAmount || 1, // Recharts needs value
    }));

    return [{ name: "ROOT", children: childrenList }];
  }, [marketStocks, treemapMarket, treemapLimit]);

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
              <div className="space-y-3">
                <input 
                  type="date"
                  value={format(targetDate, 'yyyy-MM-dd')}
                  onChange={(e) => {
                    const newDate = new Date(e.target.value);
                    if (!isNaN(newDate.getTime())) {
                      setTargetDate(newDate);
                    }
                  }}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
                <div className="bg-blue-50/50 border border-blue-100 rounded-lg px-3 py-2.5 flex items-center gap-2 text-[11px] font-bold text-blue-700 shadow-sm">
                  <Clock size={14} className="text-blue-400" />
                  {naverDate ? `${naverDate.substring(0, 4)}-${naverDate.substring(4, 6)}-${naverDate.substring(6, 8)}` : 'No Data'} (Actual)
                </div>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
            <MetricCard 
              label="KOSPI Index"
              value={formatNumber(latestKospi?.nowVal)}
              changeVal={latestKospi?.changeVal}
              changeRate={latestKospi?.changeRate}
              maxInfo={kospiStats?.max}
              minInfo={kospiStats?.min}
              onClick={() => setActiveChart(prev => prev === 'KOSPI' ? null : 'KOSPI')}
              isClickable={true}
              isActive={activeChart === 'KOSPI'}
              toggleBadge={true}
              isKoreanMode={treemapColorMode === 'KR'}
            />
            <MetricCard 
              label="KOSDAQ Index"
              value={formatNumber(latestKosdaq?.nowVal)}
              changeVal={latestKosdaq?.changeVal}
              changeRate={latestKosdaq?.changeRate}
              maxInfo={kosdaqStats?.max}
              minInfo={kosdaqStats?.min}
              onClick={() => setActiveChart(prev => prev === 'KOSDAQ' ? null : 'KOSDAQ')}
              isClickable={true}
              isActive={activeChart === 'KOSDAQ'}
              toggleBadge={true}
              isKoreanMode={treemapColorMode === 'KR'}
            />
            <MetricCard 
              label="Volatility Index"
              value={
                realtimeVol 
                  ? formatNumber(realtimeVol.last) 
                  : formatNumber(krxVol?.CLSPRC_IDX)
              }
              changeVal={
                realtimeVol 
                  ? (realtimeVol.change > 0 ? `+${formatNumber(realtimeVol.change)}` : formatNumber(realtimeVol.change)) 
                  : formatNumber(krxVol?.CMPPREVDD_IDX)
              }
              changeRate={
                realtimeVol 
                  ? (realtimeVol.changePct > 0 ? `+${realtimeVol.changePct.toFixed(2)}` : realtimeVol.changePct.toFixed(2)) 
                  : krxVol?.FLUC_RT
              }
              liveBadge={realtimeVol ? (realtimeVol.source === 'KIS' ? '실시간(KIS)' : '실시간') : undefined}
              subDetail={
                realtimeVol ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-rose-700 bg-rose-50 border border-rose-100 px-1 py-0.5 rounded text-[9.5px]">
                      VKOSPI 변동성 지수
                    </span>
                    {realtimeVol.yearHigh && realtimeVol.yearLow && (
                      <span className="text-[10px] text-slate-500">
                        52주 <b className="text-slate-700 font-semibold">{formatNumber(realtimeVol.yearLow)}~{formatNumber(realtimeVol.yearHigh)}</b>
                      </span>
                    )}
                  </div>
                ) : undefined
              }
              extraInfo={
                realtimeVol 
                  ? `${realtimeVol.lastTime} | ${realtimeVol.name || 'VKOSPI'} (코드: ${realtimeVol.symbol})` 
                  : krxVol 
                    ? `${krxVol.BAS_DD} | ${krxVol.IDX_NM}` 
                    : (krxError || 'Searching for market data...')
              }
              sourceText={
                realtimeVol?.source === 'KIS' 
                  ? '출처: 한국투자증권(KIS) Open API 실시간' 
                  : (realtimeVol?.source === 'CNBC' ? '출처: CNBC Realtime Quote' : '출처: 한국거래소(KRX) 공식 데이터')
              }
              maxInfo={realtimeVol?.high ? { val: realtimeVol.high, time: '당일고가' } : undefined}
              minInfo={realtimeVol?.low ? { val: realtimeVol.low, time: '당일저가' } : undefined}
              onClick={() => setActiveChart(prev => prev === 'VOLATILITY' ? null : 'VOLATILITY')}
              isClickable={true}
              isActive={activeChart === 'VOLATILITY'}
              toggleBadge={true}
              isKoreanMode={treemapColorMode === 'KR'}
            />
          </div>

          {/* Historical Index Chart Section (Togglable) */}
          <AnimatePresence mode="wait">
            {activeChart && (
              <motion.div
                key={activeChart}
                initial={{ opacity: 0, height: 0, scale: 0.98 }}
                animate={{ opacity: 1, height: 'auto', scale: 1 }}
                exit={{ opacity: 0, height: 0, scale: 0.98 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <IndexChartSection 
                  type={activeChart}
                  currentVal={
                    activeChart === 'KOSPI' ? (parseFloat(String(latestKospi?.nowVal || 0).replace(/,/g, '')) || 2500)
                    : activeChart === 'KOSDAQ' ? (parseFloat(String(latestKosdaq?.nowVal || 0).replace(/,/g, '')) || 750)
                    : (realtimeVol?.last ?? (parseFloat(String(krxVol?.CLSPRC_IDX || 0).replace(/,/g, '')) || 75.59))
                  }
                  targetDate={targetDate} 
                  onClose={() => setActiveChart(null)} 
                  realtimeVol={activeChart === 'VOLATILITY' ? realtimeVol : undefined}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Trend Section with Magnitude and Color Spectrum */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <IntradayTrendCard summary={kospiIntradayTrend} isKoreanMode={treemapColorMode === 'KR'} />
              <IntradayTrendCard summary={kosdaqIntradayTrend} isKoreanMode={treemapColorMode === 'KR'} />
            </div>
            <TrendIntensitySpectrum isKoreanMode={treemapColorMode === 'KR'} />
          </div>

          {/* Chart Section */}
          <div className="bg-white border border-gray-200 rounded-xl p-8 flex flex-col shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2 text-base">
                  <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                  Live Index Velocity (실시간 지수 모멘텀)
                </h3>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {latestKospi && (() => {
                    const kospiInt = getTrendIntensity(latestKospi.changeRate, treemapColorMode === 'KR');
                    return (
                      <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1.5 shadow-2xs", kospiInt.badgeClass)}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: kospiInt.hexColor }} />
                        <span>KOSPI {formatNumber(latestKospi.nowVal)} ({latestKospi.changeRate}% {kospiInt.label})</span>
                      </span>
                    );
                  })()}
                  {latestKosdaq && (() => {
                    const kosdaqInt = getTrendIntensity(latestKosdaq.changeRate, treemapColorMode === 'KR');
                    return (
                      <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1.5 shadow-2xs", kosdaqInt.badgeClass)}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: kosdaqInt.hexColor }} />
                        <span>KOSDAQ {formatNumber(latestKosdaq.nowVal)} ({latestKosdaq.changeRate}% {kosdaqInt.label})</span>
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
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

          {/* Treemap Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-8 flex flex-col shadow-sm gap-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-gray-700 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                  K-Stock Market Heatmap (Korea Stock Treemap)
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Stocks are sized by their market capitalization. Hover over a block to view details.
                </p>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Market Toggle */}
                <div className="flex bg-gray-100 rounded-lg p-0.5 border border-gray-200">
                  <button
                    onClick={() => setTreemapMarket('ALL')}
                    className={cn(
                      "px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer",
                      treemapMarket === 'ALL' ? "bg-white text-gray-800 shadow-xs" : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    전체
                  </button>
                  <button
                    onClick={() => setTreemapMarket('KOSPI')}
                    className={cn(
                      "px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer",
                      treemapMarket === 'KOSPI' ? "bg-white text-gray-800 shadow-xs" : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    코스피 (KOSPI)
                  </button>
                  <button
                    onClick={() => setTreemapMarket('KOSDAQ')}
                    className={cn(
                      "px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer",
                      treemapMarket === 'KOSDAQ' ? "bg-white text-gray-800 shadow-xs" : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    코스닥 (KOSDAQ)
                  </button>
                </div>

                {/* Treemap Size (Top N) Toggle */}
                <div className="flex bg-gray-100 rounded-lg p-0.5 border border-gray-200">
                  <button
                    onClick={() => setTreemapLimit(50)}
                    className={cn(
                      "px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer",
                      treemapLimit === 50 ? "bg-white text-gray-800 shadow-xs animate-fade-in" : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    Top 50
                  </button>
                  <button
                    onClick={() => setTreemapLimit(100)}
                    className={cn(
                      "px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer",
                      treemapLimit === 100 ? "bg-white text-gray-800 shadow-xs" : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    Top 100
                  </button>
                  <button
                    onClick={() => setTreemapLimit(200)}
                    className={cn(
                      "px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer",
                      treemapLimit === 200 ? "bg-white text-gray-800 shadow-xs" : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    Top 200
                  </button>
                </div>

                {/* Theme Palette Mode Toggle */}
                <div className="flex bg-gray-100 rounded-lg p-0.5 border border-gray-200">
                  <button
                    onClick={() => setTreemapColorMode('KR')}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-extrabold rounded-md transition-all flex items-center gap-1 cursor-pointer",
                      treemapColorMode === 'KR' ? "bg-white text-red-600 shadow-xs" : "text-gray-500 hover:text-gray-900"
                    )}
                    title="Traditional Korean stock palette (Red rise, Blue fall)"
                  >
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-blue-500 to-red-500" />
                    KR Style
                  </button>
                  <button
                    onClick={() => setTreemapColorMode('US')}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-extrabold rounded-md transition-all flex items-center gap-1 cursor-pointer",
                      treemapColorMode === 'US' ? "bg-white text-emerald-600 shadow-xs" : "text-gray-500 hover:text-gray-900"
                    )}
                    title="Global stock palette (Green rise, Red fall)"
                  >
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-red-500 to-emerald-500" />
                    US Style
                  </button>
                </div>
              </div>
            </div>

            {/* Live Legend Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
              {/* Color scale legend */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400">하락 (≤ -5%)</span>
                <div className="flex h-3 w-40 rounded-sm overflow-hidden border border-gray-200 shadow-2xs">
                  {treemapColorMode === 'KR' ? (
                    <>
                      <div className="flex-1 bg-[#00b8d4]" title="-5% 이하 (하한/급락)" />
                      <div className="flex-1 bg-[#008bbb]" title="-3%급" />
                      <div className="flex-1 bg-[#0073aa]" title="-2%급" />
                      <div className="flex-1 bg-[#004066]" title="-0.5%급" />
                      <div className="flex-1 bg-[#1f222b]" title="보합" />
                      <div className="flex-1 bg-[#610609]" title="+0.5%급" />
                      <div className="flex-1 bg-[#b30e13]" title="+2%급" />
                      <div className="flex-1 bg-[#cc1115]" title="+3%급" />
                      <div className="flex-1 bg-[#e51c23]" title="+5% 이상 (상한/급등)" />
                    </>
                  ) : (
                    <>
                      <div className="flex-1 bg-[#e51c23]" title="-5% 이하 (하한/급락)" />
                      <div className="flex-1 bg-[#cc1115]" title="-3%급" />
                      <div className="flex-1 bg-[#b30e13]" title="-2%급" />
                      <div className="flex-1 bg-[#610609]" title="-0.5%급" />
                      <div className="flex-1 bg-[#1f222b]" title="보합" />
                      <div className="flex-1 bg-[#064421]" title="+0.5%급" />
                      <div className="flex-1 bg-[#0e833f]" title="+2%급" />
                      <div className="flex-1 bg-[#00a844]" title="+3%급" />
                      <div className="flex-1 bg-[#00df5a]" title="+5% 이상 (상한/급등)" />
                    </>
                  )}
                </div>
                <span className="text-[10px] font-bold text-gray-400">상승 (≥ +5%)</span>
              </div>

              {/* Status info or search result feedback */}
              <div className="text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                {isTreemapLoading ? (
                  <span className="text-blue-500 animate-pulse">Syncing Heatmap...</span>
                ) : filteredTreemapData[0]?.children ? (
                  <span>전체 {filteredTreemapData[0].children.length}개 종목</span>
                ) : (
                  <span>Ready</span>
                )}
              </div>
            </div>

            {/* Treemap Content Area */}
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 w-full items-stretch">
              <div className="xl:col-span-3 min-h-[460px] w-full bg-[#0b0e14] rounded-xl relative overflow-hidden border border-slate-800/80 shadow-inner flex items-center justify-center p-1">
                {isTreemapLoading && marketStocks.length === 0 ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-3 bg-[#0b0e14]/95 z-20">
                    <RefreshCw size={24} className="animate-spin text-blue-500" />
                    <span className="text-xs font-bold tracking-widest uppercase text-slate-200">Loading Market Capitalizations...</span>
                  </div>
                ) : null}

                {/* Real interactive Custom CSS Treemap */}
                {filteredTreemapData[0]?.children && filteredTreemapData[0].children.length > 0 ? (
                  <div className="w-full h-full flex flex-col justify-between p-2">
                    <div className="w-full h-[430px]">
                      <TreemapComponent
                        data={filteredTreemapData[0].children}
                        colorMode={treemapColorMode}
                        hoveredStockCode={hoveredStock ? hoveredStock.code : null}
                        onHoverStock={setHoveredStock}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 px-2 pb-1 flex justify-between items-center bg-[#0b0e14] mt-2">
                      <span>※ 종목 상세구분(KOSPI/KOSDAQ)은 우측 <b>Stock Specification</b> 패널에서 확인 가능합니다.</span>
                      <span>선택한 개수(Top {treemapLimit})의 시가총액 상위 종목들만 정밀 시각화합니다.</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-400 text-xs font-semibold py-20 flex flex-col items-center gap-2">
                    <span>표시할 한국 주식 데이터가 없습니다.</span>
                  </div>
                )}
              </div>

              {/* Hover stock details board card */}
              <div className="xl:col-span-1 bg-gray-50 border border-gray-100 rounded-xl p-5 flex flex-col justify-between shadow-xs">
                <div>
                  <h4 className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-4">Stock Specification</h4>
                  <AnimatePresence mode="wait">
                    {hoveredStock ? (
                      <motion.div
                        key={hoveredStock.code}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        transition={{ duration: 0.15 }}
                        className="space-y-4"
                      >
                        <div>
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[8px] font-extrabold tracking-widest uppercase mr-1.5",
                            hoveredStock.sosok === '0' || String(hoveredStock.sosok).includes('KOSPI') || String(hoveredStock.sosok).trim() === '001'
                              ? "bg-blue-100 text-blue-800"
                              : "bg-emerald-100 text-emerald-800"
                          )}>
                            {hoveredStock.sosok === '0' || String(hoveredStock.sosok).includes('KOSPI') || String(hoveredStock.sosok).trim() === '001' ? 'KOSPI' : 'KOSDAQ'}
                          </span>
                          <span className="text-xs font-mono text-gray-400">#{hoveredStock.code}</span>
                          <h2 className="text-base font-black tracking-tight text-gray-900 mt-1">{hoveredStock.name}</h2>
                        </div>

                        <div className="grid grid-cols-2 gap-3 py-3 border-y border-gray-200/60">
                          <div>
                            <span className="text-[9px] font-bold text-gray-400 block uppercase">Price</span>
                            <span className="text-base font-extrabold text-gray-800">{formatNumber(hoveredStock.closePrice)} 원</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-gray-400 block uppercase">Fluctuation</span>
                            <span className={cn(
                              "text-base font-extrabold flex items-center gap-0.5",
                              hoveredStock.fluctuationsRatio > 0 ? "text-emerald-600" : hoveredStock.fluctuationsRatio < 0 ? "text-rose-600" : "text-gray-500"
                            )}>
                              {hoveredStock.fluctuationsRatio > 0 ? '▲' : hoveredStock.fluctuationsRatio < 0 ? '▼' : '■'}{' '}
                              {hoveredStock.fluctuationsRatio.toFixed(2)}%
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2 pt-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-400">Market Cap (시가총액)</span>
                            <span className="font-bold text-gray-700">
                              {hoveredStock.marketValueAmount >= 10000 
                                ? `${(hoveredStock.marketValueAmount / 10000).toFixed(1)}조 원` 
                                : `${formatNumber(hoveredStock.marketValueAmount)}억 원`}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-400">Daily Change (대비)</span>
                            <span className="font-mono font-medium text-gray-600">
                              {hoveredStock.changeValue > 0 ? `+${formatNumber(hoveredStock.changeValue)}` : hoveredStock.changeValue < 0 ? `-${formatNumber(Math.abs(hoveredStock.changeValue))}` : '0'} 원
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <div className="py-12 text-center text-gray-400 space-y-2">
                        <div className="text-2xl">🗺️</div>
                        <p className="text-xs font-semibold">마우스 커서를 지도 타일 위에 올리면 종목별 상세정보(가격, 등락율, 시가총액)가 표시됩니다.</p>
                      </div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="mt-8 pt-4 border-t border-gray-100 text-[10px] text-gray-400 text-center flex flex-col gap-1.5">
                  <div className="flex justify-center items-center gap-4">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                      KOSPI
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                      KOSDAQ
                    </span>
                  </div>
                  <p className="font-medium text-[9px] mt-2">※ 실시간 시가총액 기준 정렬 상위 그룹 시각화</p>
                </div>
              </div>
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
