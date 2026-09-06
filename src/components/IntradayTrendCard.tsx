import React, { useState, useRef } from 'react';
import { IntradayTrendSummary, FiveMinBlock } from '../lib/intradayTrend';
import { formatNumber, cn } from '../lib/utils';
import { TrendingUp, TrendingDown, Clock, Activity } from 'lucide-react';

interface IntradayTrendCardProps {
  summary: IntradayTrendSummary;
  isKoreanMode?: boolean;
}

export const IntradayTrendCard: React.FC<IntradayTrendCardProps> = ({ summary, isKoreanMode = true }) => {
  const [hoveredBlock, setHoveredBlock] = useState<FiveMinBlock | null>(null);
  const ribbonRef = useRef<HTMLDivElement>(null);

  const handleTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!ribbonRef.current) return;
    const rect = ribbonRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    if (!touch) return;
    const x = touch.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const index = Math.min(summary.blocks.length - 1, Math.max(0, Math.floor(ratio * summary.blocks.length)));
    setHoveredBlock(summary.blocks[index]);
  };

  // When hovering, show the hovered 5-min snapshot; otherwise show current/latest
  const activeBlock = hoveredBlock || summary.blocks.find(b => b.status === 'current') || summary.blocks[summary.blocks.length - 1];
  const activeIntensity = activeBlock ? activeBlock.intensity : summary.currentIntensity;
  const isHovering = Boolean(hoveredBlock);

  const isPositive = activeBlock.cumulativeRate > 0;
  const isNegative = activeBlock.cumulativeRate < 0;

  return (
    <div 
      className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between"
    >
      {/* Top Thin Intensity Accent Line */}
      <div 
        className="absolute top-0 left-0 right-0 h-1 transition-colors duration-300"
        style={{ backgroundColor: summary.currentIntensity.hexColor }}
      />

      {/* Header: Title + Dynamic Value/Rate Display */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-black text-gray-900 tracking-tight">
              {summary.label}
            </h3>
            <span className="text-[11px] font-semibold text-gray-500 flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded">
              <Clock size={11} className="text-gray-400" />
              <span>09:00 ~ 15:30 누적 추세</span>
            </span>
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {isHovering ? (
              <span className="font-semibold text-blue-600">
                [탐색 모드: {hoveredBlock?.time} KST 구간]
              </span>
            ) : (
              <span>5분 단위 전일 대비 누적 등락</span>
            )}
          </div>
        </div>

        {/* Right side: Realtime / Hovered Cumulative Numbers */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-lg font-black text-gray-900 tracking-tight leading-none">
              {formatNumber(activeBlock.val)} <span className="text-xs font-normal text-gray-500">pt</span>
            </div>
            <div className="flex items-center justify-end gap-1.5 mt-1 text-xs font-bold">
              <span className={cn(
                isPositive ? (isKoreanMode ? 'text-rose-600' : 'text-emerald-600') :
                isNegative ? (isKoreanMode ? 'text-blue-600' : 'text-rose-600') : 'text-gray-500'
              )}>
                {isPositive ? '▲' : isNegative ? '▼' : '■'} {isPositive ? '+' : ''}{formatNumber(activeBlock.cumulativeChange)} pt
              </span>
              <span className={cn(
                "px-1.5 py-0.5 rounded text-[11px] font-extrabold",
                isPositive ? (isKoreanMode ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700') :
                isNegative ? (isKoreanMode ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-700') : 'bg-gray-100 text-gray-600'
              )}>
                {isPositive ? '+' : ''}{activeBlock.cumulativeRate.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Level Badge */}
          <span 
            className={cn("text-xs font-extrabold px-2.5 py-1 rounded-lg border shrink-0 transition-colors", activeIntensity.badgeClass)}
          >
            {activeIntensity.label}
          </span>
        </div>
      </div>

      {/* Main Focus: The 5-Minute Cumulative Bar */}
      <div className="space-y-1.5 my-1">
        {/* Bar Track */}
        <div 
          ref={ribbonRef}
          className="relative h-10 w-full bg-gray-100 rounded-lg p-1 border border-gray-200/80 flex items-stretch gap-[1px] cursor-crosshair select-none touch-none shadow-inner"
          onMouseLeave={() => setHoveredBlock(null)}
          onTouchStart={handleTouch}
          onTouchMove={handleTouch}
        >
          {summary.blocks.map((block) => {
            const isHovered = hoveredBlock?.timeIndex === block.timeIndex;
            const isFuture = block.status === 'future';
            const isCurrent = block.status === 'current';

            return (
              <div
                key={block.timeIndex}
                onMouseEnter={() => setHoveredBlock(block)}
                onClick={() => setHoveredBlock(block)}
                className={cn(
                  "flex-1 relative rounded-xs transition-all duration-150",
                  isFuture 
                    ? "bg-gray-200/60 opacity-40 border-dashed border border-gray-300" 
                    : "hover:scale-y-110 hover:z-10",
                  isHovered && "ring-2 ring-gray-900 scale-y-125 z-20 shadow-md",
                  isCurrent && "ring-1.5 ring-amber-400"
                )}
                style={{
                  backgroundColor: isFuture ? undefined : block.intensity.hexColor
                }}
                title={`${block.time} | 누적 ${block.cumulativeRate > 0 ? '+' : ''}${block.cumulativeRate.toFixed(2)}% (${block.intensity.label})`}
              />
            );
          })}
        </div>

        {/* Time Markers */}
        <div className="flex justify-between items-center text-[10px] font-bold text-gray-400 px-0.5">
          <span>09:00</span>
          <span>10:00</span>
          <span>11:00</span>
          <span>12:00</span>
          <span>13:00</span>
          <span>14:00</span>
          <span>15:00</span>
          <span>15:30</span>
        </div>
      </div>

      {/* Minimal Footer: Key Day Extremes & Quick Hint */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-gray-100 text-[11px] text-gray-500">
        <div className="flex items-center gap-3 font-semibold flex-wrap">
          <span className="flex items-center gap-1">
            <TrendingUp size={12} className={isKoreanMode ? "text-rose-500" : "text-emerald-500"} />
            <span>최고</span>
            <b className="text-gray-800">
              {summary.peakRate.rate > 0 ? '+' : ''}{summary.peakRate.rate.toFixed(2)}%
            </b>
            <span className="text-[10px] text-gray-400">({summary.peakRate.time})</span>
          </span>

          <span className="text-gray-200">|</span>

          <span className="flex items-center gap-1">
            <TrendingDown size={12} className={isKoreanMode ? "text-blue-500" : "text-rose-500"} />
            <span>최저</span>
            <b className="text-gray-800">
              {summary.troughRate.rate > 0 ? '+' : ''}{summary.troughRate.rate.toFixed(2)}%
            </b>
            <span className="text-[10px] text-gray-400">({summary.troughRate.time})</span>
          </span>

          <span className="text-gray-200">|</span>

          <span className="flex items-center gap-1">
            <Activity size={12} className="text-amber-500" />
            <span>진폭</span>
            <b className="text-gray-800">{summary.swingRate.toFixed(2)}%p</b>
          </span>
        </div>

        <div className="text-[10px] text-gray-400 hidden sm:block">
          {hoveredBlock ? (
            <span className="font-semibold text-gray-700">
              {hoveredBlock.time} 등락 {hoveredBlock.cumulativeRate > 0 ? '+' : ''}{hoveredBlock.cumulativeRate.toFixed(2)}%
            </span>
          ) : (
            <span>마우스 오버 시 5분 단위 확인</span>
          )}
        </div>
      </div>
    </div>
  );
};
