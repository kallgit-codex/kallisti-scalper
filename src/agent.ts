// MOMENTUM RIDER - See it moving, ride it, grab $20, get out.

import { config } from "./config";
import { log, error } from "./logger";
import { BinanceClient } from "./exchange/binance";
import { detectMomentum, Candle } from "./strategy/momentum-strategy";
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

let lastSignalTime = 0;
const MIN_SIGNAL_INTERVAL = 30000; // 30 sec cooldown between trades

async function main() {
  log("\n⚡ MOMENTUM RIDER Running");
  
  const client = new BinanceClient(config.dataSource.baseUrl);
  const ledger = new Ledger();
  await ledger.load();
  
  // Daily reset
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
    // 1-minute candles for speed
    const klines = await client.getKlines(
      config.symbol,
      config.candleInterval,
      config.candleLimit
    );
    const candles = normalizeCandles(klines.list);
    const currentPrice = candles[candles.length - 1].close;
    
    // Check open positions first
    const openBefore = [...ledger.openPositions];
    for (const position of openBefore) {
      const update = updatePosition(position, currentPrice);
      
      if (update.shouldClose) {
        const closed = await ledger.closePosition(
          position.id,
          update.exitPrice!,
          update.reason!
        );
        
        const pnl = closed?.pnl || 0;
        const emoji = pnl >= 0 ? "💰" : "💸";
        const timeElapsed = ((closed?.exitTime || 0) - (closed?.entryTime || 0)) / 1000;
        log(`${emoji} CLOSED ${position.side} $${pnl.toFixed(2)} in ${timeElapsed.toFixed(0)}s | ${closed?.reason}`);
      }
    }
    
    // Status
    const stats = ledger.stats;
    const posSize = (config.risk.positionSizeDollars * config.futures.leverage).toFixed(0);
    log(`💎 $${ledger.state.balance.toFixed(2)} | Day: $${stats.dailyPnl} | ${stats.totalTrades} trades (${stats.winRate}% W) | Pos size: $${posSize}`);
    log(`📍 Open: ${ledger.openPositions.length}/${config.futures.maxPositions} | BTC: $${currentPrice.toFixed(2)}`);
    
    // Can we trade?
    const canOpen = ledger.canOpenPosition();
    if (!canOpen.allowed) {
      log(`🛑 ${canOpen.reason}`);
      return;
    }
    
    // Signal cooldown
    if (Date.now() - lastSignalTime < MIN_SIGNAL_INTERVAL) {
      log(`⏳ Cooldown ${Math.round((MIN_SIGNAL_INTERVAL - (Date.now() - lastSignalTime)) / 1000)}s`);
      return;
    }
    
    // DETECT MOMENTUM
    const signal = detectMomentum(candles);
    
    if (!signal.detected) {
      log(`🔍 ${signal.reason}`);
      return;
    }
    
    log(`⚡ ${signal.reason}`);
    
    // OPEN POSITION
    const position = createPosition(
      signal.side!,
      currentPrice,
      config.risk.positionSizeDollars
    );
    
    await ledger.openPosition(position);
    lastSignalTime = Date.now();
    
    const sideEmoji = signal.side === "Long" ? "🟢" : "🔴";
    const targetDollars = (config.risk.positionSizeDollars * config.futures.leverage * config.strategy.targetProfitPercent / 100).toFixed(2);
    const stopDollars = (config.risk.positionSizeDollars * config.futures.leverage * config.strategy.initialStopPercent / 100).toFixed(2);
    log(`${sideEmoji} ${signal.side} $${posSize} @ $${currentPrice.toFixed(2)} | Target: +$${targetDollars} | Stop: -$${stopDollars}`);
    
  } catch (err) {
    error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
