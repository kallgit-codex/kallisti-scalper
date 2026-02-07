// NO RECOVERY MODE - Just tight stops and discipline
import { config } from "../config";

export interface Position {
  id: string;
  side: "Long" | "Short";
  entryPrice: number;
  entryTime: number;
  collateral: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  minProfitTarget: number;
  maxProfitTarget: number;
  status: "open" | "closed";
  exitPrice?: number;
  exitTime?: number;
  pnl?: number;
  reason?: string;
  trailingStop?: number;
}

export interface PositionUpdate {
  shouldClose: boolean;
  reason?: string;
  exitPrice?: number;
}

export function createPosition(
  side: "Long" | "Short",
  entryPrice: number,
  collateral: number
): Position {
  const leverage = config.futures.leverage;
  const stopPercent = config.strategy.initialStopPercent / 100;
  const stopLoss = side === "Long"
    ? entryPrice * (1 - stopPercent)
    : entryPrice * (1 + stopPercent);
  
  const targetPercent = config.strategy.targetProfitPercent / 100;
  const takeProfit = side === "Long"
    ? entryPrice * (1 + targetPercent)
    : entryPrice * (1 - targetPercent);
  
  return {
    id: `pos-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    side,
    entryPrice,
    entryTime: Date.now(),
    collateral,
    leverage,
    stopLoss,
    takeProfit,
    minProfitTarget: config.strategy.minProfitDollars,
    maxProfitTarget: config.strategy.maxProfitDollars,
    status: "open" as const,
  };
}

export function updatePosition(
  position: Position,
  currentPrice: number
): PositionUpdate {
  const now = Date.now();
  const timeElapsed = (now - position.entryTime) / 1000;
  const positionSize = position.collateral * position.leverage;
  
  let pnlPercent: number;
  if (position.side === "Long") {
    pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  } else {
    pnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
  }
  const pnl = (pnlPercent / 100) * positionSize;
  
  // 1. STOP LOSS - Get out NOW
  if (position.side === "Long" && currentPrice <= position.stopLoss) {
    return { shouldClose: true, reason: "stop-loss", exitPrice: currentPrice };
  }
  if (position.side === "Short" && currentPrice >= position.stopLoss) {
    return { shouldClose: true, reason: "stop-loss", exitPrice: currentPrice };
  }
  
  // 2. MAX PROFIT - Lock it in
  if (pnl >= position.maxProfitTarget) {
    return { shouldClose: true, reason: "max-profit", exitPrice: currentPrice };
  }
  
  // 3. TAKE PROFIT
  if (position.side === "Long" && currentPrice >= position.takeProfit) {
    return { shouldClose: true, reason: "take-profit", exitPrice: currentPrice };
  }
  if (position.side === "Short" && currentPrice <= position.takeProfit) {
    return { shouldClose: true, reason: "take-profit", exitPrice: currentPrice };
  }
  
  // 4. MIN PROFIT
  if (pnl >= position.minProfitTarget) {
    return { shouldClose: true, reason: "min-profit", exitPrice: currentPrice };
  }
  
  // 5. TRAILING STOP - Move stop to breakeven after 0.08% profit
  if (pnlPercent >= 0.08 && !position.trailingStop) {
    position.trailingStop = position.entryPrice;
  }
  
  // 5b. Check trailing stop hit (breakeven protection)
  if (position.trailingStop) {
    if (position.side === "Long" && currentPrice <= position.trailingStop) {
      return { shouldClose: true, reason: "trailing-stop-breakeven", exitPrice: currentPrice };
    }
    if (position.side === "Short" && currentPrice >= position.trailingStop) {
      return { shouldClose: true, reason: "trailing-stop-breakeven", exitPrice: currentPrice };
    }
  }
  
  // 6. QUICK EXIT - Only if actually profitable (minimum $0.30 profit to cover fees)
  if (timeElapsed >= config.strategy.quickExitSeconds && pnl >= 0.30) {
    return { shouldClose: true, reason: "quick-exit-profit", exitPrice: currentPrice };
  }
  
  // 7. EXTENDED TIMEOUT - Exit with small loss tolerance only after max time
  if (timeElapsed >= config.strategy.maxTradeSeconds) {
    return {
      shouldClose: true,
      reason: pnl >= 0 ? "timeout-profit" : "timeout-loss",
      exitPrice: currentPrice
    };
  }
  
  // 8. STALE TRADE - If no movement after 150 seconds, exit only if slightly profitable
  if (timeElapsed >= 150 && pnlPercent >= 0.02 && pnlPercent < 0.05) {
    return { shouldClose: true, reason: "stale-exit-profit", exitPrice: currentPrice };
  }
  
  return { shouldClose: false };
}