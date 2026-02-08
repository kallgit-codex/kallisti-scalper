// SNIPER v3.1 - TIGHTER EXITS
// $500 × 75x = $37,500 position
// Round-trip fees: $30 (0.08% on $37.5k)
//
// v3.0 PROBLEMS (from 14-trade sample):
//   - timeout-red was #1 loss reason (4 of 6 losses)
//   - Avg win $17 vs avg loss $60 = inverted R:R
//   - Bot held losers to 180s instead of cutting early
//
// v3.1 FIXES:
//   - Underwater cut at 120s (don't ride losers to timeout)
//   - Lower profit targets ($25 net vs $35) to capture more wins
//   - Quicker grab at 30s/$10 instead of 45s/$15
//   - Tighter chase filter (0.30% vs 0.40%)
//   - Stronger signal required (0.06% vs 0.05%)
//   - Timeout reduced 180s → 150s

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
    minProfitDollars: 25,          // v3.1: was 35 → 25. Take winners sooner.
    maxProfitDollars: 100,         // NET $100 lock-in (unchanged)
    quickGrabDollars: 10,          // v3.1: was 15 → 10. $10 net > bleeding to timeout.
    
    targetProfitPercent: 0.25,     // 0.25% = $93.75 gross → $63.75 net
    initialStopPercent: 0.15,      // 0.15% = $56.25 gross → $86.25 net loss
    recoveryStopPercent: 0.04,
    
    maxTradeSeconds: 150,          // v3.1: was 180 → 150. Tighter leash.
    quickExitSeconds: 30,          // v3.1: was 45 → 30. Grab small wins faster.
    recoveryTimeSeconds: 90,
    underwaterCutSeconds: 120,     // v3.1: NEW. If red after 120s, exit immediately.
    underwaterMinLoss: -10,        // v3.1: NEW. Only cut if net < -$10 (avoid cutting near-breakeven)
    
    // Momentum detection - pickier entries
    consecutiveCandles: 2,
    momentumThreshold: 0.06,       // v3.1: was 0.05 → 0.06. Stronger signal only.
    maxChasePercent: 0.30,         // v3.1: was 0.40 → 0.30. Don't chase extended moves.
    
    volumeMultiplier: 0.8,
    volumeLookback: 10,
    
    minVolatilityPercent: 0.03,
  },
  
  risk: {
    initialBalance: 2000,
    positionSizeDollars: 500,
    riskPerTrade: 500,
    maxDailyLossPercent: 10,
    maxDailyLossDollars: 200,
    maxConsecutiveLosses: 3,
    pauseAfterLossesMinutes: 30,
    maxTradesPerHour: 4,
    maxOpenRiskDollars: 500,
  },
  
  ledgerPath: "./data/ledger.json",
};
