// Kallisti's Reversal Scalper - Buy The Dip Strategy
// LONGS ONLY: Catch reversals at local bottoms

import { config } from "./config";
import { log, error } from "./logger";
import { BinanceClient } from "./exchange/binance";
import { detectReversal, Candle } from "./strategy/reversal-strategy";
import {
  createPosition,
  updatePosition,
} from "./risk/recovery-manager";
import { Ledger } from "./ledger";

function normalizeCandles(rawKlines: any[]): Candle[] {
  return rawKlines.map((k: any) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function main() {
  log("\n🔄 Kallisti's Reversal Scalper Running");
  
  const client = new BinanceClient(config.dataSource.baseUrl);
  const ledger = new Ledger();
  await ledger.load();
  
  // Check if new day
  const now = new Date();
  const lastReset = new Date(ledger.state.lastReset);
  if (now.getUTCDate() !== lastReset.getUTCDate()) {
    const stats = ledger.stats;
    log(`\n📊 DAILY SUMMARY (${lastReset.toLocaleDateString()})`);
    log(`   Balance: $${ledger.state.balance.toFixed(2)}`);
    log(`   P&L: $${stats.dailyPnl} (${stats.dailyPnlPercent}%)`);
    log(`   Trades: ${stats.totalTrades} (${stats.wins}W/${stats.losses}L)`);
    log(`   Win Rate: ${stats.winRate}%`);
    ledger.resetDaily();
    await ledger.save();
  }
  
  try {
    // Fetch 1m candles
    const klines = await client.getKlines(
      config.symbol,
      config.candleInterval,
      config.candleLimit
    );
    const candles = normalizeCandles(klines.list);
    const currentPrice = candles[candles.length - 1].close;
    
    // Update open positions
    const openBefore = [...ledger.openPositions];
    for (const position of openBefore) {
      const update = updatePosition(position, currentPrice);
      
      if (update.shouldClose) {
        const closed = await ledger.closePosition(
          position.id,
          update.exitPrice!,
          update.reason!
        );
        
        const pnlEmoji = (closed.pnl || 0) >= 0 ? "✅" : "❌";
        const timeElapsed = ((closed.exitTime || 0) - closed.entryTime) / 1000;
        log(`${pnlEmoji} CLOSED (${timeElapsed.toFixed(0)}s): ${position.side} $${closed.pnl?.toFixed(2)} | ${closed.reason}`);
      }
    }
    
    // Display status
    const stats = ledger.stats;
    log(`💰 $${ledger.state.balance.toFixed(2)} | Daily: $${stats.dailyPnl} (${stats.dailyPnlPercent}%) | ${stats.totalTrades} trades (${stats.winRate}% win)`);
    log(`📍 Open: ${ledger.openPositions.length} | Hour: ${ledger.state.tradesThisHour}/${config.risk.maxTradesPerHour}`);
    
    // Check if can trade
    const canOpen = ledger.canOpenPosition();
    if (!canOpen.allowed) {
      log(`🛑 ${canOpen.reason}`);
      return;
    }
    
    // Look for reversal signal (LONGS ONLY)
    const signal = detectReversal(candles);
    
    if (!signal.detected) {
      log(`🔍 ${signal.reason}`);
      return;
    }
    
    log(`🎯 REVERSAL DETECTED: ${signal.reason} (strength: ${(signal.strength! * 100).toFixed(0)}%)`);
    
    // Create LONG position
    const position = createPosition(
      "Long",  // ONLY LONGS!
      currentPrice,
      config.risk.positionSizeDollars
    );
    
    await ledger.openPosition(position);
    
    const posSize = (position.collateral * position.leverage).toFixed(0);
    log(`🚀 LONG $${posSize} (${position.leverage}x) @ $${position.entryPrice.toFixed(2)} | Target: +0.10% ($${(posSize * 0.001).toFixed(2)})`);
    
  } catch (err) {
    error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
