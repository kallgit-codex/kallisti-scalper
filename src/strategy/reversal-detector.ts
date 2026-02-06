// Reversal Detection - Buy the Dip Strategy
import { Candle } from "../types";
import { config } from "../config";

export interface ReversalSignal {
  detected: boolean;
  reason?: string;
  strength?: number; // 0-1, how strong the signal is
}

/**
 * Calculate RSI
 */
function calculateRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 50; // Not enough data
  
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

/**
 * Check if price is at local bottom
 */
function isLocalBottom(candles: Candle[], lookback: number = 5): boolean {
  if (candles.length < lookback) return false;
  
  const recentCandles = candles.slice(-lookback);
  const currentLow = recentCandles[recentCandles.length - 1].low;
  
  // Current candle should have the lowest low of recent candles
  const lowestOfRecent = Math.min(...recentCandles.map(c => c.low));
  
  return currentLow === lowestOfRecent;
}

/**
 * Check if we're seeing a green candle (reversal starting)
 */
function isGreenCandle(candle: Candle): boolean {
  return candle.close > candle.open;
}

/**
 * Check for volume spike
 */
function hasVolumeSpikeSpike(candles: Candle[], multiplier: number = 1.5): boolean {
  if (candles.length < config.strategy.volumeLookback + 1) return false;
  
  const recent = candles.slice(-config.strategy.volumeLookback - 1, -1);
  const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
  const currentVolume = candles[candles.length - 1].volume;
  
  return currentVolume >= avgVolume * multiplier;
}

/**
 * Check if price is above EMA (not in major downtrend)
 */
function isPriceAboveEMA(candles: Candle[], period: number = 20): boolean {
  if (candles.length < period) return true; // Assume OK if not enough data
  
  const recent = candles.slice(-period);
  const ema = recent.reduce((sum, c) => sum + c.close, 0) / period;
  const currentPrice = candles[candles.length - 1].close;
  
  return currentPrice > ema;
}

/**
 * Detect reversal signal
 * 
 * STRATEGY: Buy the dip at local bottoms
 * - Wait for price to make local low
 * - RSI oversold (<35) and climbing
 * - Green candle forming (bounce starting)
 * - Volume spike (real interest)
 * - Not in massive downtrend
 */
export function detectReversal(candles: Candle[]): ReversalSignal {
  if (candles.length < 20) {
    return { detected: false, reason: "Not enough data" };
  }
  
  const currentCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  
  // 1. Must be at local bottom
  const atBottom = isLocalBottom(candles, 5);
  if (!atBottom) {
    return { detected: false, reason: "Not at local bottom" };
  }
  
  // 2. RSI oversold and climbing
  const rsi = calculateRSI(candles);
  const prevRsi = calculateRSI(candles.slice(0, -1));
  const rsiOversold = rsi < 35;
  const rsiClimbing = rsi > prevRsi;
  
  if (!rsiOversold) {
    return { detected: false, reason: `RSI not oversold (${rsi.toFixed(1)})` };
  }
  
  if (!rsiClimbing) {
    return { detected: false, reason: "RSI not climbing" };
  }
  
  // 3. Green candle (reversal starting)
  const greenCandle = isGreenCandle(currentCandle);
  if (!greenCandle) {
    return { detected: false, reason: "Waiting for green candle" };
  }
  
  // 4. Volume spike
  const volumeSpike = hasVolumeSpikeSpike(candles, config.strategy.volumeMultiplier);
  if (!volumeSpike) {
    return { detected: false, reason: "No volume spike" };
  }
  
  // 5. Not in major downtrend
  const aboveEMA = isPriceAboveEMA(candles, 15);
  if (!aboveEMA) {
    return { detected: false, reason: "Below EMA (downtrend)" };
  }
  
  // All conditions met!
  const strength = Math.min(1, (
    (35 - rsi) / 10 +  // More oversold = stronger
    (rsi - prevRsi) / 5  // Faster climb = stronger
  ) / 2);
  
  return {
    detected: true,
    reason: `Reversal! RSI ${rsi.toFixed(1)} climbing, volume ${volumeSpike ? 'yes' : 'no'}`,
    strength: Math.max(0, Math.min(1, strength))
  };
}
