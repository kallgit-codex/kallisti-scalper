// MOMENTUM RIDER - Dead simple. See it moving, ride it, grab $20, get out.
// No fancy indicators. Pure price action + volume.

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MomentumSignal {
  detected: boolean;
  reason?: string;
  strength?: number;
  side?: "Long" | "Short";
}

export function detectMomentum(candles: Candle[]): MomentumSignal {
  if (candles.length < 10) {
    return { detected: false, reason: "Not enough data" };
  }

  // Look at last 5 candles on 1m timeframe
  const last5 = candles.slice(-5);
  const last3 = candles.slice(-3);
  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  // 1. COUNT CONSECUTIVE CANDLES IN SAME DIRECTION
  let bullCount = 0;
  let bearCount = 0;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 5); i--) {
    const c = candles[i];
    if (c.close > c.open) {
      if (bearCount > 0) break; // direction changed
      bullCount++;
    } else if (c.close < c.open) {
      if (bullCount > 0) break;
      bearCount++;
    } else {
      break; // doji = no clear direction
    }
  }

  // 2. MOMENTUM MAGNITUDE - how fast is it moving?
  const move3 = Math.abs(last3[2].close - last3[0].open) / last3[0].open * 100;
  const move5 = Math.abs(last5[4].close - last5[0].open) / last5[0].open * 100;
  
  // 3. VOLUME CONFIRMATION - is volume supporting the move?
  const avgVol10 = candles.slice(-10).reduce((s, c) => s + c.volume, 0) / 10;
  const recentVol = (last3[1].volume + last3[2].volume) / 2;
  const volRatio = avgVol10 > 0 ? recentVol / avgVol10 : 1;

  // 4. ACCELERATION - is the move getting faster? (last candle bigger than previous)
  const lastBody = Math.abs(current.close - current.open);
  const prevBody = Math.abs(prev.close - prev.open);
  const accelerating = lastBody > prevBody * 0.8; // at least 80% as big = still going

  // 5. NOT EXHAUSTED - price hasn't moved too far already (don't chase)
  const tooFar = move5 > 0.5; // if already moved 0.5% in 5 candles, probably late
  
  // --- LONG SIGNAL ---
  // 3+ green candles, decent momentum, volume there, still accelerating, not too late
  if (bullCount >= 3 && move3 >= 0.04 && volRatio >= 0.9 && accelerating && !tooFar) {
    const strength = Math.min(1, (bullCount / 5 + move3 / 0.2 + volRatio / 2) / 3);
    return {
      detected: true,
      side: "Long",
      reason: `MOMENTUM LONG: ${bullCount} green candles, ${(move3).toFixed(3)}% move, vol ${volRatio.toFixed(1)}x, accelerating`,
      strength,
    };
  }

  // --- SHORT SIGNAL ---
  if (bearCount >= 3 && move3 >= 0.04 && volRatio >= 0.9 && accelerating && !tooFar) {
    const strength = Math.min(1, (bearCount / 5 + move3 / 0.2 + volRatio / 2) / 3);
    return {
      detected: true,
      side: "Short",
      reason: `MOMENTUM SHORT: ${bearCount} red candles, ${(move3).toFixed(3)}% move, vol ${volRatio.toFixed(1)}x, accelerating`,
      strength,
    };
  }

  // Debug info
  const dir = bullCount > bearCount ? `${bullCount} bull` : `${bearCount} bear`;
  return {
    detected: false,
    reason: `No momentum (${dir}, move3: ${(move3).toFixed(3)}%, vol: ${volRatio.toFixed(1)}x, accel: ${accelerating})`,
  };
}
