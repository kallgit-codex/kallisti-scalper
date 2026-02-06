// Simple Risk Manager - NO RECOVERY, JUST CUT LOSSES FAST
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

/**
 * Create new position with tight stops
 */
export function createPosition(
  side: "Long" | "Short",
  entryPrice: number,
  collateral: number
): Position {
  const leverage = config.futures.leverage;
  const positionSize = collateral * leverage;
  
  // Tight stop - we're scalping, not hoping
  const stopPercent = config.strategy.initialStopPercent / 100;
  const stopLoss = side === "Long"
    ? entryPrice * (1 - stopPercent)
    : entryPrice * (1 + stopPercent);
  
  // Target profit
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

/**
 * Update position - SIMPLE: Stop hit? Close. Target hit? Close. Timeout? Close.
 * NO RECOVERY. NO HOPING. JUST DISCIPLINE.
 */
export function updatePosition(
  position: Position,
  currentPrice: number
): PositionUpdate {
  const now = Date.now();
  const timeElapsed = (now - position.entryTime) / 1000; // seconds
  
  // Calculate P&L
  const positionSize = position.collateral * position.leverage;
  let pnlPercent: number;
  
  if (position.side === "Long") {
    pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  } else {
    pnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
  }
  
  const pnl = (pnlPercent / 100) * positionSize;
  
  // 1. STOP LOSS HIT - Cut it immediately
  if (position.side === "Long" && currentPrice <= position.stopLoss) {
    return {
      shouldClose: true,
      reason: "stop-loss",
      exitPrice: currentPrice,
    };
  }
  
  if (position.side === "Short" && currentPrice >= position.stopLoss) {
    return {
      shouldClose: true,
      reason: "stop-loss",
      exitPrice: currentPrice,
    };
  }
  
  // 2. MAX PROFIT TARGET - Lock it in
  if (pnl >= position.maxProfitTarget) {
    return {
      shouldClose: true,
      reason: "max-profit",
      exitPrice: currentPrice,
    };
  }
  
  // 3. TAKE PROFIT HIT - Take the win
  if (position.side === "Long" && currentPrice >= position.takeProfit) {
    return {
      shouldClose: true,
      reason: "take-profit",
      exitPrice: currentPrice,
    };
  }
  
  if (position.side === "Short" && currentPrice <= position.takeProfit) {
    return {
      shouldClose: true,
      reason: "take-profit",
      exitPrice: currentPrice,
    };
  }
  
  // 4. MIN PROFIT HIT - Take what you can get
  if (pnl >= position.minProfitTarget) {
    return {
      shouldClose: true,
      reason: "min-profit",
      exitPrice: currentPrice,
    };
  }
  
  // 5. BREAKEVEN EXIT - Been 2 min and not moving? Get out.
  if (timeElapsed >= config.strategy.quickExitSeconds && pnl >= -5) {
    return {
      shouldClose: true,
      reason: "quick-exit-breakeven",
      exitPrice: currentPrice,
    };
  }
  
  // 6. TIMEOUT - 5 minutes max, get out regardless
  if (timeElapsed >= config.strategy.maxTradeSeconds) {
    return {
      shouldClose: true,
      reason: pnl >= 0 ? "timeout-profit" : "timeout-loss",
      exitPrice: currentPrice,
    };
  }
  
  // Hold the position
  return {
    shouldClose: false,
  };
}

/**
 * Close position and calculate final P&L
 */
export function closePosition(
  position: Position,
  exitPrice: number,
  reason: string
): Position & { exitPrice: number; exitTime: number; pnl: number; reason: string } {
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
    exitPrice,
    exitTime: Date.now(),
    pnl,
    status: "closed" as const,
    reason,
  };
}
