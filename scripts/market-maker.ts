#!/usr/bin/env node
/**
 * LGI Market Maker - Volume Generator
 * 
 * Trades every 8-12 minutes with randomized amounts.
 * Buys when price is below 30min MA, sells when above.
 * Maintains 20-80% token ratio bounds.
 * 
 * Uses Bankr wallet (NOT the fee claim wallet).
 * 
 * Usage: npx tsx scripts/market-maker.ts [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Token
  tokenAddress: '0x0cfd1cdf700bc0eff5c238454362e3fa8fed9b07',
  tokenSymbol: 'LGI',
  chain: 'base',
  
  // Timing (randomized)
  // Note: Bankr API calls add ~1-2 min per cycle, so actual trade frequency is interval + API time
  intervalMinMinutes: 0,
  intervalMaxMinutes: 1,
  
  // Trade size (randomized, USD)
  tradeSizeMin: 8,
  tradeSizeMax: 18,
  
  // Moving average
  maPeriodMinutes: 30,
  priceCheckIntervalMinutes: 3,  // How often to update price history
  
  // Safety bounds (token ratio)
  minTokenRatio: 0.35,
  maxTokenRatio: 0.65,
  
  // Files
  snapshotFile: 'mm-snapshot.json',
  stateFile: 'mm-state.json',
  
  // Telegram
  telegramChannel: '@lgi_journey',
};

// =============================================================================
// TYPES
// =============================================================================

interface Snapshot {
  createdAt: string;
  wallet: string;
  initial: {
    tokenBalance: number;
    ethBalance: number;
    tokenPrice: number;
    ethPriceUsd: number;
    tokenValueUsd: number;
    ethValueUsd: number;
    totalValueUsd: number;
    tokenRatio: number;
  };
  config: typeof CONFIG;
}

interface State {
  priceHistory: { price: number; timestamp: number }[];
  lastTradeTime: number;
  totalBuys: number;
  totalSells: number;
  totalBuyVolume: number;
  totalSellVolume: number;
}

interface BankrConfig {
  apiKey: string;
  apiUrl: string;
}

// =============================================================================
// UTILITIES
// =============================================================================

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const randomBetween = (min: number, max: number) => 
  Math.random() * (max - min) + min;

const randomInt = (min: number, max: number) => 
  Math.floor(randomBetween(min, max + 1));

function log(msg: string, data?: object) {
  const ts = new Date().toISOString().slice(11, 19);
  if (data) {
    console.log(`[${ts}] ${msg}`, JSON.stringify(data));
  } else {
    console.log(`[${ts}] ${msg}`);
  }
}

// =============================================================================
// BANKR CLIENT
// =============================================================================

function loadBankrConfig(): BankrConfig {
  const path = join(process.env.HOME || '', '.clawdbot', 'skills', 'bankr', 'config.json');
  const content = readFileSync(path, 'utf-8');
  const config = JSON.parse(content);
  return { apiKey: config.apiKey, apiUrl: config.apiUrl || 'https://api.bankr.bot' };
}

async function bankrPrompt(prompt: string, config: BankrConfig, timeoutMs = 120000): Promise<string> {
  log(`[BANKR] ${prompt}`);
  
  const submitRes = await fetch(`${config.apiUrl}/agent/prompt`, {
    method: 'POST',
    headers: { 'X-API-Key': config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  
  if (!submitRes.ok) throw new Error(`Bankr submit failed: ${submitRes.status}`);
  const { jobId } = await submitRes.json() as { jobId: string };
  
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(2000);
    
    const statusRes = await fetch(`${config.apiUrl}/agent/job/${jobId}`, {
      headers: { 'X-API-Key': config.apiKey },
    });
    const status = await statusRes.json() as { status: string; response?: string; error?: string };
    
    if (status.status === 'completed') {
      log(`[BANKR] Response: ${status.response?.slice(0, 100)}...`);
      return status.response || '';
    }
    if (status.status === 'failed') throw new Error(status.error || 'Failed');
  }
  
  throw new Error('Bankr timeout');
}

function parseBalance(response: string): number {
  // Handle "TOKEN - 123456.789" format
  const match = response.match(/[-–]\s*([0-9,]+\.?[0-9]*)/);
  if (match) return parseFloat(match[1].replace(/,/g, ''));
  
  // Fallback: find any number
  const numMatch = response.match(/([0-9,]+\.?[0-9]*)/);
  if (numMatch) return parseFloat(numMatch[1].replace(/,/g, ''));
  
  return 0;
}

function parseTxHash(response: string): string | undefined {
  const match = response.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0];
}

// =============================================================================
// PRICE & DATA
// =============================================================================

async function getTokenPrice(): Promise<number> {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CONFIG.tokenAddress}`);
  const data = await res.json() as { pairs?: { priceUsd?: string }[] };
  return parseFloat(data.pairs?.[0]?.priceUsd || '0');
}

async function getEthPrice(): Promise<number> {
  const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/0x4200000000000000000000000000000000000006');
  const data = await res.json() as { pairs?: { priceUsd?: string }[] };
  return parseFloat(data.pairs?.[0]?.priceUsd || '3000');
}

function calculateMA(priceHistory: { price: number; timestamp: number }[]): number {
  if (priceHistory.length === 0) return 0;
  const sum = priceHistory.reduce((acc, p) => acc + p.price, 0);
  return sum / priceHistory.length;
}

// =============================================================================
// TELEGRAM
// =============================================================================

function loadTelegramToken(): string | null {
  const path = join(process.env.HOME || '', '.clawdbot', 'secrets', 'telegram-lgi.json');
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content).botToken;
}

async function announce(message: string): Promise<void> {
  const token = loadTelegramToken();
  if (!token) return;
  
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChannel,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    log(`Telegram error: ${e}`);
  }
}

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

function loadSnapshot(): Snapshot | null {
  const path = join(process.cwd(), CONFIG.snapshotFile);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveSnapshot(snapshot: Snapshot): void {
  const path = join(process.cwd(), CONFIG.snapshotFile);
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
}

function loadState(): State {
  const path = join(process.cwd(), CONFIG.stateFile);
  if (!existsSync(path)) {
    return {
      priceHistory: [],
      lastTradeTime: 0,
      totalBuys: 0,
      totalSells: 0,
      totalBuyVolume: 0,
      totalSellVolume: 0,
    };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveState(state: State): void {
  const path = join(process.cwd(), CONFIG.stateFile);
  writeFileSync(path, JSON.stringify(state, null, 2));
}

// =============================================================================
// CORE LOGIC (to be implemented in next commit)
// =============================================================================

async function createSnapshot(bankrConfig: BankrConfig): Promise<Snapshot> {
  log('Creating initial snapshot...');
  
  // Get balances from Bankr
  const tokenRes = await bankrPrompt(
    `What is my ${CONFIG.tokenAddress} balance on ${CONFIG.chain}?`,
    bankrConfig
  );
  const tokenBalance = parseBalance(tokenRes);
  
  const ethRes = await bankrPrompt(
    `What is my ETH balance on ${CONFIG.chain}?`,
    bankrConfig
  );
  const ethBalance = parseBalance(ethRes);
  
  // Get prices
  const tokenPrice = await getTokenPrice();
  const ethPriceUsd = await getEthPrice();
  
  // Calculate values
  const tokenValueUsd = tokenBalance * tokenPrice;
  const ethValueUsd = ethBalance * ethPriceUsd;
  const totalValueUsd = tokenValueUsd + ethValueUsd;
  const tokenRatio = totalValueUsd > 0 ? tokenValueUsd / totalValueUsd : 0;
  
  const snapshot: Snapshot = {
    createdAt: new Date().toISOString(),
    wallet: 'bankr-managed (NOT fee claim wallet 0x0497...)',
    initial: {
      tokenBalance,
      ethBalance,
      tokenPrice,
      ethPriceUsd,
      tokenValueUsd,
      ethValueUsd,
      totalValueUsd,
      tokenRatio,
    },
    config: CONFIG,
  };
  
  saveSnapshot(snapshot);
  log('Snapshot saved', snapshot.initial);
  
  return snapshot;
}

// =============================================================================
// TRADING LOGIC
// =============================================================================

async function getCurrentPosition(bankrConfig: BankrConfig): Promise<{
  tokenBalance: number;
  ethBalance: number;
  tokenPrice: number;
  ethPriceUsd: number;
  tokenValueUsd: number;
  ethValueUsd: number;
  totalValueUsd: number;
  tokenRatio: number;
}> {
  // Get balances
  const tokenRes = await bankrPrompt(
    `What is my ${CONFIG.tokenAddress} balance on ${CONFIG.chain}?`,
    bankrConfig
  );
  const tokenBalance = parseBalance(tokenRes);
  
  const ethRes = await bankrPrompt(
    `What is my ETH balance on ${CONFIG.chain}?`,
    bankrConfig
  );
  const ethBalance = parseBalance(ethRes);
  
  // Get prices
  const tokenPrice = await getTokenPrice();
  const ethPriceUsd = await getEthPrice();
  
  // Calculate
  const tokenValueUsd = tokenBalance * tokenPrice;
  const ethValueUsd = ethBalance * ethPriceUsd;
  const totalValueUsd = tokenValueUsd + ethValueUsd;
  const tokenRatio = totalValueUsd > 0 ? tokenValueUsd / totalValueUsd : 0;
  
  return {
    tokenBalance,
    ethBalance,
    tokenPrice,
    ethPriceUsd,
    tokenValueUsd,
    ethValueUsd,
    totalValueUsd,
    tokenRatio,
  };
}

async function executeTrade(
  action: 'BUY' | 'SELL',
  amountUsd: number,
  bankrConfig: BankrConfig,
  dryRun: boolean
): Promise<{ success: boolean; txHash?: string }> {
  const prompt = action === 'BUY'
    ? `Buy $${amountUsd.toFixed(2)} worth of ${CONFIG.tokenAddress} on ${CONFIG.chain}`
    : `Sell $${amountUsd.toFixed(2)} worth of ${CONFIG.tokenAddress} on ${CONFIG.chain}`;
  
  if (dryRun) {
    log(`[DRY RUN] Would execute: ${prompt}`);
    return { success: true };
  }
  
  try {
    const response = await bankrPrompt(prompt, bankrConfig, 180000);
    const txHash = parseTxHash(response);
    return { success: true, txHash };
  } catch (err) {
    log(`Trade failed: ${err}`);
    return { success: false };
  }
}

function updatePriceHistory(
  state: State,
  price: number,
  maPeriodMs: number
): void {
  const now = Date.now();
  
  // Add new price
  state.priceHistory.push({ price, timestamp: now });
  
  // Remove old prices (older than MA period)
  const cutoff = now - maPeriodMs;
  state.priceHistory = state.priceHistory.filter(p => p.timestamp > cutoff);
}

function decideAction(
  currentPrice: number,
  ma: number,
  tokenRatio: number
): 'BUY' | 'SELL' | 'HOLD' {
  // Check ratio bounds first
  if (tokenRatio >= CONFIG.maxTokenRatio) {
    log(`Token ratio ${(tokenRatio * 100).toFixed(1)}% at max, forcing SELL`);
    return 'SELL';
  }
  if (tokenRatio <= CONFIG.minTokenRatio) {
    log(`Token ratio ${(tokenRatio * 100).toFixed(1)}% at min, forcing BUY`);
    return 'BUY';
  }
  
  // No MA yet? Hold
  if (ma === 0) {
    log('No MA data yet, holding');
    return 'HOLD';
  }
  
  // Price vs MA decision
  const deviation = (currentPrice - ma) / ma;
  
  if (currentPrice < ma) {
    log(`Price $${currentPrice.toFixed(10)} below MA $${ma.toFixed(10)} (${(deviation * 100).toFixed(2)}%) → BUY`);
    return 'BUY';
  } else {
    log(`Price $${currentPrice.toFixed(10)} above MA $${ma.toFixed(10)} (${(deviation * 100).toFixed(2)}%) → SELL`);
    return 'SELL';
  }
}

// =============================================================================
// MAIN LOOP
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  console.log(`
🦞 LGI Market Maker
═══════════════════════════════════════
Token: ${CONFIG.tokenSymbol}
Interval: ${CONFIG.intervalMinMinutes}-${CONFIG.intervalMaxMinutes} min
Trade size: $${CONFIG.tradeSizeMin}-${CONFIG.tradeSizeMax}
MA period: ${CONFIG.maPeriodMinutes} min
Ratio bounds: ${CONFIG.minTokenRatio * 100}% - ${CONFIG.maxTokenRatio * 100}%
Dry run: ${dryRun}
═══════════════════════════════════════
`);

  const bankrConfig = loadBankrConfig();
  const maPeriodMs = CONFIG.maPeriodMinutes * 60 * 1000;
  
  // Load or create snapshot
  let snapshot = loadSnapshot();
  if (!snapshot) {
    snapshot = await createSnapshot(bankrConfig);
    await announce(`🦞 <b>Market Maker Started</b>

Initial snapshot:
- Tokens: ${snapshot.initial.tokenBalance.toLocaleString()} ${CONFIG.tokenSymbol}
- ETH: ${snapshot.initial.ethBalance.toFixed(4)}
- Total value: $${snapshot.initial.totalValueUsd.toFixed(2)}
- Token ratio: ${(snapshot.initial.tokenRatio * 100).toFixed(1)}%

Trading every 8-12 min with $8-18 random sizes.
Direction: below 30m MA = BUY, above = SELL`);
  } else {
    log('Loaded existing snapshot', { createdAt: snapshot.createdAt });
  }
  
  // Load state
  let state = loadState();
  log('State loaded', { 
    priceHistoryLength: state.priceHistory.length,
    totalBuys: state.totalBuys,
    totalSells: state.totalSells,
  });
  
  // Graceful shutdown
  let running = true;
  process.on('SIGINT', () => {
    log('Shutdown requested...');
    running = false;
  });
  process.on('SIGTERM', () => {
    log('Shutdown requested...');
    running = false;
  });
  
  log('Starting main trading loop...');
  
  // Initial price fetch to seed MA
  const initialPrice = await getTokenPrice();
  updatePriceHistory(state, initialPrice, maPeriodMs);
  saveState(state);
  log(`Initial price: $${initialPrice.toFixed(10)}`);
  
  // Main loop
  while (running) {
    try {
      // Random interval for this cycle
      const intervalMin = randomBetween(
        CONFIG.intervalMinMinutes,
        CONFIG.intervalMaxMinutes
      );
      const intervalMs = intervalMin * 60 * 1000;
      
      log(`Waiting ${intervalMin.toFixed(1)} min until next trade...`);
      
      // Wait (but check for shutdown periodically)
      const waitStart = Date.now();
      while (running && Date.now() - waitStart < intervalMs) {
        await sleep(10000); // Check every 10s
        
        // Update price history every few minutes
        if (Date.now() - waitStart > CONFIG.priceCheckIntervalMinutes * 60 * 1000) {
          const price = await getTokenPrice();
          updatePriceHistory(state, price, maPeriodMs);
          saveState(state);
        }
      }
      
      if (!running) break;
      
      // Get current position
      log('Fetching current position...');
      const position = await getCurrentPosition(bankrConfig);
      
      // Update price history
      updatePriceHistory(state, position.tokenPrice, maPeriodMs);
      
      // Calculate MA
      const ma = calculateMA(state.priceHistory);
      
      log(`Position: ${position.tokenBalance.toLocaleString()} tokens ($${position.tokenValueUsd.toFixed(2)}) + ${position.ethBalance.toFixed(4)} ETH ($${position.ethValueUsd.toFixed(2)})`);
      log(`Token ratio: ${(position.tokenRatio * 100).toFixed(1)}% | MA: $${ma.toFixed(10)} (${state.priceHistory.length} samples)`);
      
      // Decide action
      const action = decideAction(position.tokenPrice, ma, position.tokenRatio);
      
      if (action === 'HOLD') {
        log('Holding this round');
        saveState(state);
        continue;
      }
      
      // Random trade size
      const tradeSize = randomBetween(CONFIG.tradeSizeMin, CONFIG.tradeSizeMax);
      
      // Check if we have enough balance
      if (action === 'BUY' && position.ethValueUsd < tradeSize) {
        log(`Not enough ETH ($${position.ethValueUsd.toFixed(2)}) for $${tradeSize.toFixed(2)} buy`);
        saveState(state);
        continue;
      }
      if (action === 'SELL' && position.tokenValueUsd < tradeSize) {
        log(`Not enough tokens ($${position.tokenValueUsd.toFixed(2)}) for $${tradeSize.toFixed(2)} sell`);
        saveState(state);
        continue;
      }
      
      // Execute trade
      log(`Executing ${action} $${tradeSize.toFixed(2)}...`);
      const result = await executeTrade(action, tradeSize, bankrConfig, dryRun);
      
      if (result.success) {
        // Update stats
        if (action === 'BUY') {
          state.totalBuys++;
          state.totalBuyVolume += tradeSize;
        } else {
          state.totalSells++;
          state.totalSellVolume += tradeSize;
        }
        state.lastTradeTime = Date.now();
        
        const totalTrades = state.totalBuys + state.totalSells;
        const totalVolume = state.totalBuyVolume + state.totalSellVolume;
        
        log(`${action} successful! Total: ${totalTrades} trades, $${totalVolume.toFixed(2)} volume`);
        
        // Announce
        const txLink = result.txHash ? `\n\nhttps://basescan.org/tx/${result.txHash}` : '';
        await announce(`${action === 'BUY' ? '🟢' : '🔴'} <b>MM ${action}</b>: $${tradeSize.toFixed(2)}

Price: $${position.tokenPrice.toFixed(10)}
MA: $${ma.toFixed(10)}
Ratio: ${(position.tokenRatio * 100).toFixed(1)}%

Total: ${totalTrades} trades | $${totalVolume.toFixed(2)} volume${txLink}`);
      }
      
      saveState(state);
      
    } catch (err) {
      log(`Error in main loop: ${err}`);
      await sleep(30000); // Wait 30s on error
    }
  }
  
  log('Market maker stopped');
  await announce(`🛑 <b>Market Maker Stopped</b>

Final stats:
- Buys: ${state.totalBuys} ($${state.totalBuyVolume.toFixed(2)})
- Sells: ${state.totalSells} ($${state.totalSellVolume.toFixed(2)})
- Total volume: $${(state.totalBuyVolume + state.totalSellVolume).toFixed(2)}`);
}

main().catch(console.error);
