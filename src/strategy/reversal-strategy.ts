export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

import { config } from '../config';

export interface ReversalSignal {
  detected: boolean;
  reason?: string;
  strength?: number;
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

// Check if at local bottom
function isLocalBottom(candles: Candle[], lookback: number = 5): boolean {
  if (candles.length < lookback) return false;
  
  const recentCandles = candles.slice(-lookback);
  const currentLow = recentCandles[recentCandles.length - 1].low;
  const lowestOfRecent = Math.min(...recentCandles.map(c => c.low));
  
  return currentLow === lowestOfRecent;
}

// Check for green candle
function isGreenCandle(candle: Candle): boolean {
  return candle.close > candle.open;
}

// Check for volume spike
function hasVolumeSpike(candles: Candle[], multiplier: number = 1.5): boolean {
  if (candles.length < config.strategy.volumeLookback + 1) return false;
  
  const recent = candles.slice(-config.strategy.volumeLookback - 1, -1);
  const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
  const currentVolume = candles[candles.length - 1].volume;
  
  return currentVolume >= avgVolume * multiplier;
}

// Check if above EMA
function isPriceAboveEMA(candles: Candle[], period: number = 20): boolean {
  if (candles.length < period) return true;
  
  const recent = candles.slice(-period);
  const ema = recent.reduce((sum, c) => sum + c.close, 0) / period;
  const currentPrice = candles[candles.length - 1].close;
  
  return currentPrice > ema;
}

// MAIN REVERSAL DETECTION
export function detectReversal(candles: Candle[]): ReversalSignal {
  if (candles.length < 20) {
    return { detected: false, reason: 'Not enough data' };
  }
  
  const currentCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  
  // 1. At local bottom?
  const atBottom = isLocalBottom(candles, 5);
  if (!atBottom) {
    return { detected: false, reason: 'Not at local bottom' };
  }
  
  // 2. RSI oversold and climbing?
  const rsi = calculateRSI(candles);
  const prevRsi = calculateRSI(candles.slice(0, -1));
  
  if (rsi >= 35) {
    return { detected: false, reason: `RSI not oversold (${rsi.toFixed(1)})` };
  }
  
  if (rsi <= prevRsi) {
    return { detected: false, reason: 'RSI not climbing' };
  }
  
  // 3. Green candle?
  if (!isGreenCandle(currentCandle)) {
    return { detected: false, reason: 'Waiting for green candle' };
  }
  
  // 4. Volume spike?
  if (!hasVolumeSpike(candles, config.strategy.volumeMultiplier)) {
    return { detected: false, reason: 'No volume spike' };
  }
  
  // 5. Above EMA?
  if (!isPriceAboveEMA(candles, 15)) {
    return { detected: false, reason: 'Below EMA (downtrend)' };
  }
  
  // ALL CONDITIONS MET!
  const strength = Math.min(1, ((35 - rsi) / 10 + (rsi - prevRsi) / 5) / 2);
  
  return {
    detected: true,
    reason: `Reversal! RSI ${rsi.toFixed(1)} climbing from ${prevRsi.toFixed(1)}`,
    strength: Math.max(0, Math.min(1, strength))
  };
}
