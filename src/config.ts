// SNIPER MODE v2 - $500 × 75x = $37,500 position
// 0.053% move = $20 profit = ~$36 BTC price change
// That happens in SECONDS during momentum

export type TradingMode = "paper" | "live";

const env = process.env;

export const config = {
  tradingMode: (env.TRADING_MODE as TradingMode) || "paper",
  symbol: env.TARGET_SYMBOL || "BTCUSDT",
  candleInterval: "1m",
  candleLimit: 30,
  
  dataSource: {
    provider: "binance",
    baseUrl: env.DATA_BASE_URL || "https://data-api.binance.vision",
  },
  
  futures: {
    leverage: 75,                  // 75x - $36 BTC move = $20
    maxPositions: 1,               // One shot at a time
  },
  
  strategy: {
    minProfitDollars: 15,          // Take $15+ 
    maxProfitDollars: 60,          // Lock in $60 max
    targetProfitPercent: 0.053,    // 0.053% = $20 on $37.5k
    
    initialStopPercent: 0.053,     // Equal stop = 1:1 R:R
    recoveryStopPercent: 0.04,
    
    maxTradeSeconds: 180,          // 3 min max hold
    quickExitSeconds: 45,          // Take profit after 45s if green
    recoveryTimeSeconds: 90,
    
    // Momentum - LOOSER to catch more moves
    consecutiveCandles: 2,         // Only need 2 same-direction candles
    momentumThreshold: 0.03,       // 0.03% min move to confirm
    maxChasePercent: 0.25,         // Don't chase if already moved 0.25%
    
    volumeMultiplier: 0.8,         // Volume just needs to not be dead
    volumeLookback: 10,
    
    minVolatilityPercent: 0.02,
  },
  
  risk: {
    initialBalance: 2003,
    positionSizeDollars: 500,      // $500 collateral per shot
    riskPerTrade: 500,
    maxDailyLossPercent: 5,
    maxDailyLossDollars: 100,      // 5 bad trades = done
    maxConsecutiveLosses: 3,       // 3 in a row = 30min break
    pauseAfterLossesMinutes: 30,
    maxTradesPerHour: 6,           // Up to 6/hr
    maxOpenRiskDollars: 500,
  },
  
  ledgerPath: "./data/ledger.json",
};
