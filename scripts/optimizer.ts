/**
 * AUTONOMOUS Self-Optimizer Bot
 * Analyzes performance, gets AI suggestions, and AUTOMATICALLY applies improvements
 * Paper trading = zero risk = full autonomy
 */

import * as fs from 'fs';
import * as path from 'path';

interface Trade {
  timestamp: string;
  symbol: string;
  side: 'Long' | 'Short';
  entry: number;
  exit: number;
  quantity: number;
  outcome: string;
  pnl: number;
  closeReason: string;
  duration: number;
}

interface LedgerData {
  trades: Trade[];
  balance: number;
  totalPnl: number;
}

interface OptimizationSuggestion {
  parameter: string;
  currentValue: any;
  suggestedValue: any;
  reasoning: string;
  expectedImpact: string;
  confidence: 'low' | 'medium' | 'high';
  configPath: string;
}

const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';
const MIN_CONFIDENCE_TO_APPLY = 'medium'; // Only apply medium/high confidence changes

async function analyzeLedger(): Promise<{
  trades: Trade[];
  stats: any;
  patterns: any;
}> {
  const ledgerPath = path.join(__dirname, '../data/ledger.json');
  const ledger: LedgerData = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
  
  const recentTrades = ledger.trades.slice(-100);
  
  if (recentTrades.length < 20) {
    console.log(`⏳ Not enough trades yet (need 20+, have ${recentTrades.length})`);
    process.exit(0);
  }
  
  const wins = recentTrades.filter(t => t.pnl > 0);
  const losses = recentTrades.filter(t => t.pnl < 0);
  const breakevens = recentTrades.filter(t => t.pnl === 0);
  
  const winRate = (wins.length / recentTrades.length) * 100;
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / losses.length : 0;
  const expectancy = (winRate/100 * avgWin) - ((100-winRate)/100 * avgLoss);
  
  const closeReasons = recentTrades.reduce((acc, t) => {
    acc[t.closeReason] = (acc[t.closeReason] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const byHour = recentTrades.reduce((acc, t) => {
    const hour = new Date(t.timestamp).getUTCHours();
    if (!acc[hour]) acc[hour] = { trades: [], wins: 0, pnl: 0 };
    acc[hour].trades.push(t);
    if (t.pnl > 0) acc[hour].wins++;
    acc[hour].pnl += t.pnl;
    return acc;
  }, {} as Record<number, { trades: Trade[]; wins: number; pnl: number }>);
  
  const stats = {
    totalTrades: recentTrades.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate: winRate.toFixed(2) + '%',
    avgWin: '$' + avgWin.toFixed(2),
    avgLoss: '$' + avgLoss.toFixed(2),
    expectancy: '$' + expectancy.toFixed(2),
    totalPnl: '$' + recentTrades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2)
  };
  
  return { trades: recentTrades, stats, patterns: { closeReasons, byHour } };
}

async function getOptimizationSuggestions(
  analysis: { trades: Trade[]; stats: any; patterns: any }
): Promise<any> {
  const hourlyPerf = Object.entries(analysis.patterns.byHour)
    .map(([hour, data]: [string, any]) => 
      `Hour ${hour}: ${data.trades.length} trades, ${((data.wins/data.trades.length)*100).toFixed(0)}% win, $${data.pnl.toFixed(2)} PnL`
    )
    .join('\n');

  const prompt = `You are an AUTONOMOUS trading bot optimizer with FULL PERMISSION to modify parameters.

**CURRENT STRATEGY:**
- Longs only (buy reversals at local bottoms)
- Entry: RSI < 35, local bottom, volume spike 1.5x
- Take profit: 0.10%
- Stop loss: 0.35%
- Breakeven timeout: 2 minutes
- Force close: 5 minutes

**RECENT PERFORMANCE:**
${JSON.stringify(analysis.stats, null, 2)}

**CLOSE REASON BREAKDOWN:**
${JSON.stringify(analysis.patterns.closeReasons, null, 2)}

**HOURLY PERFORMANCE:**
${hourlyPerf}

**SAMPLE TRADES (last 10):**
${JSON.stringify(analysis.trades.slice(-10), null, 2)}

**YOUR TASK:**
Analyze this data and suggest 1-3 parameter optimizations. YOUR CHANGES WILL BE AUTOMATICALLY APPLIED.

**SAFETY CONSTRAINTS (DO NOT suggest outside these ranges):**
- RSI threshold: 30-40
- Take profit: 0.08-0.15%
- Stop loss: 0.20-0.50%
- Volume multiplier: 1.2-2.0x
- Breakeven timeout: 1-5 min
- Force close: 3-10 min

**IMPORTANT:**
- Only suggest changes you are confident will improve performance
- Mark confidence as 'low' if unsure (these won't be applied automatically)
- Mark 'medium' or 'high' if you have statistical backing
- Include the exact config path for each parameter

**RESPOND IN THIS EXACT JSON FORMAT:**
{
  "suggestions": [
    {
      "parameter": "targetProfitPercent",
      "currentValue": "0.10",
      "suggestedValue": "0.12",
      "reasoning": "75% of wins hit target <30sec, suggesting room for more upside before reversal",
      "expectedImpact": "+15% PnL per trade",
      "confidence": "high",
      "configPath": "targetProfitPercent"
    }
  ],
  "summary": "Overall analysis and priority",
  "warnings": ["Patterns to watch"]
}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/kallgit-codex/kallisti-scalper',
      'X-Title': 'Kallisti Scalper Optimizer'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-opus-4.5',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

function applyConfigChanges(suggestions: OptimizationSuggestion[]): string[] {
  const configPath = path.join(__dirname, '../src/config.ts');
  let configContent = fs.readFileSync(configPath, 'utf-8');
  const appliedChanges: string[] = [];
  
  for (const suggestion of suggestions) {
    // Only apply medium/high confidence changes
    if (suggestion.confidence === 'low') {
      console.log(`⏭️  Skipping low-confidence change: ${suggestion.parameter}`);
      continue;
    }
    
    const { parameter, currentValue, suggestedValue, reasoning } = suggestion;
    
    // Build regex to find and replace the parameter
    // Match patterns like: targetProfitPercent: 0.10,
    const paramRegex = new RegExp(
      `(${parameter}\\s*:\\s*)([^,\\n]+)`,
      'g'
    );
    
    const newConfigContent = configContent.replace(
      paramRegex,
      `$1${suggestedValue}`
    );
    
    if (newConfigContent !== configContent) {
      configContent = newConfigContent;
      appliedChanges.push(
        `✅ ${parameter}: ${currentValue} → ${suggestedValue} (${reasoning})`
      );
    } else {
      console.warn(`⚠️  Could not find parameter: ${parameter}`);
    }
  }
  
  if (appliedChanges.length > 0) {
    fs.writeFileSync(configPath, configContent);
    console.log('\n🔧 APPLIED CHANGES:');
    appliedChanges.forEach(change => console.log(change));
  }
  
  return appliedChanges;
}

async function main() {
  console.log('🤖 AUTONOMOUS OPTIMIZER - Full permission mode\n');
  
  if (!OPENROUTER_KEY) {
    console.error('❌ OPENROUTER_KEY not set');
    process.exit(1);
  }
  
  // Analyze performance
  const analysis = await analyzeLedger();
  console.log('📊 PERFORMANCE STATS:');
  console.log(JSON.stringify(analysis.stats, null, 2));
  
  // Get AI suggestions
  console.log('\n🧠 Consulting Claude Opus 4.5...\n');
  const result = await getOptimizationSuggestions(analysis);
  
  // Display suggestions
  console.log('💡 OPTIMIZATION SUGGESTIONS:\n');
  result.suggestions.forEach((s: OptimizationSuggestion, i: number) => {
    console.log(`${i+1}. ${s.parameter.toUpperCase()} [${s.confidence.toUpperCase()}]`);
    console.log(`   Current: ${s.currentValue} → Suggested: ${s.suggestedValue}`);
    console.log(`   Reasoning: ${s.reasoning}`);
    console.log(`   Impact: ${s.expectedImpact}\n`);
  });
  
  if (result.summary) {
    console.log(`📋 SUMMARY: ${result.summary}\n`);
  }
  
  // AUTOMATICALLY APPLY CHANGES
  console.log('🚀 AUTO-APPLYING CHANGES...\n');
  const appliedChanges = applyConfigChanges(result.suggestions);
  
  if (appliedChanges.length === 0) {
    console.log('ℹ️  No changes to apply (all suggestions were low-confidence or failed)\n');
  } else {
    console.log(`\n✅ Applied ${appliedChanges.length} change(s) to config.ts`);
    console.log('🔄 Bot will use new parameters on next run (in ~1 minute)\n');
  }
  
  if (result.warnings && result.warnings.length > 0) {
    console.log(`⚠️  WARNINGS:`);
    result.warnings.forEach((w: string) => console.log(`   - ${w}`));
    console.log();
  }
  
  // Save detailed report
  const reportPath = path.join(__dirname, '../data/optimization-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    analysis,
    result,
    appliedChanges,
    autoApplied: appliedChanges.length > 0
  }, null, 2));
  
  console.log(`📄 Full report: ${reportPath}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
