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

// Calculate RSI
function calculateRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 50;
  
  const changes = [];
  for (let i = candles.length - period - 1; i < candles.length - 1; i++) {
    changes.push(candles[i + 1].close - candles[i].close);
  }
  
  const gains = changes.filter(c => c > 0);
  const losses = changes.filter(c => c < 0).map(c => Math.abs(c));
  
  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Check volume vs average
function getVolumeRatio(candles: Candle[]): number {
  if (candles.length < config.strategy.volumeLookback + 1) return 1;
  const recent = candles.slice(-config.strategy.volumeLookback - 1, -1);
  const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
  const currentVolume = candles[candles.length - 1].volume;
  return avgVolume > 0 ? currentVolume / avgVolume : 1;
}

// Get trend via EMA
function getTrendDirection(candles: Candle[], period: number = 20): "up" | "down" | "sideways" {
  if (candles.length < period) return "sideways";
  const recent = candles.slice(-period);
  const ema = recent.reduce((sum, c) => sum + c.close, 0) / period;
  const currentPrice = candles[candles.length - 1].close;
  const priceChange = (currentPrice - ema) / ema;
  if (priceChange > 0.002) return "up";
  if (priceChange < -0.002) return "down";
  return "sideways";
}

// SCORING-BASED SIGNAL DETECTION
// Instead of requiring ALL conditions, score them and trade when score >= threshold
export function detectReversal(candles: Candle[]): ReversalSignal {
  if (candles.length < 20) {
    return { detected: false, reason: "Not enough data" };
  }

  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const rsi = calculateRSI(candles);
  const prevRsi = calculateRSI(candles.slice(0, -1));
  const trend = getTrendDirection(candles);
  const volumeRatio = getVolumeRatio(candles);
  const isBullish = current.close > current.open;
  const isBearish = current.close < current.open;
  
  // Price momentum over last 3 candles
  const last3 = candles.slice(-3);
  const momentum3 = (last3[2].close - last3[0].close) / last3[0].close;
  
  // --- LONG SCORING ---
  let longScore = 0;
  let longReasons: string[] = [];
  
  // RSI oversold (core signal)
  if (rsi <= 25) { longScore += 3; longReasons.push(`RSI extreme ${rsi.toFixed(1)}`); }
  else if (rsi <= 35) { longScore += 2; longReasons.push(`RSI oversold ${rsi.toFixed(1)}`); }
  else if (rsi <= 42) { longScore += 1; longReasons.push(`RSI low ${rsi.toFixed(1)}`); }
  
  // RSI turning up (confirmation)
  if (rsi > prevRsi) { longScore += 2; longReasons.push("RSI climbing"); }
  else if (rsi > prevRsi - 1) { longScore += 1; longReasons.push("RSI stabilizing"); }
  
  // Bullish candle
  if (isBullish) { longScore += 1; longReasons.push("green candle"); }
  
  // Volume above average
  if (volumeRatio >= 1.5) { longScore += 2; longReasons.push(`vol ${volumeRatio.toFixed(1)}x`); }
  else if (volumeRatio >= 1.1) { longScore += 1; longReasons.push(`vol ${volumeRatio.toFixed(1)}x`); }
  
  // Momentum turning (not freefall)
  if (momentum3 > 0) { longScore += 1; longReasons.push("momentum up"); }
  
  // Trend context - longs in downtrend need stronger signal
  if (trend === "down") { longScore -= 1; }
  
  // --- SHORT SCORING ---
  let shortScore = 0;
  let shortReasons: string[] = [];
  
  // RSI overbought (core signal)
  if (rsi >= 75) { shortScore += 3; shortReasons.push(`RSI extreme ${rsi.toFixed(1)}`); }
  else if (rsi >= 65) { shortScore += 2; shortReasons.push(`RSI overbought ${rsi.toFixed(1)}`); }
  else if (rsi >= 58) { shortScore += 1; shortReasons.push(`RSI high ${rsi.toFixed(1)}`); }
  
  // RSI turning down
  if (rsi < prevRsi) { shortScore += 2; shortReasons.push("RSI falling"); }
  else if (rsi < prevRsi + 1) { shortScore += 1; shortReasons.push("RSI stalling"); }
  
  // Bearish candle
  if (isBearish) { shortScore += 1; shortReasons.push("red candle"); }
  
  // Volume above average
  if (volumeRatio >= 1.5) { shortScore += 2; shortReasons.push(`vol ${volumeRatio.toFixed(1)}x`); }
  else if (volumeRatio >= 1.1) { shortScore += 1; shortReasons.push(`vol ${volumeRatio.toFixed(1)}x`); }
  
  // Momentum turning down
  if (momentum3 < 0) { shortScore += 1; shortReasons.push("momentum down"); }
  
  // Trend context - shorts in uptrend need stronger signal
  if (trend === "up") { shortScore -= 1; }
  
  // --- SIGNAL THRESHOLD: 4+ points to trade ---
  const THRESHOLD = 3;
  
  if (longScore >= THRESHOLD && longScore >= shortScore) {
    const strength = Math.min(1, longScore / 8);
    return {
      detected: true,
      side: "Long",
      reason: `LONG (score ${longScore}): ${longReasons.join(", ")}`,
      strength,
    };
  }
  
  if (shortScore >= THRESHOLD && shortScore > longScore) {
    const strength = Math.min(1, shortScore / 8);
    return {
      detected: true,
      side: "Short",
      reason: `SHORT (score ${shortScore}): ${shortReasons.join(", ")}`,
      strength,
    };
  }
  
  // Report best scoring side for debugging
  const bestSide = longScore >= shortScore ? "Long" : "Short";
  const bestScore = Math.max(longScore, shortScore);
  const bestReasons = longScore >= shortScore ? longReasons : shortReasons;
  
  return {
    detected: false,
    reason: `No signal (best: ${bestSide} score ${bestScore}/${THRESHOLD} - ${bestReasons.join(", ") || "no factors"}) RSI: ${rsi.toFixed(1)} Trend: ${trend}`,
  };
}


