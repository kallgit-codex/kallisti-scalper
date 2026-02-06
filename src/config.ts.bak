// Kallisti's REAL Strategy - Micro-Scalping The Noise
// Catch constant fluctuations, don't care about trend

export type TradingMode = "paper" | "live";

const env = process.env;

export const config = {
  // Core settings
  tradingMode: (env.TRADING_MODE as TradingMode) || "paper",
  symbol: env.TARGET_SYMBOL || "BTCUSDT",
  candleInterval: "1m",
  candleLimit: 50,
  
  // Exchange
  dataSource: {
    provider: "binance",
    baseUrl: env.DATA_BASE_URL || "https://api.binance.us",
  },
  
  // Futures settings - HIGHER LEVERAGE for micro moves
  futures: {
    leverage: Number(env.LEVERAGE || 20),  // 20x to make $50 moves profitable
    maxPositions: 2,
  },
  
  // MICRO-SCALPING Parameters
  strategy: {
    // Profit targets - YOUR $20-100 range
    minProfitDollars: 20,      // Minimum $ to take
    maxProfitDollars: 70,      // Force exit at this
    targetProfitPercent: 0.10, // 0.15% move on 20x = $30 profit
    
    // Stop losses - TIGHT
    initialStopPercent: 0.35,  // Very tight initial stop
    recoveryStopPercent: 0.22, // Wider for recovery
    
    // Time limits - FAST
    maxTradeSeconds: 300,      // 5 minutes max
    quickExitSeconds: 120,     // Exit at breakeven after 2min if not profitable
    recoveryTimeSeconds: 180,  // 3 minutes to wait for bounce
    
    // Momentum detection (1m only)
    momentumCandles: 3,        // Look at last 3 candles
    momentumThreshold: 0.08,   // 0.05% move = momentum
    
    // Volume confirmation
    volumeMultiplier: 1.5,     // Need 30% above average
    volumeLookback: 20,
    
    // Volatility filter - don't trade if dead
    minVolatilityPercent: 0.1, // Need at least 0.1% range in last 10 candles
  },
  
  // Risk management
  risk: {
    initialBalance: 2000,
    positionSizeDollars: 30,   // Risk $30 collateral per trade (20x = $600 position)
    maxDailyLossPercent: 4,    // Stop at -$80/day
    maxDailyLossDollars: 80,
    maxConsecutiveLosses: 4,   // More tolerance since higher frequency
    pauseAfterLossesMinutes: 20,
    maxTradesPerHour: 30,      // High frequency - 30/hour = 1 every 2min
    maxOpenRiskDollars: 90,    // Max $90 in open positions
  },
  
  // Ledger
  ledgerPath: "./data/ledger.json",
};
