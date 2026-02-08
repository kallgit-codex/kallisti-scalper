// SNIPER v3.1 - Momentum detection wired to config
// v3.1: Now reads thresholds from config instead of hardcoding them
// Entries were too loose — hardcoded 0.02% min move while config said 0.05%

import { config } from "../config";

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

  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  
  // === RULE 1: LAST 2 CANDLES SAME DIRECTION ===
  const currentMove = current.close - current.open;
  const prevMove = prev.close - prev.open;
  
  const bothBullish = currentMove > 0 && prevMove > 0;
  const bothBearish = currentMove < 0 && prevMove < 0;
  
  if (!bothBullish && !bothBearish) {
    const c = currentMove > 0 ? "↑" : currentMove < 0 ? "↓" : "→";
    const p = prevMove > 0 ? "↑" : prevMove < 0 ? "↓" : "→";
    return { 
      detected: false, 
      reason: `Mixed direction (${p}${c}) @ $${current.close.toFixed(2)}`
    };
  }

  // === RULE 2: MEANINGFUL BODY SIZE ===
  const currentBodyPct = Math.abs(currentMove) / current.open * 100;
  if (currentBodyPct < 0.01) {
    return {
      detected: false,
      reason: `Candle too small (${currentBodyPct.toFixed(4)}%) @ $${current.close.toFixed(2)}`
    };
  }

  // === RULE 3: TOTAL 2-CANDLE MOVE IS REAL ===
  // v3.1: Uses config.strategy.momentumThreshold (0.06%) instead of hardcoded 0.02%
  const totalMove = Math.abs(current.close - prev.open);
  const movePct = (totalMove / prev.open) * 100;
  const minMove = config.strategy.momentumThreshold;
  
  if (movePct < minMove) {
    const side = bothBullish ? "Long" : "Short";
    return {
      detected: false,
      reason: `${side} but weak (${movePct.toFixed(3)}% < ${minMove}%) @ $${current.close.toFixed(2)}`
    };
  }

  // === RULE 4: NOT CHASING ===
  // v3.1: Uses config.strategy.maxChasePercent (0.30%) instead of hardcoded 0.35%
  const maxChase = config.strategy.maxChasePercent;
  const move5 = candles.length >= 5 
    ? Math.abs(current.close - candles[candles.length - 5].open) / candles[candles.length - 5].open * 100 
    : movePct;
  
  if (move5 > maxChase) {
    const side = bothBullish ? "Long" : "Short";
    return {
      detected: false,
      reason: `${side} but late (5m move ${move5.toFixed(3)}% > ${maxChase}%) @ $${current.close.toFixed(2)}`
    };
  }

  // === RULE 5: VOLUME NOT DEAD ===
  // v3.1: Uses config.strategy.volumeMultiplier instead of hardcoded 0.5
  const volThreshold = config.strategy.volumeMultiplier;
  const lookback = config.strategy.volumeLookback;
  const avgVol = candles.slice(-lookback, -2).reduce((s, c) => s + c.volume, 0) / (lookback - 2);
  const recentVol = (current.volume + prev.volume) / 2;
  const volRatio = avgVol > 0 ? recentVol / avgVol : 1;
  
  if (volRatio < 0.5) {
    const side = bothBullish ? "Long" : "Short";
    return {
      detected: false,
      reason: `${side} but dead volume (${volRatio.toFixed(2)}x) @ $${current.close.toFixed(2)}`
    };
  }

  // === BONUS: 3rd candle confirmation ===
  const prev2Move = prev2.close - prev2.open;
  const threeInRow = (bothBullish && prev2Move > 0) || (bothBearish && prev2Move < 0);
  
  // === FIRE! ===
  const side = bothBullish ? "Long" : "Short";
  const confidence = threeInRow ? "HIGH" : "MED";
  const strength = threeInRow ? 0.8 : 0.5;

  return {
    detected: true,
    side,
    reason: `🎯 ${side.toUpperCase()} [${confidence}]: ${movePct.toFixed(3)}% move, vol ${volRatio.toFixed(1)}x${threeInRow ? ", 3-candle run" : ""} @ $${current.close.toFixed(2)}`,
    strength,
  };
}
