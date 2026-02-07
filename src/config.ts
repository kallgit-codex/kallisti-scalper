// Kallisti's Reversal Scalper - Tuned for 30-min cron execution
// Wider targets + stops to survive between runs

export type TradingMode = "paper" | "live";

const env = process.env;

export const config = {
  tradingMode: (env.TRADING_MODE as TradingMode) || "paper",
  symbol: env.TARGET_SYMBOL || "BTCUSDT",
  candleInterval: "5m",        // CHANGED: 5m candles for 30-min execution
  candleLimit: 50,
  
  dataSource: {
    provider: "binance",
    baseUrl: env.DATA_BASE_URL || "https://api.binance.us",
  },
  
  futures: {
    leverage: Number(env.LEVERAGE || 20),
    maxPositions: 2,
  },
  
  strategy: {
    // WIDER targets for 30-min holds
    minProfitDollars: 3,        // LOWERED: Take $3+ profits (was $8)
    maxProfitDollars: 100,      // RAISED: Let winners run (was $70)
    targetProfitPercent: 0.35,  // WIDER: 0.35% target (was 0.15%) 
    
    // WIDER stops - survive 30-min gaps
    initialStopPercent: 0.50,   // WIDER: 0.50% stop (was 0.25%) 
    recoveryStopPercent: 0.40,
    
    // LONGER time limits for 30-min cron
    maxTradeSeconds: 3600,      // RAISED: 1 hour max (was 180s)
    quickExitSeconds: 900,      // RAISED: 15 min quick exit (was 120s)
    recoveryTimeSeconds: 600,
    
    // Momentum on 5m candles
    momentumCandles: 3,
    momentumThreshold: 0.12,    // RAISED: 0.12% for 5m candles (was 0.08%)
    
    // Volume
    volumeMultiplier: 1.3,     // LOWERED: less restrictive (was 1.5)
    volumeLookback: 20,
    
    // Volatility
    minVolatilityPercent: 0.15, // RAISED slightly for 5m
  },
  
  risk: {
    initialBalance: 2000,
    positionSizeDollars: 25,    // LOWERED: $25 per trade (was $30)
    riskPerTrade: 25,
    maxDailyLossPercent: 3,     // TIGHTER daily loss limit
    maxDailyLossDollars: 60,    // TIGHTER (was $80)
    maxConsecutiveLosses: 4,    // RAISED: Allow more attempts (was 3)
    pauseAfterLossesMinutes: 60, // LONGER pause (was 30)
    maxTradesPerHour: 8,        // LOWERED: quality over quantity
    maxOpenRiskDollars: 75,
  },
  
  ledgerPath: "./data/ledger.json",
};
