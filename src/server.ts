// Railway Deployment - Continuous Trading Loop v3.2
// NOW READS MARKET BRIEFS from research agent
// Pure code — no LLM inference. Brief = JSON, logic = if/else.

import { config } from "./config";
import { log, error } from "./logger";
import { BinanceClient } from "./exchange/binance";
import { detectMomentum, Candle } from "./strategy/momentum-strategy";
import { createPosition, updatePosition } from "./risk/recovery-manager";
import { Ledger } from "./ledger";
import { GitHubSync } from "./github-sync";
import { getOverrides, getCurrentBrief, ScalperOverrides } from "./brief-reader";

const SCAN_INTERVAL_MS = 30_000;
const GITHUB_SYNC_INTERVAL_MS = 300_000;
const HEALTH_PORT = parseInt(process.env.PORT || "3000");

let lastSignalTime = 0;
const MIN_SIGNAL_INTERVAL = 30_000;
let scanCount = 0;
let lastGitHubSync = 0;
let isRunning = true;
let currentOverrides: ScalperOverrides | null = null;

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
  const scanId = "#" + scanCount;
  
  try {
    // Daily reset check
    const now = new Date();
    const lastReset = new Date(ledger.state.lastReset);
    if (now.getUTCDate() !== lastReset.getUTCDate()) {
      const stats = ledger.stats;
      log("DAILY SUMMARY (" + lastReset.toLocaleDateString() + ")");
      log("   Balance: $" + ledger.state.balance.toFixed(2));
      log("   P&L: $" + stats.dailyPnl + " (net after fees)");
      log("   Trades: " + stats.totalTrades + " (" + stats.wins + "W/" + stats.losses + "L)");
      log("   Win Rate: " + stats.winRate + "%");
      ledger.resetDaily();
      await ledger.save();
      await ghSync.pushLedger();
    }

    // ===== MARKET BRIEF INTEGRATION =====
    // Fetch overrides from research agent (cached, refreshes every 5min)
    const overrides = await getOverrides();
    currentOverrides = overrides;

    const klines = await client.getKlines(
      config.symbol,
      config.candleInterval,
      config.candleLimit
    );
    const candles = normalizeCandles(klines.list);
    const currentPrice = candles[candles.length - 1].close;

    // Check open positions (always — even if trading disabled, manage exits)
    const openBefore = [...ledger.openPositions];
    let positionClosed = false;
    for (const position of openBefore) {
      // Pass override for maxTradeSeconds to tighten exits in certain regimes
      const update = updatePosition(position, currentPrice, overrides.maxTradeSeconds);
      if (update.shouldClose) {
        const closed = await ledger.closePosition(
          position.id,
          update.exitPrice!,
          update.reason!
        );
        
        const pnl = closed?.pnl || 0;
        const fees = (closed as any)?.fees || 0;
        const grossPnl = (closed as any)?.grossPnl || 0;
        const emoji = pnl >= 0 ? "💰" : "💸";
        const timeElapsed = ((closed?.exitTime || 0) - (closed?.entryTime || 0)) / 1000;
        log(emoji + " CLOSED " + position.side + " NET $" + pnl.toFixed(2) + " (gross $" + grossPnl.toFixed(2) + " - $" + fees.toFixed(2) + " fees) in " + timeElapsed.toFixed(0) + "s | " + (closed?.reason || ""));
        positionClosed = true;
      }
    }

    if (positionClosed) {
      await ghSync.pushLedger();
    }

    // Status log every 10 scans
    if (scanCount % 10 === 0 || positionClosed) {
      const stats = ledger.stats;
      const brief = getCurrentBrief();
      const regimeTag = brief ? ` | 📊 ${brief.regime}` : "";
      log(scanId + " 💎 $" + ledger.state.balance.toFixed(2) + " | Day: $" + stats.dailyPnl + " (net) | " + stats.totalTrades + " trades (" + stats.winRate + "% W) | BTC: $" + currentPrice.toFixed(2) + regimeTag);
    }

    // ===== TRADING GATE — Research agent can pause us =====
    if (!overrides.tradingEnabled) {
      if (scanCount % 20 === 0) log(scanId + " 📊 " + overrides.reason);
      return;
    }

    // Can we trade? (risk limits)
    const canOpen = ledger.canOpenPosition();
    if (!canOpen.allowed) {
      if (scanCount % 20 === 0) log(scanId + " 🛑 " + canOpen.reason);
      return;
    }

    // Signal cooldown
    if (Date.now() - lastSignalTime < MIN_SIGNAL_INTERVAL) {
      return;
    }

    // DETECT MOMENTUM — with regime overrides
    const effectiveThreshold = overrides.momentumThreshold || config.strategy.momentumThreshold;
    const effectiveChase = overrides.maxChasePercent || config.strategy.maxChasePercent;
    const signal = detectMomentum(candles, effectiveThreshold, effectiveChase);
    
    if (!signal.detected) {
      if (scanCount % 10 === 0) log(scanId + " 🔍 " + signal.reason);
      return;
    }

    // ===== SIDE FILTER — Research agent can prefer a direction =====
    if (overrides.preferredSide && signal.side !== overrides.preferredSide) {
      if (scanCount % 10 === 0) log(scanId + " 📊 Skipping " + signal.side + " — regime prefers " + overrides.preferredSide);
      return;
    }

    log(scanId + " ⚡ " + signal.reason);

    // OPEN POSITION
    const position = createPosition(
      signal.side!,
      currentPrice,
      config.risk.positionSizeDollars
    );

    await ledger.openPosition(position);
    lastSignalTime = Date.now();

    const feePerSide = config.risk.positionSizeDollars * config.futures.leverage * (config.fees.takerFeePercent / 100);
    const roundTripFee = (feePerSide * 2).toFixed(2);
    const sideEmoji = signal.side === "Long" ? "🟢" : "🔴";
    const posSize = (config.risk.positionSizeDollars * config.futures.leverage).toFixed(0);
    const targetDollars = (config.risk.positionSizeDollars * config.futures.leverage * config.strategy.targetProfitPercent / 100).toFixed(2);
    const brief = getCurrentBrief();
    const regimeNote = brief ? ` [${brief.regime}]` : "";
    log(sideEmoji + " " + signal.side + " $" + posSize + " @ $" + currentPrice.toFixed(2) + " | Target: +$" + targetDollars + " gross | Fees: $" + roundTripFee + regimeNote);

    await ghSync.pushLedger();

  } catch (err) {
    error(scanId + " Error: " + (err instanceof Error ? err.message : String(err)));
  }
}

async function startHealthServer() {
  const server = Bun.serve({
    port: HEALTH_PORT,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        const brief = getCurrentBrief();
        return new Response(JSON.stringify({
          status: "running",
          scans: scanCount,
          uptime: process.uptime(),
          mode: config.tradingMode,
          version: "v3.2-brief-aware",
          regime: brief?.regime || "unknown",
          regimeConfidence: brief?.regimeConfidence || 0,
          tradingEnabled: currentOverrides?.tradingEnabled ?? true,
          overrideReason: currentOverrides?.reason || "",
        }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Kallisti Scalper v3.2 (brief-aware)", { status: 200 });
    },
  });
  log("🌐 Health server on port " + HEALTH_PORT);
  return server;
}

async function main() {
  log("🚀 MOMENTUM RIDER v3.2 - Brief-Aware");
  log("   Scan interval: " + (SCAN_INTERVAL_MS / 1000) + "s");
  log("   Mode: " + config.tradingMode);
  log("   Symbol: " + config.symbol);
  log("   Leverage: " + config.futures.leverage + "x");
  log("   Fees: " + config.fees.takerFeePercent + "% taker per side");
  log("   📊 Reading market briefs from research agent");
  
  const posSize = config.risk.positionSizeDollars * config.futures.leverage;
  const rtFee = posSize * (config.fees.takerFeePercent / 100) * 2;
  log("   Fee per trade: $" + rtFee.toFixed(2) + " on $" + posSize + " position");

  await startHealthServer();

  const client = new BinanceClient(config.dataSource.baseUrl);
  const ledger = new Ledger();
  const ghSync = new GitHubSync();

  const pulled = await ghSync.pullLedger();
  if (pulled) {
    await ledger.load();
    log("📥 Loaded ledger from GitHub (balance: $" + ledger.state.balance.toFixed(2) + ")");
  } else {
    await ledger.load();
    log("📂 Using local ledger (balance: $" + ledger.state.balance.toFixed(2) + ")");
  }

  log("⚡ Starting scan loop...");

  const loop = async () => {
    while (isRunning) {
      try {
        await scan(client, ledger, ghSync);
      } catch (loopErr) {
        error("LOOP ERROR: " + (loopErr instanceof Error ? loopErr.stack || loopErr.message : String(loopErr)));
      }

      if (Date.now() - lastGitHubSync > GITHUB_SYNC_INTERVAL_MS) {
        await ghSync.pushLedger();
        lastGitHubSync = Date.now();
      }

      await Bun.sleep(SCAN_INTERVAL_MS);
    }
  };

  process.on("SIGTERM", async () => {
    log("SIGTERM received, shutting down...");
    isRunning = false;
    await ghSync.pushLedger();
    log("Final ledger synced to GitHub");
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    log("SIGINT received, shutting down...");
    isRunning = false;
    await ghSync.pushLedger();
    process.exit(0);
  });

  await loop();
}

main().catch((err) => {
  error("Fatal: " + (err instanceof Error ? err.stack || err.message : String(err)));
  process.exit(1);
});
