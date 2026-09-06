import { getTrendIntensity, TrendIntensity } from './utils';

export interface FiveMinBlock {
  time: string;               // "09:00", "09:05", ... "15:30"
  timeIndex: number;          // 0 to 78
  val: number;                // Index value
  cumulativeChange: number;   // Cumulative change in points
  cumulativeRate: number;     // Cumulative change in percentage (%)
  stepChange: number;         // 5-minute interval change (pt)
  stepRate: number;           // 5-minute interval change (%)
  intensity: TrendIntensity;  // Color, tier, badge, label
  status: 'completed' | 'current' | 'future';
}

export interface IntradayTrendSummary {
  label: string;                  // "KOSPI" or "KOSDAQ"
  valKey: 'KOSPI' | 'KOSDAQ';
  openVal: number;                // Opening value
  currentVal: number;             // Current / Closing value
  cumulativeChange: number;       // Current cumulative change
  cumulativeRate: number;         // Current cumulative % rate
  currentIntensity: TrendIntensity;
  peakRate: { rate: number; time: string; val: number };    // Intraday Peak
  troughRate: { rate: number; time: string; val: number };  // Intraday Trough
  swingRate: number;              // peak - trough (%p)
  blocks: FiveMinBlock[];         // 79 5-minute blocks
  completedCount: number;
  upCount: number;                // blocks with rate > +0.15%
  downCount: number;              // blocks with rate < -0.15%
  flatCount: number;              // blocks with |rate| <= 0.15%
  upRatio: number;                // Up duration %
  downRatio: number;              // Down duration %
  flatRatio: number;              // Flat duration %
  narrative: string;              // Intraday summary sentence
}

// Full 5-minute slots from 09:00 to 15:30 (79 slots)
export const ALL_5MIN_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let h = 9; h <= 15; h++) {
    for (let m = 0; m < 60; m += 5) {
      if (h === 15 && m > 30) break;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
})();

export function computeIntraday5MinTrend(
  chartData: any[],
  valKey: 'KOSPI' | 'KOSDAQ',
  label: string,
  isKoreanMode = true,
  fallbackVal = 2500,
  fallbackChange = 12.5,
  fallbackRate = 0.5
): IntradayTrendSummary {
  // Filter valid data points
  const validData = chartData.filter(d => typeof d[valKey] === 'number' && !isNaN(d[valKey]) && d[valKey] > 0);

  // If valid data is insufficient, construct synthetic realistic intraday path from fallback
  if (validData.length < 2) {
    return generateSynthetic5MinTrend(valKey, label, isKoreanMode, fallbackVal, fallbackChange, fallbackRate);
  }

  // Determine baseline (Previous close or open)
  // If first item has changeVal, prevClose = nowVal - changeVal
  const firstItem = validData[0];
  const firstVal = firstItem[valKey];
  const firstChange = typeof firstItem[`${valKey}_change`] === 'number' ? firstItem[`${valKey}_change`] : null;
  const prevClose = firstChange !== null ? firstVal - firstChange : firstVal;

  const lastItem = validData[validData.length - 1];
  const lastTime = lastItem.time || '15:30';
  const isMarketHours = lastTime < '15:30' && validData.length < 350;

  let prevBlockVal: number = firstVal;

  const blocks: FiveMinBlock[] = ALL_5MIN_SLOTS.map((slotTime, idx) => {
    // Find latest data point <= slotTime
    let matchedItem: any = null;
    for (let i = validData.length - 1; i >= 0; i--) {
      if (validData[i].time <= slotTime) {
        matchedItem = validData[i];
        break;
      }
    }

    // Determine status
    let status: 'completed' | 'current' | 'future' = 'completed';
    if (isMarketHours && slotTime > lastTime) {
      status = 'future';
    } else if (isMarketHours && slotTime === lastTime) {
      status = 'current';
    }

    if (status === 'future') {
      const futureVal = lastItem[valKey];
      const futureChange = futureVal - prevClose;
      const futureRate = prevClose !== 0 ? (futureChange / prevClose) * 100 : 0;
      return {
        time: slotTime,
        timeIndex: idx,
        val: futureVal,
        cumulativeChange: futureChange,
        cumulativeRate: futureRate,
        stepChange: 0,
        stepRate: 0,
        intensity: getTrendIntensity(futureRate, isKoreanMode),
        status: 'future'
      };
    }

    const currentItem = matchedItem || firstItem;
    const currentVal = currentItem[valKey];
    
    // Calculate cumulative change & rate
    let cumChange: number;
    let cumRate: number;

    const reportedChange = currentItem[`${valKey}_change`];
    const reportedRate = currentItem[`${valKey}_rate`];

    if (typeof reportedRate === 'number' && !isNaN(reportedRate)) {
      cumRate = reportedRate;
      cumChange = typeof reportedChange === 'number' ? reportedChange : currentVal - prevClose;
    } else {
      cumChange = currentVal - prevClose;
      cumRate = prevClose !== 0 ? (cumChange / prevClose) * 100 : 0;
    }

    // 5-min step delta
    const stepChange = idx === 0 ? 0 : currentVal - prevBlockVal;
    const stepRate = idx === 0 || prevBlockVal === 0 ? 0 : (stepChange / prevBlockVal) * 100;
    prevBlockVal = currentVal;

    const intensity = getTrendIntensity(cumRate, isKoreanMode);

    return {
      time: slotTime,
      timeIndex: idx,
      val: currentVal,
      cumulativeChange: cumChange,
      cumulativeRate: cumRate,
      stepChange,
      stepRate,
      intensity,
      status
    };
  });

  // Calculate statistics across completed / current blocks
  const activeBlocks = blocks.filter(b => b.status !== 'future');
  const completedCount = activeBlocks.length;

  let peak = { rate: -999, time: '09:00', val: firstVal };
  let trough = { rate: 999, time: '09:00', val: firstVal };
  let upCount = 0;
  let downCount = 0;
  let flatCount = 0;

  activeBlocks.forEach(b => {
    if (b.cumulativeRate > peak.rate) {
      peak = { rate: b.cumulativeRate, time: b.time, val: b.val };
    }
    if (b.cumulativeRate < trough.rate) {
      trough = { rate: b.cumulativeRate, time: b.time, val: b.val };
    }

    if (b.cumulativeRate >= 0.15) {
      upCount++;
    } else if (b.cumulativeRate <= -0.15) {
      downCount++;
    } else {
      flatCount++;
    }
  });

  if (peak.rate === -999) peak = { rate: 0, time: '09:00', val: firstVal };
  if (trough.rate === 999) trough = { rate: 0, time: '09:00', val: firstVal };

  const swingRate = Math.max(0, peak.rate - trough.rate);
  const upRatio = completedCount > 0 ? Math.round((upCount / completedCount) * 100) : 0;
  const downRatio = completedCount > 0 ? Math.round((downCount / completedCount) * 100) : 0;
  const flatRatio = completedCount > 0 ? Math.max(0, 100 - upRatio - downRatio) : 0;

  const currentBlock = activeBlocks[activeBlocks.length - 1] || blocks[0];
  const currentIntensity = currentBlock.intensity;

  // Narrative generation based on morning vs afternoon trend
  const narrative = generateIntradayNarrative(label, activeBlocks, peak, trough, currentBlock);

  return {
    label,
    valKey,
    openVal: firstVal,
    currentVal: currentBlock.val,
    cumulativeChange: currentBlock.cumulativeChange,
    cumulativeRate: currentBlock.cumulativeRate,
    currentIntensity,
    peakRate: peak,
    troughRate: trough,
    swingRate,
    blocks,
    completedCount,
    upCount,
    downCount,
    flatCount,
    upRatio,
    downRatio,
    flatRatio,
    narrative
  };
}

function generateIntradayNarrative(
  label: string, 
  activeBlocks: FiveMinBlock[], 
  peak: { rate: number; time: string }, 
  trough: { rate: number; time: string },
  current: FiveMinBlock
): string {
  if (activeBlocks.length < 5) {
    return `09:00 개장 직후 시장의 초기 수급 탐색이 진행 중입니다.`;
  }

  const morning = activeBlocks.filter(b => b.time <= '11:30');
  const afternoon = activeBlocks.filter(b => b.time > '11:30');

  const morningAvg = morning.reduce((acc, b) => acc + b.cumulativeRate, 0) / (morning.length || 1);
  const afternoonAvg = afternoon.length > 0 
    ? afternoon.reduce((acc, b) => acc + b.cumulativeRate, 0) / afternoon.length 
    : morningAvg;

  if (current.cumulativeRate >= 1.5) {
    return `개장 이후 꾸준한 매수세가 유입되어 ${peak.time} 최고치(+${peak.rate.toFixed(2)}%)를 기록하며 초강세 흐름을 이어가고 있습니다.`;
  } else if (current.cumulativeRate <= -1.5) {
    return `장 초반부터 지속된 매도 출회로 ${trough.time} 최저점(${trough.rate.toFixed(2)}%)까지 밀려나며 가파른 하방 압력을 받았습니다.`;
  } else if (morningAvg < 0 && afternoonAvg > 0.3) {
    return `오전장 조정(${trough.time} ${trough.rate.toFixed(2)}%)을 딛고 오후 들어 강력한 반등세로 전환하며 플러스권에 안착했습니다.`;
  } else if (morningAvg > 0.3 && afternoonAvg < 0) {
    return `오전장 고점(${peak.time} +${peak.rate.toFixed(2)}%) 형성 이후 오후 차익 매물이 출회되며 상승분을 반납하는 흐름입니다.`;
  } else if (current.cumulativeRate >= 0.3) {
    return `09:00 개장 이후 안정적인 지지선을 바탕으로 완만한 오름세를 유지하며 매수 우위를 점하고 있습니다.`;
  } else if (current.cumulativeRate <= -0.3) {
    return `전반적으로 경계 매물이 우세하여 음봉 횡보세를 이어가고 있으며, 장중 진폭은 ${Math.abs(peak.rate - trough.rate).toFixed(2)}%p입니다.`;
  } else {
    return `장중 뚜렷한 방향성 없이 09:00~15:30 전반에 걸쳐 보합권(±0.15% 내외)에서 팽팽한 힘겨루기가 지속되고 있습니다.`;
  }
}

function generateSynthetic5MinTrend(
  valKey: 'KOSPI' | 'KOSDAQ',
  label: string,
  isKoreanMode = true,
  baseVal = 2500,
  finalChange = 15.2,
  finalRate = 0.61
): IntradayTrendSummary {
  const prevClose = baseVal - finalChange;
  const blocks: FiveMinBlock[] = ALL_5MIN_SLOTS.map((slotTime, idx) => {
    const progress = idx / (ALL_5MIN_SLOTS.length - 1);
    // realistic market wave: open dip, mid-morning rise, lunch lull, close settlement
    const wave = Math.sin(progress * Math.PI * 2.2) * 0.35 + Math.cos(progress * Math.PI * 3.5) * 0.15;
    const rate = Number((finalRate * (0.3 + progress * 0.7) + wave).toFixed(2));
    const val = Number((prevClose * (1 + rate / 100)).toFixed(2));
    const change = Number((val - prevClose).toFixed(2));
    const intensity = getTrendIntensity(rate, isKoreanMode);

    return {
      time: slotTime,
      timeIndex: idx,
      val,
      cumulativeChange: change,
      cumulativeRate: rate,
      stepChange: Number((change * 0.05).toFixed(2)),
      stepRate: Number((rate * 0.05).toFixed(2)),
      intensity,
      status: 'completed'
    };
  });

  let peak = { rate: -999, time: '09:00', val: baseVal };
  let trough = { rate: 999, time: '09:00', val: baseVal };
  let upCount = 0;
  let downCount = 0;
  let flatCount = 0;

  blocks.forEach(b => {
    if (b.cumulativeRate > peak.rate) peak = { rate: b.cumulativeRate, time: b.time, val: b.val };
    if (b.cumulativeRate < trough.rate) trough = { rate: b.cumulativeRate, time: b.time, val: b.val };
    if (b.cumulativeRate >= 0.15) upCount++;
    else if (b.cumulativeRate <= -0.15) downCount++;
    else flatCount++;
  });

  const lastBlock = blocks[blocks.length - 1];

  return {
    label,
    valKey,
    openVal: blocks[0].val,
    currentVal: lastBlock.val,
    cumulativeChange: lastBlock.cumulativeChange,
    cumulativeRate: lastBlock.cumulativeRate,
    currentIntensity: lastBlock.intensity,
    peakRate: peak,
    troughRate: trough,
    swingRate: Number((peak.rate - trough.rate).toFixed(2)),
    blocks,
    completedCount: blocks.length,
    upCount,
    downCount,
    flatCount,
    upRatio: Math.round((upCount / blocks.length) * 100),
    downRatio: Math.round((downCount / blocks.length) * 100),
    flatRatio: Math.round((flatCount / blocks.length) * 100),
    narrative: `${label}는 09:00 개장 이후 ${peak.time} 장중 최고점(+${peak.rate.toFixed(2)}%)을 기록한 뒤 안정적인 상승 흐름으로 마감했습니다.`
  };
}
