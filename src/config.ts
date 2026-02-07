// SNIPER v3 - FEE-AWARE
// $500 × 75x = $37,500 position
// Round-trip fees: $30 (0.08% on $37.5k)
// 
// OLD (broken): 0.053% target = $20 gross - $30 fees = -$10 NET (always loses)
// NEW: 0.25% target = $93.75 gross - $30 fees = $63.75 NET profit
//      0.15% stop  = -$56.25 gross - $30 fees = -$86.25 NET loss
//      At 70% WR: EV = +$18.75/trade
//
// BTC moves needed (at ~$69,500):
//   Target: $174 move (very achievable in 1-3min momentum)
//   Stop:   $104 move (reasonable noise buffer)

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
    leverage: 75,
    maxPositions: 1,
  },
  
  fees: {
    takerFeePercent: 0.04,
    makerFeePercent: 0.02,
    feeMode: "taker" as "taker" | "maker",
  },
  
  strategy: {
    // NET profit targets (after $30 round-trip fees)
    minProfitDollars: 35,          // NET $35+ to close (gross $65+)
    maxProfitDollars: 100,         // NET $100 lock-in (gross $130+)
    quickGrabDollars: 15,          // NET $15+ after 45s = take it
    
    targetProfitPercent: 0.25,     // 0.25% = $93.75 gross → $63.75 net
    initialStopPercent: 0.15,      // 0.15% = $56.25 gross → $86.25 net loss
    recoveryStopPercent: 0.04,
    
    maxTradeSeconds: 180,          // 3 min max hold
    quickExitSeconds: 45,          // Quick grab after 45s
    recoveryTimeSeconds: 90,
    
    // Momentum detection - need stronger signals for bigger targets
    consecutiveCandles: 2,
    momentumThreshold: 0.05,       // 0.05% min move (was 0.03)
    maxChasePercent: 0.40,         // Allow entering up to 0.40% into move (was 0.25)
    
    volumeMultiplier: 0.8,
    volumeLookback: 10,
    
    minVolatilityPercent: 0.03,    // Need slightly more vol (was 0.02)
  },
  
  risk: {
    initialBalance: 2000,
    positionSizeDollars: 500,
    riskPerTrade: 500,
    maxDailyLossPercent: 10,
    maxDailyLossDollars: 200,      // ~2-3 bad trades = done for day
    maxConsecutiveLosses: 3,
    pauseAfterLossesMinutes: 30,
    maxTradesPerHour: 4,           // Fewer, higher-quality trades (was 6)
    maxOpenRiskDollars: 500,
  },
  
  ledgerPath: "./data/ledger.json",
};
