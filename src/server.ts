// Railway Deployment - Continuous Trading Loop
// Scans every 30 seconds instead of waiting for GitHub Actions cron

import { config } from "./config";
import { log, error } from "./logger";
import { BinanceClient } from "./exchange/binance";
import { detectMomentum, Candle } from "./strategy/momentum-strategy";
import { createPosition, updatePosition } from "./risk/recovery-manager";
import { Ledger } from "./ledger";
import { GitHubSync } from "./github-sync";

const SCAN_INTERVAL_MS = 30_000; // 30 seconds
const GITHUB_SYNC_INTERVAL_MS = 300_000; // 5 minutes
const HEALTH_PORT = parseInt(process.env.PORT || "3000");

let lastSignalTime = 0;
const MIN_SIGNAL_INTERVAL = 30_000;
let scanCount = 0;
let lastGitHubSync = 0;
let isRunning = true;

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

async function scan(client: BinanceClient, ledger: Ledger, ghSync: GitHubSync) {
  scanCount++;
  const scanId = `#${scanCount}`;
  
  try {
    // Daily reset check
    const now = new Date();
    const lastReset = new Date(ledger.state.lastReset);
    if (now.getUTCDate() !== lastReset.getUTCDate()) {
      const stats = ledger.stats;
      log(`
📊 DAILY SUMMARY (${lastReset.toLocaleDateString()})`);
      log(`   Balance: $${ledger.state.balance.toFixed(2)}`);
      log(`   P&L: $${stats.dailyPnl} (${stats.dailyPnlPercent}%)`);
      log(`   Trades: ${stats.totalTrades} (${stats.wins}W/${stats.losses}L)`);
      log(`   Win Rate: ${stats.winRate}%`);
      ledger.resetDaily();
      await ledger.save();
      await ghSync.pushLedger();
    }

    // Get candles
    const klines = await client.getKlines(
      config.symbol,
      config.candleInterval,
      config.candleLimit
    );
    const candles = normalizeCandles(klines.list);
    const currentPrice = candles[candles.length - 1].close;

    // Check open positions
    const openBefore = [...ledger.openPositions];
    let positionClosed = false;
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
        positionClosed = true;
      }
    }

    // Sync to GitHub after closing a position
    if (positionClosed) {
      await ghSync.pushLedger();
    }

    // Status (every 10th scan to reduce noise)
    if (scanCount % 10 === 0 || positionClosed) {
      const stats = ledger.stats;
      const posSize = (config.risk.positionSizeDollars * config.futures.leverage).toFixed(0);
      log(`${scanId} 💎 $${ledger.state.balance.toFixed(2)} | Day: $${stats.dailyPnl} | ${stats.totalTrades} trades (${stats.winRate}% W) | BTC: $${currentPrice.toFixed(2)}`);
    }

    // Can we trade?
    const canOpen = ledger.canOpenPosition();
    if (!canOpen.allowed) {
      if (scanCount % 20 === 0) log(`${scanId} 🛑 ${canOpen.reason}`);
      return;
    }

    // Signal cooldown
    if (Date.now() - lastSignalTime < MIN_SIGNAL_INTERVAL) {
      return;
    }

    // DETECT MOMENTUM
    const signal = detectMomentum(candles);
    if (!signal.detected) {
      // Only log signal misses every 10th scan
      if (scanCount % 10 === 0) log(`${scanId} 🔍 ${signal.reason}`);
      return;
    }

    log(`${scanId} ⚡ ${signal.reason}`);

    // OPEN POSITION
    const position = createPosition(
      signal.side!,
      currentPrice,
      config.risk.positionSizeDollars
    );

    await ledger.openPosition(position);
    lastSignalTime = Date.now();

    const sideEmoji = signal.side === "Long" ? "🟢" : "🔴";
    const posSize = (config.risk.positionSizeDollars * config.futures.leverage).toFixed(0);
    const targetDollars = (config.risk.positionSizeDollars * config.futures.leverage * config.strategy.targetProfitPercent / 100).toFixed(2);
    log(`${sideEmoji} ${signal.side} $${posSize} @ $${currentPrice.toFixed(2)} | Target: +$${targetDollars}`);

    // Sync to GitHub after opening
    await ghSync.pushLedger();

  } catch (err) {
    error(`${scanId} Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function startHealthServer() {
  const server = Bun.serve({
    port: HEALTH_PORT,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({
          status: "running",
          scans: scanCount,
          uptime: process.uptime(),
          mode: config.tradingMode,
        }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.pathname === "/stats") {
        // Will be populated after ledger loads
        return new Response(JSON.stringify({ message: "Use /health" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Kallisti Scalper 🎯", { status: 200 });
    },
  });
  log(`🌐 Health server on port ${HEALTH_PORT}`);
  return server;
}

async function main() {
  log("
🚀 MOMENTUM RIDER - Railway Continuous Mode");
  log(`   Scan interval: ${SCAN_INTERVAL_MS / 1000}s`);
  log(`   Mode: ${config.tradingMode}`);
  log(`   Symbol: ${config.symbol}`);
  log(`   Leverage: ${config.futures.leverage}x`);

  // Start health server (Railway needs this)
  await startHealthServer();

  const client = new BinanceClient(config.dataSource.baseUrl);
  const ledger = new Ledger();
  const ghSync = new GitHubSync();

  // Pull latest ledger from GitHub on startup
  const pulled = await ghSync.pullLedger();
  if (pulled) {
    await ledger.load();
    log(`📥 Loaded ledger from GitHub (balance: $${ledger.state.balance.toFixed(2)})`);
  } else {
    await ledger.load();
    log(`📂 Using local ledger (balance: $${ledger.state.balance.toFixed(2)})`);
  }

  log(`
⚡ Starting scan loop...
`);

  // Main loop
  const loop = async () => {
    while (isRunning) {
      await scan(client, ledger, ghSync);

      // Periodic GitHub sync (every 5 min)
      if (Date.now() - lastGitHubSync > GITHUB_SYNC_INTERVAL_MS) {
        await ghSync.pushLedger();
        lastGitHubSync = Date.now();
      }

      await Bun.sleep(SCAN_INTERVAL_MS);
    }
  };

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    log("⏹️  SIGTERM received, shutting down...");
    isRunning = false;
    await ghSync.pushLedger();
    log("💾 Final ledger synced to GitHub");
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    log("⏹️  SIGINT received, shutting down...");
    isRunning = false;
    await ghSync.pushLedger();
    process.exit(0);
  });

  await loop();
}

main().catch((err) => {
  error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
