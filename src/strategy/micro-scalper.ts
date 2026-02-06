// Kallisti's TRUE Strategy - Trade The Noise
// Catch micro-fluctuations regardless of macro trend

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
  action: "Long" | "Short" | "Hold";
  confidence: number;
  reason: string;
  price: number;
  momentum: number;
  volatility: number;
  volumeRatio: number;
}

/**
 * Calculate momentum - is price moving up or down RIGHT NOW
 */
function calculateMomentum(candles: Candle[]): number {
  const lookback = config.strategy.momentumCandles;
  const recent = candles.slice(-lookback);
  
  const startPrice = recent[0].close;
  const endPrice = recent[recent.length - 1].close;
  
  return ((endPrice - startPrice) / startPrice) * 100;
}

/**
 * Calculate recent volatility - is market moving enough to trade
 */
function calculateVolatility(candles: Candle[], period: number = 10): number {
  const recent = candles.slice(-period);
  const high = Math.max(...recent.map(c => c.high));
  const low = Math.min(...recent.map(c => c.low));
  
  return ((high - low) / low) * 100;
}

/**
 * Calculate average volume
 */
function calculateAvgVolume(candles: Candle[]): number {
  const lookback = config.strategy.volumeLookback;
  const recent = candles.slice(-lookback);
  return recent.reduce((sum, c) => sum + c.volume, 0) / lookback;
}

/**
 * Detect if there's a volume spike
 */
function hasVolumeConfirmation(candles: Candle[]): { confirmed: boolean; ratio: number } {
  const avgVol = calculateAvgVolume(candles);
  const currentVol = candles[candles.length - 1].volume;
  const ratio = currentVol / avgVol;
  
  return {
    confirmed: ratio >= config.strategy.volumeMultiplier,
    ratio,
  };
}

/**
 * MAIN STRATEGY: Find momentum entries
 * Your insight: "constant fluctuation" - just catch whatever's moving
 */
export function findMomentumEntry(candles: Candle[]): MomentumSignal {
  const currentPrice = candles[candles.length - 1].close;
  
  // Calculate indicators
  const momentum = calculateMomentum(candles);
  const volatility = calculateVolatility(candles);
  const volume = hasVolumeConfirmation(candles);
  
  // Check if market is moving enough to trade
  if (volatility < config.strategy.minVolatilityPercent) {
    return {
      action: "Hold",
      confidence: 0,
      reason: `Market too quiet (volatility: ${volatility.toFixed(2)}%)`,
      price: currentPrice,
      momentum: 0,
      volatility,
      volumeRatio: volume.ratio,
    };
  }
  
  // Check for momentum
  const absMomentum = Math.abs(momentum);
  const threshold = config.strategy.momentumThreshold;
  
  if (absMomentum < threshold) {
    return {
      action: "Hold",
      confidence: 0,
      reason: `No momentum (${momentum.toFixed(2)}%, need ${threshold}%)`,
      price: currentPrice,
      momentum,
      volatility,
      volumeRatio: volume.ratio,
    };
  }
  
  // BULLISH MOMENTUM - Price moving up
  if (momentum > threshold) {
    if (!volume.confirmed) {
      return {
        action: "Hold",
        confidence: 0,
        reason: `Bullish momentum but low volume (${volume.ratio.toFixed(1)}x)`,
        price: currentPrice,
        momentum,
        volatility,
        volumeRatio: volume.ratio,
      };
    }
    
    // Check if momentum is strengthening (last candle green)
    const lastCandle = candles[candles.length - 1];
    const isGreen = lastCandle.close > lastCandle.open;
    const confidence = isGreen ? 85 : 70;
    
    return {
      action: "Long",
      confidence,
      reason: `Bullish momentum +${momentum.toFixed(2)}% (vol ${volume.ratio.toFixed(1)}x, volatility ${volatility.toFixed(2)}%)`,
      price: currentPrice,
      momentum,
      volatility,
      volumeRatio: volume.ratio,
    };
  }
  
  // BEARISH MOMENTUM - Price moving down
  if (momentum < -threshold) {
    if (!volume.confirmed) {
      return {
        action: "Hold",
        confidence: 0,
        reason: `Bearish momentum but low volume (${volume.ratio.toFixed(1)}x)`,
        price: currentPrice,
        momentum,
        volatility,
        volumeRatio: volume.ratio,
      };
    }
    
    // Check if momentum is strengthening (last candle red)
    const lastCandle = candles[candles.length - 1];
    const isRed = lastCandle.close < lastCandle.open;
    const confidence = isRed ? 85 : 70;
    
    return {
      action: "Short",
      confidence,
      reason: `Bearish momentum ${momentum.toFixed(2)}% (vol ${volume.ratio.toFixed(1)}x, volatility ${volatility.toFixed(2)}%)`,
      price: currentPrice,
      momentum,
      volatility,
      volumeRatio: volume.ratio,
    };
  }
  
  // Should never reach here
  return {
    action: "Hold",
    confidence: 0,
    reason: "No clear signal",
    price: currentPrice,
    momentum,
    volatility,
    volumeRatio: volume.ratio,
  };
}
