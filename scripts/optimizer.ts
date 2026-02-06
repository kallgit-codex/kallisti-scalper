/**
 * AUTONOMOUS OPTIMIZER + BUG FIXER
 * Analyzes performance, optimizes parameters, AND fixes code bugs
 * Full autonomy - paper trading means zero risk
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

const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';

// Files that Opus can read and modify
const CODE_FILES = [
  'src/agent.ts',
  'src/config.ts',
  'src/strategy/reversal-strategy.ts',
  'src/exchange/binance.ts',
  'src/ledger.ts'
];

async function analyzeLedger(): Promise<{
  trades: Trade[];
  stats: any;
  patterns: any;
  anomalies: string[];
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
  
  // DETECT ANOMALIES (potential bugs)
  const anomalies: string[] = [];
  
  // Check for impossible PnL values
  const suspiciousPnL = recentTrades.filter(t => Math.abs(t.pnl) > 100);
  if (suspiciousPnL.length > 0) {
    anomalies.push(`⚠️ Found ${suspiciousPnL.length} trades with PnL > $100 (should be ~$0.60 for 0.10% profit)`);
  }
  
  // Check for duration anomalies
  const longDurations = recentTrades.filter(t => t.duration > 600000); // >10 min
  if (longDurations.length > recentTrades.length * 0.2) {
    anomalies.push(`⚠️ ${(longDurations.length/recentTrades.length*100).toFixed(0)}% of trades exceed force-close timeout`);
  }
  
  // Check for same entry/exit (potential bug)
  const noMovement = recentTrades.filter(t => t.entry === t.exit);
  if (noMovement.length > 5) {
    anomalies.push(`⚠️ ${noMovement.length} trades had identical entry/exit prices`);
  }
  
  // Check for negative quantities
  const badQuantity = recentTrades.filter(t => t.quantity <= 0);
  if (badQuantity.length > 0) {
    anomalies.push(`⚠️ Found ${badQuantity.length} trades with invalid quantity`);
  }
  
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
  
  return { trades: recentTrades, stats, patterns: { closeReasons, byHour }, anomalies };
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
  analysis: { trades: Trade[]; stats: any; patterns: any; anomalies: string[] },
  codeFiles: Record<string, string>
): Promise<any> {
  const hourlyPerf = Object.entries(analysis.patterns.byHour)
    .map(([hour, data]: [string, any]) => 
      `Hour ${hour}: ${data.trades.length} trades, ${((data.wins/data.trades.length)*100).toFixed(0)}% win, $${data.pnl.toFixed(2)} PnL`
    )
    .join('\n');

  const codeContext = Object.entries(codeFiles)
    .map(([file, content]) => `\n=== ${file} ===\n${content}`)
    .join('\n');

  const prompt = `You are an AUTONOMOUS trading bot optimizer with FULL PERMISSION to:
1. Optimize parameters
2. Fix bugs in code
3. Improve strategy logic

**CURRENT PERFORMANCE:**
${JSON.stringify(analysis.stats, null, 2)}

**CLOSE REASONS:**
${JSON.stringify(analysis.patterns.closeReasons, null, 2)}

**HOURLY PERFORMANCE:**
${hourlyPerf}

**DETECTED ANOMALIES:**
${analysis.anomalies.length > 0 ? analysis.anomalies.join('\n') : 'None detected'}

**SAMPLE TRADES (last 10):**
${JSON.stringify(analysis.trades.slice(-10), null, 2)}

**CURRENT CODE:**
${codeContext}

**YOUR TASK:**
Analyze the performance data and code to:
1. **Fix any bugs** you detect (especially if anomalies are present)
2. **Optimize parameters** within safety constraints
3. **Improve strategy logic** if you see clear issues

**PARAMETER SAFETY CONSTRAINTS:**
- RSI threshold: 30-40
- Take profit: 0.08-0.15%
- Stop loss: 0.20-0.50%
- Volume multiplier: 1.2-2.0x
- Breakeven timeout: 1-5 min
- Force close: 3-10 min

**RESPOND IN THIS EXACT JSON FORMAT:**
{
  "bugFixes": [
    {
      "file": "src/agent.ts",
      "issue": "PnL calculation includes collateral incorrectly",
      "fix": "FULL FILE CONTENT with bug fixed",
      "reasoning": "The ledger shows $8,490 fake profit because...",
      "confidence": "high"
    }
  ],
  "parameterChanges": [
    {
      "parameter": "targetProfitPercent",
      "currentValue": "0.10",
      "suggestedValue": "0.12",
      "reasoning": "75% of wins hit target <30sec",
      "expectedImpact": "+15% PnL per trade",
      "confidence": "high",
      "configPath": "targetProfitPercent"
    }
  ],
  "summary": "Overall analysis",
  "warnings": ["Patterns to watch"]
}

**IMPORTANT:**
- For bug fixes, provide COMPLETE file content, not diffs
- Only suggest changes you're confident about
- Mark confidence as 'low' if unsure (won't auto-apply)
- Prioritize bug fixes over optimizations`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/kallgit-codex/kallisti-scalper',
      'X-Title': 'Kallisti Scalper Optimizer + Bug Fixer'
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

function applyBugFixes(bugFixes: any[]): string[] {
  const appliedFixes: string[] = [];
  
  for (const fix of bugFixes) {
    if (fix.confidence === 'low') {
      console.log(`⏭️  Skipping low-confidence fix: ${fix.file}`);
      continue;
    }
    
    const filePath = path.join(__dirname, '..', fix.file);
    
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found: ${fix.file}`);
      continue;
    }
    
    // Write the fixed content
    fs.writeFileSync(filePath, fix.fix);
    appliedFixes.push(
      `🐛→✅ ${fix.file}: ${fix.issue}`
    );
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
  console.log('🤖 AUTONOMOUS OPTIMIZER + BUG FIXER\n');
  
  if (!OPENROUTER_KEY) {
    console.error('❌ OPENROUTER_KEY not set');
    process.exit(1);
  }
  
  // Analyze performance and detect anomalies
  const analysis = await analyzeLedger();
  console.log('📊 PERFORMANCE STATS:');
  console.log(JSON.stringify(analysis.stats, null, 2));
  
  if (analysis.anomalies.length > 0) {
    console.log('\n⚠️  ANOMALIES DETECTED:');
    analysis.anomalies.forEach(a => console.log(a));
  }
  
  // Read current code
  const codeFiles = readCodeFiles();
  console.log(`\n📁 Read ${Object.keys(codeFiles).length} code files`);
  
  // Get AI analysis (bugs + optimizations)
  console.log('\n🧠 Consulting Claude Opus 4.5 (best coding model)...\n');
  const result = await getOptimizerResponse(analysis, codeFiles);
  
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
  
  if (result.warnings && result.warnings.length > 0) {
    console.log(`⚠️  WARNINGS:`);
    result.warnings.forEach((w: string) => console.log(`   - ${w}`));
    console.log();
  }
  
  // Save report
  const reportPath = path.join(__dirname, '../data/optimization-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    analysis,
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
