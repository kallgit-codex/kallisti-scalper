// Kallisti's Gold Strategy - Ported to Crypto
// Core concept: Trend bias + pullback entries + quick exits

import { config } from "../config";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TrendSignal {
  direction: "bullish" | "bearish" | "neutral";
  strength: number;
  emaFast: number;
  emaSlow: number;
}

export interface EntrySignal {
  action: "Long" | "Short" | "Hold";
  confidence: number;
  reason: string;
  price: number;
  rsi: number;
  bbPosition: "upper" | "middle" | "lower";
}

// Calculate EMA
function calculateEMA(prices: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ema;
}

// Calculate RSI
function calculateRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50;
  
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  
  const recentChanges = changes.slice(-period);
  const gains = recentChanges.filter(c => c > 0);
  const losses = recentChanges.filter(c => c < 0).map(c => Math.abs(c));
  
  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Calculate Bollinger Bands
function calculateBollingerBands(prices: number[], period: number, stdDev: number) {
  const recentPrices = prices.slice(-period);
  const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
  
  const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const standardDeviation = Math.sqrt(variance);
  
  return {
    upper: sma + (standardDeviation * stdDev),
    middle: sma,
    lower: sma - (standardDeviation * stdDev),
  };
}

// Average volume
function calculateAvgVolume(candles: Candle[], period: number = 20): number {
  const recent = candles.slice(-period);
  return recent.reduce((sum, c) => sum + c.volume, 0) / period;
}

/**
 * STEP 1: Analyze 15m trend
 * Your insight: "whichever direction it's moving on a grander scale"
 */
export function analyzeTrend(candles15m: Candle[]): TrendSignal {
  const closes = candles15m.map(c => c.close);
  
  const emaFast = calculateEMA(closes, config.strategy.trendEmaFast);
  const emaSlow = calculateEMA(closes, config.strategy.trendEmaSlow);
  
  const diff = ((emaFast - emaSlow) / emaSlow) * 100;
  const strength = Math.abs(diff);
  
  let direction: "bullish" | "bearish" | "neutral";
  
  if (diff > 0.15) {
    direction = "bullish";
  } else if (diff < -0.15) {
    direction = "bearish";
  } else {
    direction = "neutral";
  }
  
  return { direction, strength, emaFast, emaSlow };
}

/**
 * STEP 2: Find entry on 1m pullbacks
 * Your insight: "constant fluctuation of a few dollars in between major movements"
 * Enter in the middle of that fluctuation
 */
export function findEntry(
  candles1m: Candle[],
  trendDirection: "bullish" | "bearish" | "neutral"
): EntrySignal {
  if (trendDirection === "neutral") {
    return {
      action: "Hold",
      confidence: 0,
      reason: "No clear trend",
      price: 0,
      rsi: 50,
      bbPosition: "middle",
    };
  }
  
  const closes = candles1m.map(c => c.close);
  const latestPrice = closes[closes.length - 1];
  const latestCandle = candles1m[candles1m.length - 1];
  
  // Calculate indicators
  const rsi = calculateRSI(closes, config.strategy.rsiPeriod);
  const bb = calculateBollingerBands(
    closes,
    config.strategy.bbPeriod,
    config.strategy.bbStdDev
  );
  const avgVolume = calculateAvgVolume(candles1m, 20);
  
  // Determine BB position
  let bbPosition: "upper" | "middle" | "lower";
  if (latestPrice > bb.upper) bbPosition = "upper";
  else if (latestPrice < bb.lower) bbPosition = "lower";
  else bbPosition = "middle";
  
  // Volume check
  const volumeRatio = latestCandle.volume / avgVolume;
  const hasVolume = volumeRatio >= config.strategy.volumeMultiplier;
  
  let action: "Long" | "Short" | "Hold" = "Hold";
  let confidence = 0;
  let reason = "";
  
  // LONG SETUP (bullish trend + pullback)
  if (trendDirection === "bullish") {
    // Looking for: RSI dipped low, price near lower BB, starting to bounce
    const isPulledBack = rsi < config.strategy.rsiOversold + 5;
    const nearLowerBB = latestPrice <= bb.middle;
    const isBouncing = closes[closes.length - 1] > closes[closes.length - 2];
    
    if (isPulledBack && nearLowerBB && hasVolume) {
      action = "Long";
      confidence = isBouncing ? 85 : 70;
      reason = `Bullish pullback entry (RSI ${rsi.toFixed(0)}, BB ${bbPosition}, vol ${volumeRatio.toFixed(1)}x)`;
    } else if (isPulledBack) {
      reason = `Waiting for volume (${volumeRatio.toFixed(1)}x)`;
    } else {
      reason = `No pullback yet (RSI ${rsi.toFixed(0)})`;
    }
  }
  
  // SHORT SETUP (bearish trend + bounce up)
  else if (trendDirection === "bearish") {
    // Looking for: RSI spiked high, price near upper BB, starting to drop
    const isExtended = rsi > config.strategy.rsiOverbought - 5;
    const nearUpperBB = latestPrice >= bb.middle;
    const isDropping = closes[closes.length - 1] < closes[closes.length - 2];
    
    if (isExtended && nearUpperBB && hasVolume) {
      action = "Short";
      confidence = isDropping ? 85 : 70;
      reason = `Bearish bounce entry (RSI ${rsi.toFixed(0)}, BB ${bbPosition}, vol ${volumeRatio.toFixed(1)}x)`;
    } else if (isExtended) {
      reason = `Waiting for volume (${volumeRatio.toFixed(1)}x)`;
    } else {
      reason = `No bounce yet (RSI ${rsi.toFixed(0)})`;
    }
  }
  
  return {
    action,
    confidence,
    reason,
    price: latestPrice,
    rsi,
    bbPosition,
  };
}
