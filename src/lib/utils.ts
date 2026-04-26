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
