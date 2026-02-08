// SNIPER v3.1 - Fee-Aware Exit Logic with Underwater Cut
// ALL thresholds are NET (after $30 round-trip fees deducted)
// Target: 0.25% gross ($93.75) → $63.75 net
// Stop: 0.15% gross (-$56.25) → -$86.25 net
//
// v3.1 CHANGES:
//   - NEW: Underwater cut at 120s if losing > $10 net (avoids timeout-red bleeding)
//   - Quick grab: 30s/$10 (was 45s/$15)
//   - Max hold: 150s (was 180s)

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
  fees?: number;
  grossPnl?: number;
  reason?: string;
}

export interface PositionUpdate {
  shouldClose: boolean;
  reason?: string;
  exitPrice?: number;
}

/** Calculate round-trip fees for a position */
function calcFees(positionSize: number): number {
  const feeRate = config.fees.feeMode === "taker"
    ? config.fees.takerFeePercent
    : config.fees.makerFeePercent;
  return positionSize * (feeRate / 100) * 2;
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
  const fees = calcFees(posSize);
  
  const grossPnlPct = position.side === "Long"
    ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
  const grossPnl = (grossPnlPct / 100) * posSize;
  const netPnl = grossPnl - fees;
  
  // 1. STOP LOSS - hard stop, non-negotiable
  if (position.side === "Long" && currentPrice <= position.stopLoss) {
    return { shouldClose: true, reason: "stop-loss", exitPrice: currentPrice };
  }
  if (position.side === "Short" && currentPrice >= position.stopLoss) {
    return { shouldClose: true, reason: "stop-loss", exitPrice: currentPrice };
  }
  
  // 2. MAX PROFIT - NET $100+ don't be greedy
  if (netPnl >= position.maxProfitTarget) {
    return { shouldClose: true, reason: "max-profit", exitPrice: currentPrice };
  }
  
  // 3. HIT TARGET - NET $25+ after fees (v3.1: was $35)
  if (netPnl >= position.minProfitTarget) {
    return { shouldClose: true, reason: "take-profit", exitPrice: currentPrice };
  }
  
  // 4. QUICK GRAB - after 30s take NET $10+ (v3.1: was 45s/$15)
  if (elapsed >= config.strategy.quickExitSeconds && netPnl >= config.strategy.quickGrabDollars) {
    return { shouldClose: true, reason: "quick-profit", exitPrice: currentPrice };
  }
  
  // 5. BREAKEVEN - after 90s, exit if covering fees (net >= $0)
  if (elapsed >= 90 && netPnl >= 0) {
    return { shouldClose: true, reason: "breakeven-exit", exitPrice: currentPrice };
  }
  
  // 6. UNDERWATER CUT - v3.1 NEW
  // After 120s, if we're losing more than $10 net, cut it. Don't ride to timeout.
  // This was the #1 fix needed — timeout-red exits were avg -$60 losses.
  const underwaterCut = config.strategy.underwaterCutSeconds ?? 120;
  const underwaterMin = config.strategy.underwaterMinLoss ?? -10;
  if (elapsed >= underwaterCut && netPnl < underwaterMin) {
    return { shouldClose: true, reason: "underwater-cut", exitPrice: currentPrice };
  }
  
  // 7. TIMEOUT - 150s max (v3.1: was 180s)
  if (elapsed >= config.strategy.maxTradeSeconds) {
    return {
      shouldClose: true,
      reason: netPnl >= 0 ? "timeout-green" : "timeout-red",
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
  const fees = calcFees(posSize);
  const grossPnlPct = position.side === "Long"
    ? ((exitPrice - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
  const grossPnl = (grossPnlPct / 100) * posSize;
  const netPnl = grossPnl - fees;
  
  return {
    ...position,
    status: "closed",
    exitPrice,
    exitTime: Date.now(),
    pnl: netPnl,
    fees,
    grossPnl,
    reason,
  };
}
