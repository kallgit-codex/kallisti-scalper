/**
 * AUTONOMOUS OPTIMIZER + BUG FIXER v2
 * Analyzes performance, optimizes parameters, AND fixes code bugs
 * Now with Twelve Data market context for smarter decisions
 * Full autonomy - paper trading means zero risk
 */

import * as fs from 'fs';
import * as path from 'path';

interface Position {
  id: string;
  side: 'Long' | 'Short';
  entryPrice: number;
  entryTime: number;
  exitPrice?: number;
  exitTime?: number;
  collateral: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  minProfitTarget: number;
  maxProfitTarget: number;
  status: 'open' | 'closed';
  pnl?: number;
  reason?: string;
}

interface LedgerData {
  balance: number;
  initialBalance: number;
  dailyStartBalance: number;
  dailyPnl: number;
  consecutiveLosses: number;
  positions: Position[];
  lastReset: string;
  tradesThisHour: number;
  lastHourReset: string;
  pausedUntil: number;
}

const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_KEY || '';

// Files that the AI optimizer can read and modify
const CODE_FILES = [
  'src/agent.ts',
  'src/config.ts',
  'src/strategy/reversal-strategy.ts',
  'src/exchange/binance.ts',
  'src/ledger.ts',
  'src/risk/recovery-manager.ts'
];

async function getMarketContext(): Promise<string> {
  if (!TWELVE_DATA_KEY) {
    return 'No Twelve Data key available - skipping market context';
  }

  try {
    // Get BTC technical indicators from Twelve Data
    const [rsiResp, macdResp, atrResp] = await Promise.all([
      fetch(`https://api.twelvedata.com/rsi?symbol=BTC/USD&interval=1h&outputsize=24&apikey=${TWELVE_DATA_KEY}`),
      fetch(`https://api.twelvedata.com/macd?symbol=BTC/USD&interval=1h&outputsize=24&apikey=${TWELVE_DATA_KEY}`),
      fetch(`https://api.twelvedata.com/atr?symbol=BTC/USD&interval=1h&outputsize=24&apikey=${TWELVE_DATA_KEY}`)
    ]);

    const [rsi, macd, atr] = await Promise.all([
      rsiResp.json(),
      macdResp.json(),
      atrResp.json()
    ]);

    const context: string[] = ['=== MARKET CONTEXT (Twelve Data - Last 24h) ==='];

    if (rsi.values) {
      const latest = rsi.values[0];
      const avg = rsi.values.slice(0, 12).reduce((s: number, v: any) => s + parseFloat(v.rsi), 0) / 12;
      context.push(`RSI (1h): Current ${parseFloat(latest.rsi).toFixed(1)} | 12h Avg: ${avg.toFixed(1)}`);
      if (parseFloat(latest.rsi) > 70) context.push('⚠️ OVERBOUGHT - expect reversals down');
      if (parseFloat(latest.rsi) < 30) context.push('⚠️ OVERSOLD - expect reversals up');
    }

    if (macd.values) {
      const latest = macd.values[0];
      context.push(`MACD (1h): MACD ${parseFloat(latest.macd).toFixed(2)} | Signal ${parseFloat(latest.macd_signal).toFixed(2)} | Hist ${parseFloat(latest.macd_hist).toFixed(2)}`);
      const trend = parseFloat(latest.macd) > parseFloat(latest.macd_signal) ? 'BULLISH' : 'BEARISH';
      context.push(`Trend: ${trend}`);
    }

    if (atr.values) {
      const latest = parseFloat(atr.values[0].atr);
      const avg = atr.values.slice(0, 12).reduce((s: number, v: any) => s + parseFloat(v.atr), 0) / 12;
      context.push(`ATR (1h): Current $${latest.toFixed(0)} | 12h Avg: $${avg.toFixed(0)}`);
      if (latest > avg * 1.5) context.push('⚠️ HIGH VOLATILITY - widen stops');
      if (latest < avg * 0.5) context.push('⚠️ LOW VOLATILITY - tighten targets or skip');
    }

    return context.join('\n');
  } catch (err: any) {
    console.log(`⚠️ Twelve Data fetch failed: ${err.message}`);
    return 'Market context unavailable (API error)';
  }
}

async function analyzeLedger(): Promise<{
  positions: Position[];
  stats: any;
  patterns: any;
  anomalies: string[];
}> {
  const ledgerPath = path.join(__dirname, '../data/ledger.json');
  const ledger: LedgerData = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));

  const closedPositions = ledger.positions.filter(p => p.status === 'closed' && p.pnl !== undefined);
  const recentPositions = closedPositions.slice(-100);

  if (recentPositions.length < 15) {
    console.log(`⏳ Not enough closed trades yet (need 15+, have ${recentPositions.length})`);
    process.exit(0);
  }

  const wins = recentPositions.filter(p => (p.pnl || 0) > 0);
  const losses = recentPositions.filter(p => (p.pnl || 0) < 0);
  const breakevens = recentPositions.filter(p => p.pnl === 0);

  const winRate = (wins.length / recentPositions.length) * 100;
  const avgWin = wins.length > 0 ? wins.reduce((sum, p) => sum + (p.pnl || 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((sum, p) => sum + Math.abs(p.pnl || 0), 0) / losses.length : 0;
  const expectancy = (winRate / 100 * avgWin) - ((100 - winRate) / 100 * avgLoss);
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : Infinity;

  // DETECT ANOMALIES (potential bugs)
  const anomalies: string[] = [];

  // Check for impossible PnL values
  const suspiciousPnL = recentPositions.filter(p => Math.abs(p.pnl || 0) > 100);
  if (suspiciousPnL.length > 0) {
    anomalies.push(`⚠️ Found ${suspiciousPnL.length} trades with PnL > $100 (suspicious for $30 collateral)`);
  }

  // Check for duration anomalies
  const longDurations = recentPositions.filter(p => {
    if (!p.exitTime || !p.entryTime) return false;
    return (p.exitTime - p.entryTime) > 600000; // >10 min
  });
  if (longDurations.length > recentPositions.length * 0.3) {
    anomalies.push(`⚠️ ${(longDurations.length / recentPositions.length * 100).toFixed(0)}% of trades exceed 10 min (config max is 5 min)`);
  }

  // Check for same entry/exit
  const noMovement = recentPositions.filter(p => p.entryPrice === p.exitPrice);
  if (noMovement.length > 5) {
    anomalies.push(`⚠️ ${noMovement.length} trades had identical entry/exit prices`);
  }

  // Check balance vs calculated PnL
  const totalPnl = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
  const expectedBalance = ledger.initialBalance + totalPnl;
  if (Math.abs(expectedBalance - ledger.balance) > 1) {
    anomalies.push(`⚠️ Balance mismatch! Expected $${expectedBalance.toFixed(2)} but got $${ledger.balance.toFixed(2)} (diff: $${(ledger.balance - expectedBalance).toFixed(2)})`);
  }

  // Check for collateral accounting
  const openPositions = ledger.positions.filter(p => p.status === 'open');
  const openCollateral = openPositions.reduce((sum, p) => sum + p.collateral, 0);
  if (openCollateral > ledger.balance) {
    anomalies.push(`⚠️ Open collateral ($${openCollateral}) exceeds balance ($${ledger.balance.toFixed(2)})`);
  }

  const closeReasons = recentPositions.reduce((acc, p) => {
    const reason = p.reason || 'unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // PnL by reason
  const pnlByReason = recentPositions.reduce((acc, p) => {
    const reason = p.reason || 'unknown';
    if (!acc[reason]) acc[reason] = { count: 0, totalPnl: 0, wins: 0 };
    acc[reason].count++;
    acc[reason].totalPnl += p.pnl || 0;
    if ((p.pnl || 0) > 0) acc[reason].wins++;
    return acc;
  }, {} as Record<string, { count: number; totalPnl: number; wins: number }>);

  const byHour = recentPositions.reduce((acc, p) => {
    const hour = new Date(p.entryTime).getUTCHours();
    if (!acc[hour]) acc[hour] = { trades: [], wins: 0, pnl: 0 };
    acc[hour].trades.push(p);
    if ((p.pnl || 0) > 0) acc[hour].wins++;
    acc[hour].pnl += p.pnl || 0;
    return acc;
  }, {} as Record<number, { trades: Position[]; wins: number; pnl: number }>);

  // Side analysis
  const longs = recentPositions.filter(p => p.side === 'Long');
  const shorts = recentPositions.filter(p => p.side === 'Short');
  const longWinRate = longs.length > 0 ? (longs.filter(p => (p.pnl || 0) > 0).length / longs.length * 100) : 0;
  const shortWinRate = shorts.length > 0 ? (shorts.filter(p => (p.pnl || 0) > 0).length / shorts.length * 100) : 0;

  // Average trade duration
  const durations = recentPositions
    .filter(p => p.exitTime && p.entryTime)
    .map(p => ((p.exitTime! - p.entryTime) / 1000));
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const stats = {
    currentBalance: '$' + ledger.balance.toFixed(2),
    totalClosedTrades: recentPositions.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate: winRate.toFixed(1) + '%',
    avgWin: '$' + avgWin.toFixed(2),
    avgLoss: '$' + avgLoss.toFixed(2),
    expectancy: '$' + expectancy.toFixed(3),
    profitFactor: profitFactor.toFixed(2),
    totalPnl: '$' + recentPositions.reduce((sum, p) => sum + (p.pnl || 0), 0).toFixed(2),
    avgDurationSeconds: avgDuration.toFixed(0),
    longWinRate: longWinRate.toFixed(1) + '%',
    shortWinRate: shortWinRate.toFixed(1) + '%',
    consecutiveLosses: ledger.consecutiveLosses,
    openPositions: openPositions.length,
    pnlByReason: Object.fromEntries(
      Object.entries(pnlByReason).map(([k, v]) => [k, `${v.count} trades, $${v.totalPnl.toFixed(2)} PnL, ${(v.wins / v.count * 100).toFixed(0)}% win`])
    )
  };

  return { positions: recentPositions, stats, patterns: { closeReasons, byHour }, anomalies };
}

function readCodeFiles(): Record<string, string> {
  const codeContents: Record<string, string> = {};

  for (const file of CODE_FILES) {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
      codeContents[file] = fs.readFileSync(filePath, 'utf-8');
    }
  }

  return codeContents;
}

async function getOptimizerResponse(
  analysis: { positions: Position[]; stats: any; patterns: any; anomalies: string[] },
  codeFiles: Record<string, string>,
  marketContext: string
): Promise<any> {
  const hourlyPerf = Object.entries(analysis.patterns.byHour)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([hour, data]: [string, any]) =>
      `Hour ${hour}UTC: ${data.trades.length} trades, ${data.trades.length > 0 ? ((data.wins / data.trades.length) * 100).toFixed(0) : 0}% win, $${data.pnl.toFixed(2)} PnL`
    )
    .join('\n');

  const codeContext = Object.entries(codeFiles)
    .map(([file, content]) => `\n=== ${file} ===\n${content}`)
    .join('\n');

  // Prepare sample trades with calculated duration
  const sampleTrades = analysis.positions.slice(-15).map(p => ({
    id: p.id,
    side: p.side,
    entryPrice: p.entryPrice,
    exitPrice: p.exitPrice,
    collateral: p.collateral,
    leverage: p.leverage,
    pnl: p.pnl?.toFixed(3),
    reason: p.reason,
    durationSec: p.exitTime && p.entryTime ? ((p.exitTime - p.entryTime) / 1000).toFixed(0) : 'unknown',
    timestamp: new Date(p.entryTime).toISOString()
  }));

  const prompt = `You are an AUTONOMOUS trading bot optimizer with FULL PERMISSION to:
1. Optimize parameters
2. Fix bugs in code
3. Improve strategy logic

This is a paper trading bot (zero real money risk). Be aggressive with improvements.

**CURRENT PERFORMANCE:**
${JSON.stringify(analysis.stats, null, 2)}

**CLOSE REASONS DISTRIBUTION:**
${JSON.stringify(analysis.patterns.closeReasons, null, 2)}

**HOURLY PERFORMANCE:**
${hourlyPerf}

**${marketContext}**

**DETECTED ANOMALIES:**
${analysis.anomalies.length > 0 ? analysis.anomalies.join('\n') : 'None detected'}

**SAMPLE TRADES (last 15):**
${JSON.stringify(sampleTrades, null, 2)}

**CURRENT CODE:**
${codeContext}

**YOUR TASK:**
Analyze the performance data, market context, and code to:
1. **Fix any bugs** you detect (especially if anomalies are present)
2. **Optimize parameters** within safety constraints
3. **Improve strategy logic** if you see clear issues
4. **Adapt to current market conditions** using Twelve Data context

**PARAMETER SAFETY CONSTRAINTS:**
- RSI threshold: 25-45
- Take profit: 0.08-0.20%
- Stop loss: 0.15-0.50%
- Volume multiplier: 1.0-2.5x
- Quick exit timeout: 60-300 seconds
- Max trade time: 120-600 seconds
- Leverage: 10-25x
- Position size: $20-50
- Max trades per hour: 10-60

**RESPOND IN THIS EXACT JSON FORMAT (no markdown, no backticks):**
{
  "bugFixes": [
    {
      "file": "src/agent.ts",
      "issue": "Description of bug",
      "fix": "FULL FILE CONTENT with bug fixed",
      "reasoning": "Why this is a bug",
      "confidence": "high"
    }
  ],
  "parameterChanges": [
    {
      "parameter": "targetProfitPercent",
      "currentValue": "0.10",
      "suggestedValue": "0.12",
      "reasoning": "Why this change",
      "expectedImpact": "+15% PnL per trade",
      "confidence": "high",
      "configPath": "targetProfitPercent"
    }
  ],
  "summary": "Overall analysis and changes made",
  "marketAdaptation": "How changes account for current market conditions",
  "warnings": ["Patterns to watch"]
}

**IMPORTANT:**
- For bug fixes, provide COMPLETE file content, not diffs
- Only suggest changes you're confident about
- Mark confidence as 'low' if unsure (won't auto-apply)
- Prioritize bug fixes over optimizations
- Consider market context when tuning parameters`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/kallgit-codex/kallisti-scalper',
      'X-Title': 'Kallisti Scalper Optimizer v2'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 16000
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errText}`);
  }

  const data: any = await response.json();
  const content = data.choices[0].message.content;

  // Strip markdown code fences if present
  let cleaned = content.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  return JSON.parse(cleaned);
}

function applyBugFixes(bugFixes: any[]): string[] {
  const appliedFixes: string[] = [];

  for (const fix of bugFixes) {
    if (fix.confidence === 'low') {
      console.log(`⏭️  Skipping low-confidence fix: ${fix.file} - ${fix.issue}`);
      continue;
    }

    const filePath = path.join(__dirname, '..', fix.file);

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found: ${fix.file}`);
      continue;
    }

    // Backup original
    const original = fs.readFileSync(filePath, 'utf-8');
    fs.writeFileSync(filePath + '.bak', original);

    // Write the fixed content
    fs.writeFileSync(filePath, fix.fix);
    appliedFixes.push(`🐛→✅ ${fix.file}: ${fix.issue}`);
  }

  if (appliedFixes.length > 0) {
    console.log('\n🔧 APPLIED BUG FIXES:');
    appliedFixes.forEach(fix => console.log(fix));
  }

  return appliedFixes;
}

function applyParameterChanges(changes: any[]): string[] {
  const configPath = path.join(__dirname, '../src/config.ts');
  let configContent = fs.readFileSync(configPath, 'utf-8');
  const appliedChanges: string[] = [];

  for (const change of changes) {
    if (change.confidence === 'low') {
      console.log(`⏭️  Skipping low-confidence change: ${change.parameter}`);
      continue;
    }

    const paramRegex = new RegExp(
      `(${change.parameter}\\s*:\\s*)([^,\\n]+)`,
      'g'
    );

    const newConfigContent = configContent.replace(
      paramRegex,
      `$1${change.suggestedValue}`
    );

    if (newConfigContent !== configContent) {
      configContent = newConfigContent;
      appliedChanges.push(
        `⚙️ ${change.parameter}: ${change.currentValue} → ${change.suggestedValue}`
      );
    }
  }

  if (appliedChanges.length > 0) {
    fs.writeFileSync(configPath, configContent);
    console.log('\n📊 APPLIED PARAMETER CHANGES:');
    appliedChanges.forEach(change => console.log(change));
  }

  return appliedChanges;
}

async function main() {
  console.log('🤖 AUTONOMOUS OPTIMIZER + BUG FIXER v2\n');

  if (!OPENROUTER_KEY) {
    console.error('❌ OPENROUTER_KEY not set');
    process.exit(1);
  }

  // Get market context from Twelve Data
  console.log('📡 Fetching market context from Twelve Data...');
  const marketContext = await getMarketContext();
  console.log(marketContext);

  // Analyze performance and detect anomalies
  const analysis = await analyzeLedger();
  console.log('\n📊 PERFORMANCE STATS:');
  console.log(JSON.stringify(analysis.stats, null, 2));

  if (analysis.anomalies.length > 0) {
    console.log('\n⚠️  ANOMALIES DETECTED:');
    analysis.anomalies.forEach(a => console.log(a));
  }

  // Read current code
  const codeFiles = readCodeFiles();
  console.log(`\n📁 Read ${Object.keys(codeFiles).length} code files`);

  // Get AI analysis (bugs + optimizations + market adaptation)
  console.log('\n🧠 Consulting Claude Sonnet 4 for optimization...\n');
  const result = await getOptimizerResponse(analysis, codeFiles, marketContext);

  // Apply bug fixes first
  let bugFixesApplied: string[] = [];
  if (result.bugFixes && result.bugFixes.length > 0) {
    console.log('🐛 BUG FIXES:\n');
    result.bugFixes.forEach((fix: any) => {
      console.log(`${fix.file}: ${fix.issue}`);
      console.log(`  Confidence: ${fix.confidence}`);
      console.log(`  Fix: ${fix.reasoning}\n`);
    });

    console.log('🚀 AUTO-APPLYING BUG FIXES...\n');
    bugFixesApplied = applyBugFixes(result.bugFixes);
  }

  // Apply parameter changes
  let paramChangesApplied: string[] = [];
  if (result.parameterChanges && result.parameterChanges.length > 0) {
    console.log('\n💡 PARAMETER OPTIMIZATIONS:\n');
    result.parameterChanges.forEach((change: any) => {
      console.log(`${change.parameter}: ${change.currentValue} → ${change.suggestedValue}`);
      console.log(`  Impact: ${change.expectedImpact}`);
      console.log(`  Confidence: ${change.confidence}\n`);
    });

    console.log('🚀 AUTO-APPLYING PARAMETER CHANGES...\n');
    paramChangesApplied = applyParameterChanges(result.parameterChanges);
  }

  const totalChanges = bugFixesApplied.length + paramChangesApplied.length;

  if (totalChanges === 0) {
    console.log('✅ No changes needed - bot is running optimally!\n');
  } else {
    console.log(`\n✅ Applied ${totalChanges} total change(s)`);
    console.log('🔄 Bot will use updated code on next run (in ~1 minute)\n');
  }

  if (result.summary) {
    console.log(`📋 SUMMARY: ${result.summary}\n`);
  }

  if (result.marketAdaptation) {
    console.log(`🌍 MARKET ADAPTATION: ${result.marketAdaptation}\n`);
  }

  if (result.warnings && result.warnings.length > 0) {
    console.log(`⚠️  WARNINGS:`);
    result.warnings.forEach((w: string) => console.log(`   - ${w}`));
    console.log();
  }

  // Save report
  const reportPath = path.join(__dirname, '../data/optimization-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    version: 'v2',
    marketContext,
    analysis: {
      stats: analysis.stats,
      patterns: analysis.patterns,
      anomalies: analysis.anomalies,
      tradeCount: analysis.positions.length
    },
    result,
    bugFixesApplied,
    paramChangesApplied,
    totalChanges
  }, null, 2));

  console.log(`📄 Full report: ${reportPath}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
