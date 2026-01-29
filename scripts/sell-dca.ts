#!/usr/bin/env node
/**
 * Sell DCA Script
 * 
 * Sells a percentage of token balance at regular intervals.
 * DCA out of a position gradually instead of dumping.
 * 
 * Usage: npx tsx scripts/sell-dca.ts [--percent 5] [--interval 5] [--duration 60]
 * 
 * --percent: % of current balance to sell each time (default: 5)
 * --interval: minutes between sells (default: 5)
 * --duration: total minutes to run (default: 60)
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
const hasArg = (name: string) => args.includes(`--${name}`);

const SELL_PERCENT = getArg('percent', 5);
const INTERVAL_MIN = getArg('interval', 5);
const DURATION_MIN = getArg('duration', 60);
const ANNOUNCE = !hasArg('quiet');
const MIN_SELL_USD = getArg('minSell', 5);

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
  if (!ANNOUNCE) return;
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

// Execute Bankr prompt and wait for result
async function bankrPrompt(prompt: string, config: BankrConfig, timeoutMs = 120000): Promise<string> {
  console.log(`[BANKR] ${prompt}`);
  
  const submitRes = await fetch(`${config.apiUrl}/agent/prompt`, {
    method: 'POST',
    headers: { 'X-API-Key': config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  
  if (!submitRes.ok) throw new Error(`Submit failed: ${submitRes.status}`);
  const { jobId } = await submitRes.json() as { jobId: string };
  
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 2000));
    
    const statusRes = await fetch(`${config.apiUrl}/agent/job/${jobId}`, {
      headers: { 'X-API-Key': config.apiKey },
    });
    const status = await statusRes.json() as { status: string; response?: string; error?: string };
    
    if (status.status === 'completed') return status.response || '';
    if (status.status === 'failed') throw new Error(status.error || 'Failed');
  }
  
  throw new Error('Timeout');
}

// Parse balance from Bankr response
function parseBalance(response: string): number {
  const match = response.match(/[-–]\s*([0-9,]+\.?[0-9]*)/);
  if (match) return parseFloat(match[1].replace(/,/g, ''));
  const numMatch = response.match(/([0-9,]+\.?[0-9]*)/);
  if (numMatch) return parseFloat(numMatch[1].replace(/,/g, ''));
  return 0;
}

// Parse TX hash
function parseTxHash(response: string): string | undefined {
  const match = response.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0];
}

// Get current price from DexScreener
async function getPrice(): Promise<number> {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${TOKEN_ADDRESS}`);
  const data = await res.json() as { pairs?: { priceUsd?: string }[] };
  return parseFloat(data.pairs?.[0]?.priceUsd || '0');
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`
🦞 Sell DCA
═══════════════════════════════════════
Sell ${SELL_PERCENT}% every ${INTERVAL_MIN} min for ${DURATION_MIN} min
Token: ${TOKEN_SYMBOL} (${TOKEN_ADDRESS})
Announcements: ${ANNOUNCE ? 'ON' : 'OFF'}
═══════════════════════════════════════
`);

  const bankrConfig = loadBankrConfig();
  const startTime = Date.now();
  const endTime = startTime + DURATION_MIN * 60 * 1000;
  const intervalMs = INTERVAL_MIN * 60 * 1000;
  let sellCount = 0;
  let totalSoldUsd = 0;
  let nextSellTime = startTime; // First sell immediately

  if (ANNOUNCE) {
    await announce(`📤 <b>Sell DCA Started</b>

Selling ${SELL_PERCENT}% of ${TOKEN_SYMBOL} every ${INTERVAL_MIN} min
Duration: ${DURATION_MIN} min`);
  }

  while (Date.now() < endTime) {
    try {
      // Get current balance
      const balanceRes = await bankrPrompt(
        `What is my ${TOKEN_ADDRESS} balance on ${CHAIN}?`,
        bankrConfig
      );
      const balance = parseBalance(balanceRes);
      
      if (balance <= 0) {
        console.log('[DONE] No more tokens to sell');
        break;
      }

      // Get current price
      const price = await getPrice();
      const balanceUsd = balance * price;
      
      // Calculate sell amount
      const sellTokens = balance * (SELL_PERCENT / 100);
      const sellUsd = sellTokens * price;
      
      console.log(`\nBalance: ${balance.toLocaleString()} ${TOKEN_SYMBOL} ($${balanceUsd.toFixed(2)})`);
      console.log(`Selling ${SELL_PERCENT}%: ${sellTokens.toLocaleString()} tokens (~$${sellUsd.toFixed(2)})`);
      
      if (sellUsd < MIN_SELL_USD) {
        console.log(`[SKIP] Sell value $${sellUsd.toFixed(2)} below minimum $${MIN_SELL_USD}`);
        break;
      }

      // Execute sell (Bankr expects USD amounts)
      sellCount++;
      const sellRes = await bankrPrompt(
        `Sell $${sellUsd.toFixed(2)} worth of ${TOKEN_ADDRESS} on ${CHAIN}`,
        bankrConfig,
        180000
      );
      
      const txHash = parseTxHash(sellRes);
      totalSoldUsd += sellUsd;
      
      const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
      const remaining = ((endTime - Date.now()) / 60000).toFixed(0);
      
      console.log(`[SELL ${sellCount}] ~$${sellUsd.toFixed(2)} | Total: $${totalSoldUsd.toFixed(2)} | ${elapsed}min elapsed, ${remaining}min left`);
      
      if (ANNOUNCE) {
        const txLink = txHash ? `\n\nhttps://basescan.org/tx/${txHash}` : '';
        await announce(`📤 <b>Sell ${sellCount}</b>

Amount: ~$${sellUsd.toFixed(2)}
Total sold: $${totalSoldUsd.toFixed(2)}
Remaining: ${remaining} min${txLink}`);
      }

      // Schedule next sell (interval from START of each sell, not end)
      nextSellTime += intervalMs;
      const waitMs = Math.max(0, nextSellTime - Date.now());
      
      if (waitMs > 0 && Date.now() < endTime) {
        console.log(`[WAIT] ${(waitMs / 60000).toFixed(1)} min until next sell...`);
        await sleep(waitMs);
      }

    } catch (err) {
      console.error(`[ERROR] ${err}`);
      await sleep(30000); // Wait 30s on error
    }
  }

  const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);
  
  console.log(`\n
═══════════════════════════════════════
✅ SELL DCA COMPLETE
Sells: ${sellCount}
Total sold: ~$${totalSoldUsd.toFixed(2)}
Time: ${totalTime} min
═══════════════════════════════════════
`);

  if (ANNOUNCE) {
    await announce(`✅ <b>Sell DCA Complete</b>

Sells: ${sellCount}
Total: ~$${totalSoldUsd.toFixed(2)}
Duration: ${totalTime} min`);
  }
}

main().catch(console.error);
