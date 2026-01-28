/**
 * Telegram announcement utility for LGI Market Maker
 * Broadcasts trade updates to configured channel
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';
import type { AnnouncementsConfig } from '../types/index.js';

const DEFAULT_BOT_TOKEN_PATH = join(
  process.env.HOME || '', 
  '.clawdbot', 
  'secrets', 
  'telegram-lgi.json'
);

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Load Telegram bot token from secrets file
 */
function loadBotToken(tokenPath?: string): string | null {
  const path = tokenPath || DEFAULT_BOT_TOKEN_PATH;
  
  if (!existsSync(path)) {
    logger.warn(`Telegram token file not found: ${path}`);
    return null;
  }
  
  try {
    const content = readFileSync(path, 'utf-8');
    const config = JSON.parse(content);
    return config.botToken;
  } catch (err) {
    logger.warn(`Failed to load Telegram token: ${err}`);
    return null;
  }
}

/**
 * Initialize announcer with config
 * Returns null if announcements disabled or not configured
 */
export function createAnnouncer(config: AnnouncementsConfig) {
  if (!config.enabled) {
    logger.info('Announcements disabled');
    return null;
  }
  
  if (!config.telegram?.chatId) {
    logger.warn('Announcements enabled but no telegram.chatId configured');
    return null;
  }
  
  const botToken = loadBotToken(config.telegram.botTokenPath);
  if (!botToken) {
    logger.warn('Announcements enabled but could not load bot token');
    return null;
  }
  
  const telegramConfig: TelegramConfig = {
    botToken,
    chatId: config.telegram.chatId,
  };
  
  logger.info(`Announcements enabled for ${telegramConfig.chatId}`);
  
  return {
    /**
     * Send raw message to Telegram
     */
    async send(message: string): Promise<boolean> {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramConfig.chatId,
              text: message,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          }
        );
        
        if (!response.ok) {
          const err = await response.text();
          logger.error(`Telegram send failed: ${err}`);
          return false;
        }
        
        logger.info('Telegram announcement sent');
        return true;
      } catch (err) {
        logger.error(`Telegram error: ${err}`);
        return false;
      }
    },
    
    /**
     * Announce a buy trade
     */
    async announceBuy(params: {
      token: string;
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
      
      // Format price (handle small decimals)
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
      
      await this.send(message);
    },
  };
}

// Export type for the announcer
export type Announcer = ReturnType<typeof createAnnouncer>;
