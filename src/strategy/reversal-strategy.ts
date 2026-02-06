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
  side?: 'Long' | 'Short';
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

// Check if at local bottom or top
function isLocalExtreme(candles: Candle[], lookback: number = 5, type: 'bottom' | 'top'): boolean {
  if (candles.length < lookback) return false;
  
  const recentCandles = candles.slice(-lookback);
  const currentCandle = recentCandles[recentCandles.length - 1];
  
  if (type === 'bottom') {
    const lowestOfRecent = Math.min(...recentCandles.map(c => c.low));
    return currentCandle.low === lowestOfRecent;
  } else {
    const highestOfRecent = Math.max(...recentCandles.map(c => c.high));
    return currentCandle.high === highestOfRecent;
  }
}

// Check for bullish or bearish candle
function isBullishCandle(candle: Candle): boolean {
  return candle.close > candle.open;
}

function isBearishCandle(candle: Candle): boolean {
  return candle.close < candle.open;
}

// Check for volume spike
function hasVolumeSpike(candles: Candle[], multiplier: number = 1.8): boolean {
  if (candles.length < config.strategy.volumeLookback + 1) return false;
  
  const recent = candles.slice(-config.strategy.volumeLookback - 1, -1);
  const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
  const currentVolume = candles[candles.length - 1].volume;
  
  return currentVolume >= avgVolume * multiplier;
}

// Check trend direction using EMA
function getTrendDirection(candles: Candle[], period: number = 20): 'up' | 'down' | 'sideways' {
  if (candles.length < period) return 'sideways';
  
  const recent = candles.slice(-period);
  const ema = recent.reduce((sum, c) => sum + c.close, 0) / period;
  const currentPrice = candles[candles.length - 1].close;
  const priceChange = (currentPrice - ema) / ema;
  
  if (priceChange > 0.001) return 'up';
  if (priceChange < -0.001) return 'down';
  return 'sideways';
}

// MAIN REVERSAL DETECTION - Now supports both longs and shorts
export function detectReversal(candles: Candle[]): ReversalSignal {
  if (candles.length < 20) {
    return { detected: false, reason: 'Not enough data' };
  }
  
  const currentCandle = candles[candles.length - 1];
  const rsi = calculateRSI(candles);
  const prevRsi = calculateRSI(candles.slice(0, -1));
  const trend = getTrendDirection(candles);
  
  // LONG SIGNAL - RSI oversold and climbing
  if (rsi <= 40 && rsi > prevRsi && isLocalExtreme(candles, 5, 'bottom')) {
    if (!isBullishCandle(currentCandle)) {
      return { detected: false, reason: 'Waiting for green candle for long' };
    }
    
    if (!hasVolumeSpike(candles, config.strategy.volumeMultiplier)) {
      return { detected: false, reason: 'No volume spike for long' };
    }
    
    const strength = Math.min(1, ((40 - rsi) / 15 + (rsi - prevRsi) / 5) / 2);
    
    return {
      detected: true,
      side: 'Long',
      reason: `Long reversal! RSI ${rsi.toFixed(1)} climbing from ${prevRsi.toFixed(1)}`,
      strength: Math.max(0, Math.min(1, strength))
    };
  }
  
  // SHORT SIGNAL - RSI overbought and falling
  if (rsi >= 60 && rsi < prevRsi && isLocalExtreme(candles, 5, 'top')) {
    if (!isBearishCandle(currentCandle)) {
      return { detected: false, reason: 'Waiting for red candle for short' };
    }
    
    if (!hasVolumeSpike(candles, config.strategy.volumeMultiplier)) {
      return { detected: false, reason: 'No volume spike for short' };
    }
    
    const strength = Math.min(1, ((rsi - 60) / 15 + (prevRsi - rsi) / 5) / 2);
    
    return {
      detected: true,
      side: 'Short',
      reason: `Short reversal! RSI ${rsi.toFixed(1)} falling from ${prevRsi.toFixed(1)}`,
      strength: Math.max(0, Math.min(1, strength))
    };
  }
  
  return { 
    detected: false, 
    reason: `No reversal signal (RSI: ${rsi.toFixed(1)}, Trend: ${trend})` 
  };
}