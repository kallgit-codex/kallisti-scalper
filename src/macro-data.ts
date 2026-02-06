/**
 * Macro Market Data Fetcher
 * Provides real-time market context for smarter trading decisions
 */

export interface MacroData {
  dxy: number | null;           // Dollar index
  spx: number | null;           // S&P 500 futures
  funding: number | null;       // BTC funding rate
  openInterest: number | null;  // BTC open interest
  timestamp: string;
}

export interface MarketConditions {
  isSafe: boolean;
  reasons: string[];
  dxyTrend: 'up' | 'down' | 'neutral';
  spxTrend: 'up' | 'down' | 'neutral';
  fundingStatus: 'extreme-positive' | 'extreme-negative' | 'normal';
  hourStatus: 'us-hours' | 'off-hours';
}

const TWELVE_DATA_KEY = process.env.TWELVE_DATA_KEY || 'demo';

/**
 * Fetch DXY (Dollar Index) - Inverse correlation with BTC
 */
async function fetchDXY(): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.twelvedata.com/price?symbol=DXY&apikey=${TWELVE_DATA_KEY}`
    );
    const data = await response.json();
    return data.price ? parseFloat(data.price) : null;
  } catch (error) {
    console.warn('⚠️  Failed to fetch DXY:', error);
    return null;
  }
}

/**
 * Fetch S&P 500 futures - High correlation with BTC
 */
async function fetchSPX(): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.twelvedata.com/price?symbol=ES&apikey=${TWELVE_DATA_KEY}`
    );
    const data = await response.json();
    return data.price ? parseFloat(data.price) : null;
  } catch (error) {
    console.warn('⚠️  Failed to fetch S&P futures:', error);
    return null;
  }
}

/**
 * Fetch BTC funding rate from Binance
 */
async function fetchFundingRate(): Promise<number | null> {
  try {
    const response = await fetch(
      'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'
    );
    const data = await response.json();
    return data.lastFundingRate ? parseFloat(data.lastFundingRate) : null;
  } catch (error) {
    console.warn('⚠️  Failed to fetch funding rate:', error);
    return null;
  }
}

/**
 * Fetch BTC open interest from Binance
 */
async function fetchOpenInterest(): Promise<number | null> {
  try {
    const response = await fetch(
      'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT'
    );
    const data = await response.json();
    return data.openInterest ? parseFloat(data.openInterest) : null;
  } catch (error) {
    console.warn('⚠️  Failed to fetch open interest:', error);
    return null;
  }
}

/**
 * Fetch all macro data at once
 */
export async function fetchMacroData(): Promise<MacroData> {
  const [dxy, spx, funding, openInterest] = await Promise.all([
    fetchDXY(),
    fetchSPX(),
    fetchFundingRate(),
    fetchOpenInterest()
  ]);

  return {
    dxy,
    spx,
    funding,
    openInterest,
    timestamp: new Date().toISOString()
  };
}

/**
 * Analyze market conditions and determine if it's safe to trade
 */
export function analyzeMarketConditions(
  macro: MacroData,
  previousMacro?: MacroData
): MarketConditions {
  const reasons: string[] = [];
  let isSafe = true;

  // Check time of day (US market hours = safer)
  const hour = new Date().getUTCHours();
  const isUSHours = hour >= 13 && hour <= 21; // 9:30am-5pm ET
  const hourStatus = isUSHours ? 'us-hours' : 'off-hours';

  if (!isUSHours) {
    reasons.push('Outside US market hours (lower liquidity)');
    // Don't block, just note it
  }

  // Check DXY trend (inverse with BTC)
  let dxyTrend: 'up' | 'down' | 'neutral' = 'neutral';
  if (macro.dxy && previousMacro?.dxy) {
    const dxyChange = ((macro.dxy - previousMacro.dxy) / previousMacro.dxy) * 100;
    if (dxyChange > 0.5) {
      dxyTrend = 'up';
      reasons.push(`Dollar pumping (+${dxyChange.toFixed(2)}% - bearish for BTC)`);
      isSafe = false; // Strong dollar = BTC down
    } else if (dxyChange < -0.5) {
      dxyTrend = 'down';
      reasons.push(`Dollar dumping (${dxyChange.toFixed(2)}% - bullish for BTC)`);
    }
  }

  // Check S&P trend (correlated with BTC)
  let spxTrend: 'up' | 'down' | 'neutral' = 'neutral';
  if (macro.spx && previousMacro?.spx) {
    const spxChange = ((macro.spx - previousMacro.spx) / previousMacro.spx) * 100;
    if (spxChange < -1.0) {
      spxTrend = 'down';
      reasons.push(`S&P dumping (${spxChange.toFixed(2)}% - risk-off)`);
      isSafe = false; // Risk-off = BTC down
    } else if (spxChange > 1.0) {
      spxTrend = 'up';
      reasons.push(`S&P pumping (+${spxChange.toFixed(2)}% - risk-on)`);
    }
  }

  // Check funding rate (extreme positive = overheated)
  let fundingStatus: 'extreme-positive' | 'extreme-negative' | 'normal' = 'normal';
  if (macro.funding !== null) {
    const fundingPercent = macro.funding * 100;
    if (fundingPercent > 0.1) {
      fundingStatus = 'extreme-positive';
      reasons.push(`Funding rate extreme (+${fundingPercent.toFixed(3)}% - longs overheated)`);
      isSafe = false; // Too many longs = reversal incoming
    } else if (fundingPercent < -0.1) {
      fundingStatus = 'extreme-negative';
      reasons.push(`Funding rate extreme (${fundingPercent.toFixed(3)}% - shorts overheated)`);
      // This is actually good for longs!
    }
  }

  if (isSafe && reasons.length === 0) {
    reasons.push('All macro conditions favorable');
  }

  return {
    isSafe,
    reasons,
    dxyTrend,
    spxTrend,
    fundingStatus,
    hourStatus
  };
}

/**
 * Helper to log macro data
 */
export function logMacroData(macro: MacroData, conditions: MarketConditions): void {
  console.log('\n📊 MACRO MARKET DATA:');
  if (macro.dxy) console.log(`   DXY: ${macro.dxy.toFixed(2)} (${conditions.dxyTrend})`);
  if (macro.spx) console.log(`   S&P: ${macro.spx.toFixed(2)} (${conditions.spxTrend})`);
  if (macro.funding) console.log(`   Funding: ${(macro.funding * 100).toFixed(4)}% (${conditions.fundingStatus})`);
  if (macro.openInterest) console.log(`   Open Interest: ${(macro.openInterest / 1000000).toFixed(2)}M BTC`);
  console.log(`   Time: ${conditions.hourStatus}`);
  console.log(`\n   ${conditions.isSafe ? '✅' : '⚠️'} Trading: ${conditions.isSafe ? 'ENABLED' : 'PAUSED'}`);
  conditions.reasons.forEach(r => console.log(`   - ${r}`));
}
