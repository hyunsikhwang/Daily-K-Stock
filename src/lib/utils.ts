import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: string | number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || value === '') return '-';
  const num = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value;
  if (isNaN(num)) return '-';
  return new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function cleanValue(val: any): number | null {
  try {
    if (val === null || val === undefined) return null;
    const s = String(val).replace(/,/g, '').trim();
    if (s === '') return null;
    const f = parseFloat(s);
    return isFinite(f) ? f : null;
  } catch {
    return null;
  }
}

// Korean holidays 2024-2025 (Partial list for logic)
export const KOREAN_HOLIDAYS = [
  '2024-01-01', '2024-02-09', '2024-02-12', '2024-03-01', '2024-04-10', '2024-05-01',
  '2024-05-06', '2024-05-15', '2024-06-06', '2024-08-15', '2024-09-16', '2024-09-17',
  '2024-09-18', '2024-10-03', '2024-10-09', '2024-12-25',
  '2025-01-01', '2025-01-27', '2025-01-28', '2025-02-30', '2025-03-03', '2025-05-01',
  '2025-05-05', '2025-05-06', '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-06',
  '2025-10-07', '2025-10-09', '2025-12-25'
];

export interface TrendIntensity {
  tier: 'SURGE_UP' | 'STRONG_UP' | 'MODERATE_UP' | 'MILD_UP' | 'FLAT' | 'MILD_DOWN' | 'MODERATE_DOWN' | 'STRONG_DOWN' | 'PLUNGE_DOWN';
  direction: 'up' | 'down' | 'flat';
  label: string;
  statusText: string;
  levelText: string;
  level: number; // 1 to 5
  colorClass: string; // Tailwind text color
  badgeClass: string; // Tailwind pill badge classes
  gradientClass: string; // Tailwind gradient background
  hexColor: string; // Pure hex color
  borderClass: string; // Card border accent
  accentBg: string; // Soft background tint
  icon: string;
  gaugePercent: number; // 20% to 100%
  description: string;
}

export function getTrendIntensity(rawRate: number | string | null | undefined, isKoreanMode = true): TrendIntensity {
  let rate = 0;
  if (typeof rawRate === 'number') {
    rate = isNaN(rawRate) ? 0 : rawRate;
  } else if (typeof rawRate === 'string') {
    const cleaned = rawRate.replace(/[+%]/g, '').trim();
    const parsed = parseFloat(cleaned);
    rate = isNaN(parsed) ? 0 : parsed;
  }

  // 1) Upwards (상승)
  if (rate >= 2.0) {
    return {
      tier: 'SURGE_UP',
      direction: 'up',
      label: '급등',
      statusText: '초강세 급등장',
      levelText: '강도 5단계 (급등)',
      level: 5,
      gaugePercent: 100,
      description: '2.0% 이상 폭등하며 강력한 매수세가 집중되고 있습니다',
      icon: '▲▲',
      ...(isKoreanMode ? {
        hexColor: '#b91c1c',
        colorClass: 'text-red-700',
        badgeClass: 'bg-red-100 text-red-800 border border-red-300 font-bold',
        gradientClass: 'bg-[linear-gradient(135deg,#991b1b_0%,#dc2626_55%,#ef4444_100%)]',
        borderClass: 'border-red-500',
        accentBg: 'bg-red-50',
      } : {
        hexColor: '#047857',
        colorClass: 'text-emerald-700',
        badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold',
        gradientClass: 'bg-[linear-gradient(135deg,#064e3b_0%,#059669_55%,#10b981_100%)]',
        borderClass: 'border-emerald-500',
        accentBg: 'bg-emerald-50',
      })
    };
  }

  if (rate >= 1.2) {
    return {
      tier: 'STRONG_UP',
      direction: 'up',
      label: '강한 상승',
      statusText: '뚜렷한 상승세',
      levelText: '강도 4단계 (강세)',
      level: 4,
      gaugePercent: 80,
      description: '1.2%~2.0% 구간의 탄력적인 상승으로 매수 우위가 확실합니다',
      icon: '▲',
      ...(isKoreanMode ? {
        hexColor: '#dc2626',
        colorClass: 'text-rose-600',
        badgeClass: 'bg-rose-100 text-rose-800 border border-rose-200 font-bold',
        gradientClass: 'bg-[linear-gradient(135deg,#dc2626_0%,#ea580c_100%)]',
        borderClass: 'border-rose-400',
        accentBg: 'bg-rose-50/80',
      } : {
        hexColor: '#059669',
        colorClass: 'text-emerald-600',
        badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold',
        gradientClass: 'bg-[linear-gradient(135deg,#059669_0%,#10b981_100%)]',
        borderClass: 'border-emerald-400',
        accentBg: 'bg-emerald-50/80',
      })
    };
  }

  if (rate >= 0.5) {
    return {
      tier: 'MODERATE_UP',
      direction: 'up',
      label: '상승세',
      statusText: '견조한 상승',
      levelText: '강도 3단계 (상승)',
      level: 3,
      gaugePercent: 60,
      description: '0.5%~1.2% 범위에서 안정적이고 견조한 오름세를 유지 중입니다',
      icon: '▲',
      ...(isKoreanMode ? {
        hexColor: '#f43f5e',
        colorClass: 'text-rose-500',
        badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200 font-semibold',
        gradientClass: 'bg-[linear-gradient(135deg,#e11d48_0%,#fb7185_100%)]',
        borderClass: 'border-rose-300',
        accentBg: 'bg-rose-50/60',
      } : {
        hexColor: '#10b981',
        colorClass: 'text-emerald-500',
        badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold',
        gradientClass: 'bg-[linear-gradient(135deg,#10b981_0%,#34d399_100%)]',
        borderClass: 'border-emerald-300',
        accentBg: 'bg-emerald-50/60',
      })
    };
  }

  if (rate >= 0.15) {
    return {
      tier: 'MILD_UP',
      direction: 'up',
      label: '소폭 상승',
      statusText: '완만한 오름세',
      levelText: '강도 2단계 (완만)',
      level: 2,
      gaugePercent: 40,
      description: '0.15%~0.5% 내외의 완만한 상승으로 조심스러운 매수 유입 중입니다',
      icon: '△',
      ...(isKoreanMode ? {
        hexColor: '#fb7185',
        colorClass: 'text-rose-400',
        badgeClass: 'bg-rose-50/70 text-rose-600 border border-rose-200/60',
        gradientClass: 'bg-[linear-gradient(135deg,#f43f5e_0%,#fda4af_100%)]',
        borderClass: 'border-rose-200',
        accentBg: 'bg-rose-50/40',
      } : {
        hexColor: '#34d399',
        colorClass: 'text-emerald-400',
        badgeClass: 'bg-emerald-50/70 text-emerald-600 border border-emerald-200/60',
        gradientClass: 'bg-[linear-gradient(135deg,#34d399_0%,#a7f3d0_100%)]',
        borderClass: 'border-emerald-200',
        accentBg: 'bg-emerald-50/40',
      })
    };
  }

  // 2) Neutral / Flat (보합)
  if (rate > -0.15) {
    return {
      tier: 'FLAT',
      direction: 'flat',
      label: '보합',
      statusText: '보합권 횡보',
      levelText: '강도 1단계 (중립)',
      level: 1,
      gaugePercent: 20,
      description: '±0.15% 이내에서 뚜렷한 방향성 없이 매도·매수 공방 중입니다',
      icon: '―',
      hexColor: '#64748b',
      colorClass: 'text-slate-600',
      badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
      gradientClass: 'bg-[linear-gradient(135deg,#475569_0%,#64748b_100%)]',
      borderClass: 'border-slate-300',
      accentBg: 'bg-slate-50',
    };
  }

  // 3) Downwards (하락)
  if (rate > -0.5) {
    return {
      tier: 'MILD_DOWN',
      direction: 'down',
      label: '소폭 하락',
      statusText: '경미한 조정',
      levelText: '강도 2단계 (완만)',
      level: 2,
      gaugePercent: 40,
      description: '-0.15%~-0.5% 범위에서 완만한 숨고르기 조정을 받고 있습니다',
      icon: '▽',
      ...(isKoreanMode ? {
        hexColor: '#0ea5e9',
        colorClass: 'text-sky-500',
        badgeClass: 'bg-sky-50 text-sky-700 border border-sky-200',
        gradientClass: 'bg-[linear-gradient(135deg,#0284c7_0%,#38bdf8_100%)]',
        borderClass: 'border-sky-300',
        accentBg: 'bg-sky-50/60',
      } : {
        hexColor: '#fb7185',
        colorClass: 'text-rose-400',
        badgeClass: 'bg-rose-50 text-rose-600 border border-rose-200',
        gradientClass: 'bg-[linear-gradient(135deg,#f43f5e_0%,#fda4af_100%)]',
        borderClass: 'border-rose-200',
        accentBg: 'bg-rose-50/40',
      })
    };
  }

  if (rate > -1.2) {
    return {
      tier: 'MODERATE_DOWN',
      direction: 'down',
      label: '하락세',
      statusText: '뚜렷한 하락',
      levelText: '강도 3단계 (하락)',
      level: 3,
      gaugePercent: 60,
      description: '-0.5%~-1.2% 범위에서 매도 압력이 가중되며 하락세가 뚜렷합니다',
      icon: '▼',
      ...(isKoreanMode ? {
        hexColor: '#2563eb',
        colorClass: 'text-blue-600',
        badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold',
        gradientClass: 'bg-[linear-gradient(135deg,#2563eb_0%,#60a5fa_100%)]',
        borderClass: 'border-blue-400',
        accentBg: 'bg-blue-50',
      } : {
        hexColor: '#f43f5e',
        colorClass: 'text-rose-500',
        badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200 font-semibold',
        gradientClass: 'bg-[linear-gradient(135deg,#e11d48_0%,#fb7185_100%)]',
        borderClass: 'border-rose-300',
        accentBg: 'bg-rose-50/60',
      })
    };
  }

  if (rate > -2.0) {
    return {
      tier: 'STRONG_DOWN',
      direction: 'down',
      label: '강한 하락',
      statusText: '가파른 하락세',
      levelText: '강도 4단계 (약세)',
      level: 4,
      gaugePercent: 80,
      description: '-1.2%~-2.0% 구간으로 출회된 매도 물량에 하방 압력이 큽니다',
      icon: '▼',
      ...(isKoreanMode ? {
        hexColor: '#1d4ed8',
        colorClass: 'text-blue-700',
        badgeClass: 'bg-blue-100 text-blue-800 border border-blue-300 font-bold',
        gradientClass: 'bg-[linear-gradient(135deg,#1d4ed8_0%,#3b82f6_100%)]',
        borderClass: 'border-blue-500',
        accentBg: 'bg-blue-50/80',
      } : {
        hexColor: '#dc2626',
        colorClass: 'text-rose-600',
        badgeClass: 'bg-rose-100 text-rose-800 border border-rose-200 font-bold',
        gradientClass: 'bg-[linear-gradient(135deg,#dc2626_0%,#ea580c_100%)]',
        borderClass: 'border-rose-400',
        accentBg: 'bg-rose-50/80',
      })
    };
  }

  // Plunge (급락)
  return {
    tier: 'PLUNGE_DOWN',
    direction: 'down',
    label: '급락',
    statusText: '투매 급락장',
    levelText: '강도 5단계 (급락)',
    level: 5,
    gaugePercent: 100,
    description: '-2.0% 이하로 급락하며 시장 하방 변동성이 크게 확대된 상태입니다',
    icon: '▼▼',
    ...(isKoreanMode ? {
      hexColor: '#1e3a8a',
      colorClass: 'text-blue-900',
      badgeClass: 'bg-blue-100 text-blue-950 border border-blue-400 font-bold',
      gradientClass: 'bg-[linear-gradient(135deg,#0f172a_0%,#1e3a8a_55%,#2563eb_100%)]',
      borderClass: 'border-blue-700',
      accentBg: 'bg-blue-100/50',
    } : {
      hexColor: '#991b1b',
      colorClass: 'text-red-900',
      badgeClass: 'bg-red-100 text-red-950 border border-red-400 font-bold',
      gradientClass: 'bg-[linear-gradient(135deg,#450a0a_0%,#991b1b_55%,#dc2626_100%)]',
      borderClass: 'border-red-700',
      accentBg: 'bg-red-100/50',
    })
  };
}
