// SNIPER MODE - High conviction, high collateral, tiny targets
// $500 collateral × 50x = $25,000 position
// 0.08% move = $20 profit. BTC moves $54 and we cash out.

export type TradingMode = "paper" | "live";

const env = process.env;

export const config = {
  tradingMode: (env.TRADING_MODE as TradingMode) || "paper",
  symbol: env.TARGET_SYMBOL || "BTCUSDT",
  candleInterval: "1m",          // 1-minute candles - fastest reads
  candleLimit: 30,
  
  dataSource: {
    provider: "binance",
    baseUrl: env.DATA_BASE_URL || "https://data-api.binance.vision",
  },
  
  futures: {
    leverage: 50,                 // 50x leverage
    maxPositions: 1,              // ONE position at a time - full focus
  },
  
  strategy: {
    // SNIPER TARGETS - tiny moves, big positions
    minProfitDollars: 15,         // Take $15+ profits
    maxProfitDollars: 50,         // Lock in $50 if we get lucky
    targetProfitPercent: 0.08,    // 0.08% = $20 on $25k position
    
    // TIGHT STOPS - equal risk/reward
    initialStopPercent: 0.08,     // 0.08% = $20 loss max
    recoveryStopPercent: 0.06,
    
    // FAST exits - we're in and out
    maxTradeSeconds: 300,         // 5 min absolute max
    quickExitSeconds: 60,         // Take profit after 60s if green
    recoveryTimeSeconds: 120,
    
    // Momentum detection on 1m candles
    momentumCandles: 3,           // Last 3 candles direction
    momentumThreshold: 0.02,      // 0.02% min move to confirm direction
    
    // Volume confirmation
    volumeMultiplier: 1.1,        // Just slightly above average
    volumeLookback: 15,
    
    // Volatility - need SOME movement
    minVolatilityPercent: 0.03,
  },
  
  risk: {
    initialBalance: 2000,
    positionSizeDollars: 500,     // $500 per shot
    riskPerTrade: 500,
    maxDailyLossPercent: 5,       // 5% daily max
    maxDailyLossDollars: 100,     // $100 max daily loss (5 bad trades)
    maxConsecutiveLosses: 3,      // 3 losses in a row = pause
    pauseAfterLossesMinutes: 30,  // 30 min cooldown
    maxTradesPerHour: 4,          // Quality over quantity
    maxOpenRiskDollars: 500,
  },
  
  ledgerPath: "./data/ledger.json",
};
