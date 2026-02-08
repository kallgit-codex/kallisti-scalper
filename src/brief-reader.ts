// Brief Reader - Consumes market briefs from the research agent
// Reads data/market-brief.json from GitHub data branch every 5 minutes
// Returns parameter overrides for the scalper based on regime analysis
// NO LLM calls — pure deterministic logic

import { config } from "./config";
import { log } from "./logger";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const BRIEF_URL = "https://api.github.com/repos/kallgit-codex/kallisti-scalper/contents/data/market-brief.json?ref=data";
const REFRESH_MS = 5 * 60 * 1000; // Re-fetch every 5 min

export interface MarketBrief {
  timestamp: number;
  generatedAt: string;
  price: number;
  regime: string;
  regimeConfidence: number;
  regimeReason: string;
  volatility: { atr_1h_pct: number; level: string };
  trend: { direction: string; priceVsEma20: number };
  orderbook: { imbalance: number; bias: string };
  news: { sentiment: string; riskEventCount: number };
  recommendations: {
    momentum_scalper: {
      active: boolean;
      reason: string;
      params?: {
        bias?: string;
        aggression?: string;
        momentumThreshold?: number;
        maxTradeSeconds?: number;
      };
    };
  };
}

export interface ScalperOverrides {
  tradingEnabled: boolean;
  reason: string;
  momentumThreshold?: number;
  maxTradeSeconds?: number;
  maxChasePercent?: number;
  quickExitSeconds?: number;
  quickGrabDollars?: number;
  minProfitDollars?: number;
  preferredSide?: "Long" | "Short" | null;  // null = both sides ok
}

let cachedBrief: MarketBrief | null = null;
let lastFetch = 0;

async function fetchBrief(): Promise<MarketBrief | null> {
  if (!GITHUB_TOKEN) return null;

  try {
    const resp = await fetch(BRIEF_URL, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!resp.ok) return null;

    const data: any = await resp.json();
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return JSON.parse(content) as MarketBrief;
  } catch (err) {
    log(`⚠️  Brief fetch failed: ${err}`);
    return null;
  }
}

export async function getOverrides(): Promise<ScalperOverrides> {
  // Refresh brief every 5 minutes
  const now = Date.now();
  if (!cachedBrief || now - lastFetch > REFRESH_MS) {
    const fresh = await fetchBrief();
    if (fresh) {
      // Only log when regime changes
      if (!cachedBrief || cachedBrief.regime !== fresh.regime) {
        log(`📊 REGIME: ${fresh.regime.toUpperCase()} (${(fresh.regimeConfidence * 100).toFixed(0)}%) — ${fresh.regimeReason}`);
      }
      cachedBrief = fresh;
      lastFetch = now;
    }
  }

  // No brief available — trade normally with defaults
  if (!cachedBrief) {
    return { tradingEnabled: true, reason: "No market brief available, using defaults" };
  }

  const brief = cachedBrief;
  const rec = brief.recommendations.momentum_scalper;

  // Brief too old (>30min) — don't trust it, use defaults
  if (now - brief.timestamp > 30 * 60 * 1000) {
    return { tradingEnabled: true, reason: "Brief stale (>30min), using defaults" };
  }

  // Research agent says sit out
  if (!rec.active) {
    return { tradingEnabled: false, reason: `⛔ ${rec.reason}` };
  }

  // Build overrides based on regime + recommended params
  const overrides: ScalperOverrides = {
    tradingEnabled: true,
    reason: `✅ ${rec.reason}`,
  };

  // Apply recommended params
  if (rec.params?.momentumThreshold) {
    overrides.momentumThreshold = rec.params.momentumThreshold;
  }
  if (rec.params?.maxTradeSeconds) {
    overrides.maxTradeSeconds = rec.params.maxTradeSeconds;
  }

  // Regime-specific adjustments
  switch (brief.regime) {
    case "trending_bullish":
      overrides.preferredSide = "Long";
      overrides.maxChasePercent = 0.35;       // Allow more chase in trends
      overrides.minProfitDollars = 20;        // Ride the trend, take smaller wins
      break;

    case "trending_bearish":
      overrides.preferredSide = "Short";
      overrides.maxChasePercent = 0.35;
      overrides.minProfitDollars = 20;
      break;

    case "high_vol_chop":
      overrides.preferredSide = null;         // Both sides ok
      overrides.maxTradeSeconds = 120;        // Get out fast in chop
      overrides.quickExitSeconds = 20;        // Faster quick grabs
      overrides.quickGrabDollars = 8;         // Take anything in chop
      overrides.maxChasePercent = 0.20;       // Don't chase in chop
      break;

    case "ranging":
    case "low_vol_squeeze":
      // These regimes should ideally be handled by mean reversion
      // Scalper trades conservatively or sits out
      overrides.momentumThreshold = 0.10;     // Very strong signals only
      overrides.maxChasePercent = 0.15;       // Barely chase
      overrides.maxTradeSeconds = 90;         // Quick in/out
      break;
  }

  // Risk overlay: high news risk = tighten everything
  if (brief.news.riskEventCount >= 3) {
    overrides.maxTradeSeconds = Math.min(overrides.maxTradeSeconds || 150, 120);
    overrides.momentumThreshold = Math.max(overrides.momentumThreshold || 0.06, 0.08);
  }

  return overrides;
}

// For logging/health endpoint
export function getCurrentBrief(): MarketBrief | null {
  return cachedBrief;
}
