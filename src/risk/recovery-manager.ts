// SNIPER POSITION MANAGER - Get in, get $20, get out
// No complex recovery. No trailing stops. Just clean exits.

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
  const targetPercent = config.strategy.targetProfitPercent / 100;
  
  const stopLoss = side === "Long"
    ? entryPrice * (1 - stopPercent)
    : entryPrice * (1 + stopPercent);
  
  const takeProfit = side === "Long"
    ? entryPrice * (1 + targetPercent)
    : entryPrice * (1 - targetPercent);
  
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
  const timeElapsed = (now - position.entryTime) / 1000;
  const positionSize = position.collateral * position.leverage;
  
  let pnlPercent: number;
  if (position.side === "Long") {
    pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  } else {
    pnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
  }
  const pnl = (pnlPercent / 100) * positionSize;
  
  // 1. STOP LOSS - instant exit
  if (position.side === "Long" && currentPrice <= position.stopLoss) {
    return { shouldClose: true, reason: "stop-loss", exitPrice: currentPrice };
  }
  if (position.side === "Short" && currentPrice >= position.stopLoss) {
    return { shouldClose: true, reason: "stop-loss", exitPrice: currentPrice };
  }
  
  // 2. TAKE PROFIT - we hit our target, grab it
  if (pnl >= position.minProfitTarget) {
    return { shouldClose: true, reason: "take-profit", exitPrice: currentPrice };
  }
  
  // 3. MAX PROFIT - don't be greedy
  if (pnl >= position.maxProfitTarget) {
    return { shouldClose: true, reason: "max-profit", exitPrice: currentPrice };
  }
  
  // 4. QUICK PROFIT - after 30s, take anything above $10
  if (timeElapsed >= 30 && pnl >= 10) {
    return { shouldClose: true, reason: "quick-profit", exitPrice: currentPrice };
  }
  
  // 5. BREAKEVEN EXIT - after 2 min, if we're slightly green, just take it
  if (timeElapsed >= 120 && pnl >= 2) {
    return { shouldClose: true, reason: "breakeven-exit", exitPrice: currentPrice };
  }
  
  // 6. TIMEOUT - 5 min max, cut regardless
  if (timeElapsed >= config.strategy.maxTradeSeconds) {
    return {
      shouldClose: true,
      reason: pnl >= 0 ? "timeout-profit" : "timeout-loss",
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
  const positionSize = position.collateral * position.leverage;
  let pnlPercent: number;
  
  if (position.side === "Long") {
    pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
  } else {
    pnlPercent = ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
  }
  
  const pnl = (pnlPercent / 100) * positionSize;
  
  return {
    ...position,
    status: "closed",
    exitPrice,
    exitTime: Date.now(),
    pnl,
    reason,
  };
}
