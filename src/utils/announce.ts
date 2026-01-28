/**
 * Telegram announcement utility for LGI Market Maker
 * Broadcasts trade updates to @lgi_journey
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';

const TELEGRAM_CHANNEL = '@lgi_journey';

interface TelegramConfig {
  botToken: string;
}

/**
 * Load Telegram bot token from secrets
 */
function loadTelegramConfig(): TelegramConfig | null {
  const path = join(process.env.HOME || '', '.clawdbot', 'secrets', 'telegram-lgi.json');
  
  if (!existsSync(path)) {
    logger.warn('Telegram config not found, announcements disabled');
    return null;
  }
  
  try {
    const content = readFileSync(path, 'utf-8');
    const config = JSON.parse(content);
    return { botToken: config.botToken };
  } catch (err) {
    logger.warn(`Failed to load Telegram config: ${err}`);
    return null;
  }
}

// Cache the config
let telegramConfig: TelegramConfig | null | undefined = undefined;

/**
 * Send announcement to Telegram channel
 */
export async function announce(message: string): Promise<boolean> {
  // Lazy load config
  if (telegramConfig === undefined) {
    telegramConfig = loadTelegramConfig();
  }
  
  if (!telegramConfig) {
    logger.debug('Telegram not configured, skipping announcement');
    return false;
  }
  
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHANNEL,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );
    
    if (!response.ok) {
      const err = await response.text();
      logger.error(`Telegram announcement failed: ${err}`);
      return false;
    }
    
    logger.info('Telegram announcement sent');
    return true;
  } catch (err) {
    logger.error(`Telegram announcement error: ${err}`);
    return false;
  }
}

/**
 * Format and announce a buy trade
 */
export async function announceBuy(params: {
  token: string;
  tokenAddress: string;
  chain: string;
  amountUsd: number;
  tokensReceived: number;
  price: number;
  totalAccumulated: number;
  maxBudget: number;
  reason: 'DCA' | 'DIP_BUY';
  txHash?: string;
}): Promise<void> {
  const {
    token,
    tokenAddress: _tokenAddress,
    chain,
    amountUsd,
    tokensReceived,
    price,
    totalAccumulated,
    maxBudget,
    reason,
    txHash,
  } = params;
  
  const emoji = reason === 'DIP_BUY' ? '📉' : '🦞';
  const reasonText = reason === 'DIP_BUY' ? 'Dip Buy' : 'DCA Buy';
  const progress = ((totalAccumulated / maxBudget) * 100).toFixed(1);
  
  // Format price nicely (handle small decimals)
  const priceStr = price < 0.01 
    ? price.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
    : price.toFixed(6);
  
  // Format token amount
  const tokensStr = tokensReceived > 1000 
    ? tokensReceived.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : tokensReceived.toFixed(2);
  
  let message = `${emoji} <b>LGI-MM ${reasonText}</b>

<b>Token:</b> ${token}
<b>Amount:</b> $${amountUsd.toFixed(2)}
<b>Received:</b> ${tokensStr} ${token}
<b>Price:</b> $${priceStr}

<b>Progress:</b> $${totalAccumulated.toFixed(2)} / $${maxBudget} (${progress}%)`;

  if (txHash) {
    const explorerUrl = chain === 'base' 
      ? `https://basescan.org/tx/${txHash}`
      : `https://etherscan.io/tx/${txHash}`;
    message += `\n\n${explorerUrl}`;
  }
  
  await announce(message);
}
