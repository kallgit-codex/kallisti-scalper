// MOMENTUM RIDER CONFIG - High collateral, high leverage, grab $20, get out
export type TradingMode = "paper" | "live";

const env = process.env;

export const config = {
  tradingMode: (env.TRADING_MODE as TradingMode) || "paper",
  symbol: env.TARGET_SYMBOL || "BTCUSDT",
  candleInterval: "1m",        // 1-minute candles - we need speed
  candleLimit: 30,
  
  dataSource: {
    provider: "binance",
    baseUrl: env.DATA_BASE_URL || "https://api.binance.us",
  },
  
  futures: {
    leverage: Number(env.LEVERAGE || 50),   // 50x leverage
    maxPositions: 1,                         // ONE position at a time - focus
  },
  
  strategy: {
    // $20 TARGET - on $25,000 position (500 × 50x), 0.08% = $20
    minProfitDollars: 15,       // Take $15+ if stalling
    maxProfitDollars: 50,       // Let it run to $50 if momentum continues
    targetProfitPercent: 0.10,  // 0.10% = $25 on $25k position
    
    // TIGHT STOP - lose $20 max, get out fast if wrong
    initialStopPercent: 0.08,   // 0.08% = $20 loss on $25k
    recoveryStopPercent: 0.08,
    
    // FAST TIMEOUTS - this is seconds/minutes not hours
    maxTradeSeconds: 120,       // 2 min max hold - if not working, bail
    quickExitSeconds: 45,       // 45 sec - take profit if green
    recoveryTimeSeconds: 60,
    
    // Momentum detection params
    momentumCandles: 3,
    momentumThreshold: 0.04,    // 0.04% move in 3 candles = go
    
    // Volume - not super strict, just needs to be alive
    volumeMultiplier: 0.9,
    volumeLookback: 10,
    
    // Min volatility
    minVolatilityPercent: 0.03,
  },
  
  risk: {
    initialBalance: 2000,
    positionSizeDollars: 500,   // $500 collateral per trade
    riskPerTrade: 500,
    maxDailyLossPercent: 10,    // $200 max daily loss (10 bad trades)
    maxDailyLossDollars: 200,
    maxConsecutiveLosses: 3,    // 3 losses in a row = pause 30 min
    pauseAfterLossesMinutes: 30,
    maxTradesPerHour: 6,        // Max 6 trades/hour - be selective
    maxOpenRiskDollars: 500,
  },
  
  ledgerPath: "./data/ledger.json",
};
