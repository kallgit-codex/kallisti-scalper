// SNIPER v2 EXITS - Fast in, fast out
// $500 × 75x = $37,500 position
// 0.053% = $20. Stop at 0.053% = $20 loss.

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
  const stopPct = config.strategy.initialStopPercent / 100;
  const targetPct = config.strategy.targetProfitPercent / 100;
  
  const stopLoss = side === "Long"
    ? entryPrice * (1 - stopPct)
    : entryPrice * (1 + stopPct);
  
  const takeProfit = side === "Long"
    ? entryPrice * (1 + targetPct)
    : entryPrice * (1 - targetPct);
  
  return {
    id: `snipe-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
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
  const elapsed = (now - position.entryTime) / 1000;
  const posSize = position.collateral * position.leverage;
  
  const pnlPct = position.side === "Long"
    ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
  const pnl = (pnlPct / 100) * posSize;
  
  // 1. STOP LOSS - instant
  if (position.side === "Long" && currentPrice <= position.stopLoss) {
    return { shouldClose: true, reason: "stop-loss", exitPrice: currentPrice };
  }
  if (position.side === "Short" && currentPrice >= position.stopLoss) {
    return { shouldClose: true, reason: "stop-loss", exitPrice: currentPrice };
  }
  
  // 2. HIT TARGET ($15+)
  if (pnl >= position.minProfitTarget) {
    return { shouldClose: true, reason: "take-profit", exitPrice: currentPrice };
  }
  
  // 3. BIG WIN ($60+) - don't get greedy
  if (pnl >= position.maxProfitTarget) {
    return { shouldClose: true, reason: "max-profit", exitPrice: currentPrice };
  }
  
  // 4. QUICK GRAB - after 30s take $8+
  if (elapsed >= 30 && pnl >= 8) {
    return { shouldClose: true, reason: "quick-profit", exitPrice: currentPrice };
  }
  
  // 5. BREAKEVEN - after 90s take $3+
  if (elapsed >= 90 && pnl >= 3) {
    return { shouldClose: true, reason: "breakeven-exit", exitPrice: currentPrice };
  }
  
  // 6. TIMEOUT - 3 min max, cut it
  if (elapsed >= config.strategy.maxTradeSeconds) {
    return {
      shouldClose: true,
      reason: pnl >= 0 ? "timeout-green" : "timeout-red",
      exitPrice: currentPrice
    };
  }
  
  return { shouldClose: false };
}

export function closePosition(
  position: Position,
  exitPrice: number,
  reason: string
): Position {
  const posSize = position.collateral * position.leverage;
  const pnlPct = position.side === "Long"
    ? ((exitPrice - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
  
  return {
    ...position,
    status: "closed",
    exitPrice,
    exitTime: Date.now(),
    pnl: (pnlPct / 100) * posSize,
    reason,
  };
}
