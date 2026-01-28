#!/usr/bin/env node
/**
 * Rapid Accumulation Script
 * 
 * Buys a target amount with randomized intervals and amounts
 * to simulate organic buying activity.
 * 
 * Usage: npx tsx scripts/rapid-accumulate.ts [--target 900] [--min 40] [--max 80]
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Config
const TOKEN_ADDRESS = '0x0cfd1cdf700bc0eff5c238454362e3fa8fed9b07';
const TOKEN_SYMBOL = 'LGI';
const CHAIN = 'base';
const TELEGRAM_CHANNEL = '@lgi_journey';

// Parse args
const args = process.argv.slice(2);
const getArg = (name: string, def: number) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? parseFloat(args[idx + 1]) : def;
};

const TARGET_USD = getArg('target', 900);
const MIN_BUY = getArg('min', 40);
const MAX_BUY = getArg('max', 80);
const MIN_INTERVAL_MS = getArg('minInterval', 10) * 1000;
const MAX_INTERVAL_MS = getArg('maxInterval', 30) * 1000;

// Load Bankr config
interface BankrConfig { apiKey: string; apiUrl: string; }

function loadBankrConfig(): BankrConfig {
  const path = join(process.env.HOME || '', '.clawdbot', 'skills', 'bankr', 'config.json');
  const content = readFileSync(path, 'utf-8');
  const config = JSON.parse(content);
  return { apiKey: config.apiKey, apiUrl: config.apiUrl || 'https://api.bankr.bot' };
}

// Load Telegram config
function loadTelegramToken(): string | null {
  const path = join(process.env.HOME || '', '.clawdbot', 'secrets', 'telegram-lgi.json');
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content).botToken;
}

// Telegram announce
async function announce(message: string): Promise<void> {
  const token = loadTelegramToken();
  if (!token) return;
  
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHANNEL,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error('Telegram error:', e);
  }
}

// Execute Bankr prompt
async function bankrBuy(amountUsd: number, config: BankrConfig): Promise<{ success: boolean; response: string; txHash?: string }> {
  const prompt = `Buy $${amountUsd} worth of ${TOKEN_ADDRESS} on ${CHAIN}`;
  console.log(`[BUY] ${prompt}`);
  
  // Submit
  const submitRes = await fetch(`${config.apiUrl}/agent/prompt`, {
    method: 'POST',
    headers: { 'X-API-Key': config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  
  if (!submitRes.ok) {
    return { success: false, response: `Submit failed: ${submitRes.status}` };
  }
  
  const { jobId } = await submitRes.json() as { jobId: string };
  
  // Poll for completion (max 3 min)
  const maxWait = 180000;
  const start = Date.now();
  
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 2000));
    
    const statusRes = await fetch(`${config.apiUrl}/agent/job/${jobId}`, {
      headers: { 'X-API-Key': config.apiKey },
    });
    
    const status = await statusRes.json() as { status: string; response?: string; error?: string };
    
    if (status.status === 'completed') {
      const txMatch = status.response?.match(/0x[a-fA-F0-9]{64}/);
      return { success: true, response: status.response || '', txHash: txMatch?.[0] };
    }
    
    if (status.status === 'failed') {
      return { success: false, response: status.error || 'Failed' };
    }
  }
  
  return { success: false, response: 'Timeout' };
}

// Random helpers
const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;
const randomInt = (min: number, max: number) => Math.floor(randomBetween(min, max));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Main
async function main() {
  console.log(`
🦞 Rapid Accumulation
═══════════════════════════════════════
Target: $${TARGET_USD}
Buy range: $${MIN_BUY} - $${MAX_BUY}
Interval: ${MIN_INTERVAL_MS/1000}s - ${MAX_INTERVAL_MS/1000}s
Token: ${TOKEN_SYMBOL} (${TOKEN_ADDRESS})
═══════════════════════════════════════
`);

  const bankrConfig = loadBankrConfig();
  
  let totalSpent = 0;
  let buyCount = 0;
  const startTime = Date.now();
  
  await announce(`🚀 <b>Rapid Accumulation Started</b>

Target: $${TARGET_USD} of ${TOKEN_SYMBOL}
Buy range: $${MIN_BUY}-$${MAX_BUY}
Random intervals for organic look

Lets go...`);

  while (totalSpent < TARGET_USD) {
    // Random buy amount (don't exceed remaining)
    const remaining = TARGET_USD - totalSpent;
    const buyAmount = Math.min(randomInt(MIN_BUY, MAX_BUY + 1), remaining);
    
    if (buyAmount < 5) break; // Min trade size
    
    buyCount++;
    console.log(`\n[${buyCount}] Buying $${buyAmount}...`);
    
    const result = await bankrBuy(buyAmount, bankrConfig);
    
    if (result.success) {
      totalSpent += buyAmount;
      const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
      const progress = ((totalSpent / TARGET_USD) * 100).toFixed(0);
      
      console.log(`[OK] $${totalSpent}/$${TARGET_USD} (${progress}%) - ${elapsed}min elapsed`);
      
      // Announce every buy
      const txLink = result.txHash 
        ? `\n\nhttps://basescan.org/tx/${result.txHash}`
        : '';
      
      await announce(`🦞 <b>Buy ${buyCount}</b>: $${buyAmount}

Progress: $${totalSpent} / $${TARGET_USD} (${progress}%)
Time: ${elapsed} min${txLink}`);
      
    } else {
      console.log(`[FAIL] ${result.response}`);
      await announce(`⚠️ Buy ${buyCount} failed: ${result.response.slice(0, 100)}`);
    }
    
    // Random wait before next buy
    if (totalSpent < TARGET_USD) {
      const waitMs = randomInt(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
      console.log(`[WAIT] ${(waitMs/1000).toFixed(0)}s before next buy...`);
      await sleep(waitMs);
    }
  }
  
  const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);
  
  console.log(`\n
═══════════════════════════════════════
✅ COMPLETE
Total spent: $${totalSpent}
Buys: ${buyCount}
Time: ${totalTime} min
═══════════════════════════════════════
`);

  await announce(`✅ <b>Accumulation Complete</b>

Total: $${totalSpent}
Buys: ${buyCount}
Time: ${totalTime} min

${TOKEN_SYMBOL} bag secured 🦞`);
}

main().catch(console.error);
