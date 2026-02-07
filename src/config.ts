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
    minProfitDollars: 8,      // Minimum $ to take
    maxProfitDollars: 70,      // Force exit at this
    targetProfitPercent: 0.15, // Increased from 0.10 to 0.12 for better profit
    
    // Stop losses - TIGHT
    initialStopPercent: 0.25,  // Reduced from 0.35 to 0.30 for tighter stops
    recoveryStopPercent: 0.22, // Wider for recovery
    
    // Time limits - FAST
    maxTradeSeconds: 180,      // Reduced from 300 to 240 for faster exits
    quickExitSeconds: 120,      // Reduced from 120 to 90 for quicker breakeven exits
    recoveryTimeSeconds: 180,  // 3 minutes to wait for bounce
    
    // Momentum detection (1m only)
    momentumCandles: 3,        // Look at last 3 candles
    momentumThreshold: 0.08,   // 0.05% move = momentum
    
    // Volume confirmation
    volumeMultiplier: 1.5,     // Increased from 1.5 to 1.8 for better volume confirmation
    volumeLookback: 20,
    
    // Volatility filter - don't trade if dead
    minVolatilityPercent: 0.1, // Need at least 0.1% range in last 10 candles
  },
  
  // Risk management
  risk: {
    initialBalance: 2000,
    positionSizeDollars: 30,   // Risk $30 collateral per trade (20x = $600 position)
    riskPerTrade: 30,          // Added missing property
    maxDailyLossPercent: 4,    // Stop at -$80/day
    maxDailyLossDollars: 80,
    maxConsecutiveLosses: 3,   // Reduced from 4 to 3 for better risk control
    pauseAfterLossesMinutes: 30, // Increased from 20 to 30 for longer pause
    maxTradesPerHour: 15,      // Reduced from 30 to 20 for better quality trades
    maxOpenRiskDollars: 90,    // Max $90 in open positions
  },
  
  // Ledger
  ledgerPath: "./data/ledger.json",
};