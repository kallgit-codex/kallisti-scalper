// SNIPER v2 - Even simpler. 2 candles same direction + not dead volume = GO
// We only need BTC to move $36 more in our direction. That's nothing.

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
  // Current candle should have a real body, not a tiny doji
  const currentBodyPct = Math.abs(currentMove) / current.open * 100;
  if (currentBodyPct < 0.01) {
    return {
      detected: false,
      reason: `Candle too small (${currentBodyPct.toFixed(4)}%) @ $${current.close.toFixed(2)}`
    };
  }

  // === RULE 3: TOTAL 2-CANDLE MOVE IS REAL ===
  const totalMove = Math.abs(current.close - prev.open);
  const movePct = (totalMove / prev.open) * 100;
  
  if (movePct < 0.02) {
    const side = bothBullish ? "Long" : "Short";
    return {
      detected: false,
      reason: `${side} but weak (${movePct.toFixed(3)}% < 0.02%) @ $${current.close.toFixed(2)}`
    };
  }

  // === RULE 4: NOT CHASING ===
  // Check 5-candle move - if already ran 0.35%+, we're late
  const move5 = candles.length >= 5 
    ? Math.abs(current.close - candles[candles.length - 5].open) / candles[candles.length - 5].open * 100 
    : movePct;
  
  if (move5 > 0.35) {
    const side = bothBullish ? "Long" : "Short";
    return {
      detected: false,
      reason: `${side} but late (5m move ${move5.toFixed(3)}% > 0.35%) @ $${current.close.toFixed(2)}`
    };
  }

  // === RULE 5: VOLUME NOT DEAD ===
  const avgVol = candles.slice(-10, -2).reduce((s, c) => s + c.volume, 0) / 8;
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


