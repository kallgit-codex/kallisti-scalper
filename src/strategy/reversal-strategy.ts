// SNIPER STRATEGY - Dead simple momentum
// See it moving? Get in. Make $20. Get out.
// No complex indicators. Just: direction + volume + confirmation.

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

import { config } from "../config";

export interface ReversalSignal {
  detected: boolean;
  reason?: string;
  strength?: number;
  side?: "Long" | "Short";
}

export function detectReversal(candles: Candle[]): ReversalSignal {
  if (candles.length < 10) {
    return { detected: false, reason: "Not enough data" };
  }

  const current = candles[candles.length - 1];
  const prev1 = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  const prev3 = candles[candles.length - 4];

  // === RULE 1: DIRECTIONAL MOMENTUM ===
  // Last 3 candles all closing in the same direction
  const move1 = prev1.close - prev1.open;  // 3 candles ago
  const move2 = prev2.close - prev2.open;  // 2 candles ago  
  const move3 = current.close - current.open; // current candle

  const allBullish = move1 > 0 && move2 > 0 && move3 > 0;
  const allBearish = move1 < 0 && move2 < 0 && move3 < 0;

  if (!allBullish && !allBearish) {
    const lastDir = move3 > 0 ? "↑" : move3 < 0 ? "↓" : "→";
    return { 
      detected: false, 
      reason: `No clear direction (candles: ${move1>0?"↑":"↓"} ${move2>0?"↑":"↓"} ${move3>0?"↑":"↓"}) @ $${current.close.toFixed(2)}`
    };
  }

  // === RULE 2: MEANINGFUL MOVEMENT ===
  // The 3-candle run should show real movement, not just noise
  const totalMove = Math.abs(current.close - prev3.open);
  const movePercent = (totalMove / prev3.open) * 100;
  
  if (movePercent < config.strategy.momentumThreshold) {
    return {
      detected: false,
      reason: `Direction clear but move too small (${movePercent.toFixed(4)}% < ${config.strategy.momentumThreshold}%) @ $${current.close.toFixed(2)}`
    };
  }

  // === RULE 3: VOLUME CHECK ===
  // Current volume should be at least average (not dying momentum)
  const lookback = Math.min(config.strategy.volumeLookback, candles.length - 3);
  const pastCandles = candles.slice(-(lookback + 3), -3);
  const avgVolume = pastCandles.reduce((sum, c) => sum + c.volume, 0) / pastCandles.length;
  const currentVolume = current.volume;
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  if (volumeRatio < config.strategy.volumeMultiplier) {
    const side = allBullish ? "Long" : "Short";
    return {
      detected: false,
      reason: `${side} momentum but low volume (${volumeRatio.toFixed(2)}x < ${config.strategy.volumeMultiplier}x) @ $${current.close.toFixed(2)}`
    };
  }

  // === RULE 4: NOT OVEREXTENDED ===
  // Don't jump in at the very end of a run
  // If we've already moved more than 3x our target, we're late
  const maxEntry = config.strategy.targetProfitPercent * 4;
  if (movePercent > maxEntry) {
    const side = allBullish ? "Long" : "Short";
    return {
      detected: false,
      reason: `${side} momentum but overextended (${movePercent.toFixed(3)}% > ${maxEntry}%) - too late @ $${current.close.toFixed(2)}`
    };
  }

  // === ALL CHECKS PASSED - FIRE! ===
  const side = allBullish ? "Long" : "Short";
  const strength = Math.min(1, (movePercent / config.strategy.momentumThreshold) * (volumeRatio / config.strategy.volumeMultiplier) / 4);

  return {
    detected: true,
    side,
    reason: `🎯 ${side.toUpperCase()} SNIPE: 3-candle ${side === "Long" ? "rally" : "dump"} (${movePercent.toFixed(3)}%, vol ${volumeRatio.toFixed(1)}x) @ $${current.close.toFixed(2)}`,
    strength,
  };
}
