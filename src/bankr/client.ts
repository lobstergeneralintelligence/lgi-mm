/**
 * Bankr integration client
 * 
 * Bankr is a natural language trading API. This client wraps
 * the interaction patterns we need for market making.
 * 
 * API Flow:
 * 1. POST /agent/prompt → get jobId
 * 2. Poll GET /agent/job/{id} until completed
 * 3. Parse natural language response
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import type { Chain, PriceData, Position, Trade } from '../types/index.js';

export interface BankrClientOptions {
  mode: 'live' | 'simulation';
  chain: Chain;
}

export interface BankrClient {
  getPrice(token: string, quote: string, tokenAddress?: string): Promise<PriceData>;
  getBalance(token: string, tokenAddress?: string): Promise<number>;
  buy(token: string, amountUsd: number, tokenAddress?: string): Promise<Trade>;
  sell(token: string, amountUsd: number, tokenAddress?: string): Promise<Trade>;
  getPosition(baseToken: string, quoteToken: string, baseAddress?: string, quoteAddress?: string): Promise<Position>;
}

interface BankrConfig {
  apiKey: string;
  apiUrl: string;
}

interface JobResponse {
  success: boolean;
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  response?: string;
  error?: string;
}

/**
 * Load Bankr API configuration
 */
function loadBankrConfig(): BankrConfig {
  const paths = [
    join(process.env.HOME || '', '.clawdbot', 'skills', 'bankr', 'config.json'),
  ];

  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        const config = JSON.parse(content);
        return {
          apiKey: config.apiKey || '',
          apiUrl: config.apiUrl || 'https://api.bankr.bot',
        };
      } catch (err) {
        logger.warn(`Failed to read Bankr config from ${path}: ${err}`);
      }
    }
  }

  throw new Error('Bankr config not found. Install and configure the bankr skill first.');
}

/**
 * Submit a prompt to Bankr and wait for completion
 */
async function executeBankrPrompt(
  prompt: string,
  config: BankrConfig,
  maxWaitMs: number = 120_000
): Promise<string> {
  logger.debug(`Bankr prompt: ${prompt}`);

  // Submit the prompt
  const submitResponse = await fetch(`${config.apiUrl}/agent/prompt`, {
    method: 'POST',
    headers: {
      'X-API-Key': config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
  });

  if (!submitResponse.ok) {
    throw new Error(`Bankr submit failed: ${submitResponse.status} ${submitResponse.statusText}`);
  }

  const submitResult = await submitResponse.json() as JobResponse;
  
  if (!submitResult.success || !submitResult.jobId) {
    throw new Error(`Bankr submit failed: ${JSON.stringify(submitResult)}`);
  }

  const jobId = submitResult.jobId;
  logger.debug(`Bankr job submitted: ${jobId}`);

  // Poll for completion
  const startTime = Date.now();
  const pollIntervalMs = 2000;

  while (Date.now() - startTime < maxWaitMs) {
    await sleep(pollIntervalMs);

    const statusResponse = await fetch(`${config.apiUrl}/agent/job/${jobId}`, {
      headers: {
        'X-API-Key': config.apiKey,
      },
    });

    if (!statusResponse.ok) {
      throw new Error(`Bankr status check failed: ${statusResponse.status}`);
    }

    const statusResult = await statusResponse.json() as JobResponse;

    switch (statusResult.status) {
      case 'completed':
        logger.debug(`Bankr job completed in ${Date.now() - startTime}ms`);
        return statusResult.response || '';
      
      case 'failed':
        throw new Error(`Bankr job failed: ${statusResult.error || 'Unknown error'}`);
      
      case 'cancelled':
        throw new Error('Bankr job was cancelled');
      
      case 'pending':
      case 'processing':
        // Continue polling
        break;
      
      default:
        logger.warn(`Unknown Bankr status: ${statusResult.status}`);
    }
  }

  throw new Error(`Bankr job timed out after ${maxWaitMs}ms`);
}

/**
 * Parse a price from natural language response
 * Handles formats like "$3,032.65", "3032.65", "$0.00001234"
 */
function parsePrice(response: string): number | null {
  // Look for price patterns
  const patterns = [
    /\$([0-9,]+\.?[0-9]*)/,           // $3,032.65
    /price:?\s*\$?([0-9,]+\.?[0-9]*)/i, // price: $3032.65
    /trading at \$?([0-9,]+\.?[0-9]*)/i, // trading at $3032.65
    /([0-9,]+\.?[0-9]*)\s*(?:USD|USDC)/i, // 3032.65 USD
  ];

  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match) {
      const numStr = match[1].replace(/,/g, '');
      const num = parseFloat(numStr);
      if (!isNaN(num) && num > 0) {
        return num;
      }
    }
  }

  return null;
}

/**
 * Parse a balance from natural language response
 * Handles Bankr formats like:
 * - "ETH - 0.002732388974206735 ($8.30)"
 * - "Token (0xbbd9...) - 1260425.075644998881241559 on Base"
 */
function parseBalance(response: string, token: string): number | null {
  // Look for balance patterns - order matters, most specific first
  const patterns = [
    // Bankr format: "TOKEN - NUMBER" or "Token (0x...) - NUMBER"
    /[-–]\s*([0-9,]+\.?[0-9]*)/,
    // Standard formats
    new RegExp(`([0-9,]+\\.?[0-9]*)\\s*${token}`, 'i'),
    new RegExp(`${token}:?\\s*([0-9,]+\\.?[0-9]*)`, 'i'),
    /balance:?\s*\$?([0-9,]+\.?[0-9]*)/i,
  ];

  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match) {
      const numStr = match[1].replace(/,/g, '');
      const num = parseFloat(numStr);
      if (!isNaN(num)) {
        return num;
      }
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a Bankr client
 */
export function createBankrClient(options: BankrClientOptions): BankrClient {
  const { mode, chain } = options;

  logger.info(`Bankr client initialized`, { mode, chain });

  // Load config for live mode
  let bankrConfig: BankrConfig | null = null;
  if (mode === 'live') {
    try {
      bankrConfig = loadBankrConfig();
      logger.info('Bankr API config loaded');
    } catch (err) {
      logger.error(`Failed to load Bankr config: ${err}`);
      throw err;
    }
  }

  // Simulation state for testing
  let simBalance = { base: 100, quote: 1000 };
  let simPrice = 10; // Mock price

  return {
    async getPrice(token: string, quote: string, tokenAddress?: string): Promise<PriceData> {
      if (mode === 'simulation') {
        // Simulate small price movements
        simPrice = simPrice * (1 + (Math.random() - 0.5) * 0.02);
        return {
          price: simPrice,
          timestamp: new Date(),
          source: 'simulation',
        };
      }

      // Live: query Bankr for price
      // Use contract address if provided (more reliable for obscure tokens)
      const tokenRef = tokenAddress || token;
      const prompt = `What is the price of ${tokenRef} on ${chain}?`;
      const response = await executeBankrPrompt(prompt, bankrConfig!);
      
      const price = parsePrice(response);
      if (price === null) {
        logger.warn(`Could not parse price from Bankr response: ${response.slice(0, 200)}`);
        throw new Error('Failed to parse price from Bankr response');
      }
      
      logger.info(`Bankr price: ${token}/${quote} = $${price}`);
      
      return {
        price,
        timestamp: new Date(),
        source: 'bankr',
      };
    },

    async getBalance(token: string, tokenAddress?: string): Promise<number> {
      if (mode === 'simulation') {
        return token === 'USDC' ? simBalance.quote : simBalance.base;
      }

      const tokenRef = tokenAddress || token;
      const prompt = `What is my ${tokenRef} balance on ${chain}?`;
      const response = await executeBankrPrompt(prompt, bankrConfig!);
      
      const balance = parseBalance(response, token);
      if (balance === null) {
        logger.warn(`Could not parse balance from Bankr response: ${response.slice(0, 200)}`);
        return 0;
      }
      
      return balance;
    },

    async buy(token: string, amountUsd: number, tokenAddress?: string): Promise<Trade> {
      const tradeId = `trade_${Date.now()}`;
      
      if (mode === 'simulation') {
        const tokensReceived = amountUsd / simPrice;
        simBalance.base += tokensReceived;
        simBalance.quote -= amountUsd;
        
        logger.info(`[SIMULATION] BUY ${tokensReceived.toFixed(4)} ${token} for $${amountUsd}`);
        
        return {
          id: tradeId,
          side: 'buy',
          baseAmount: tokensReceived,
          quoteAmount: amountUsd,
          price: simPrice,
          timestamp: new Date(),
          status: 'executed',
        };
      }

      // Live: execute buy via Bankr (use contract address if provided)
      const tokenRef = tokenAddress || token;
      const prompt = `Buy $${amountUsd} worth of ${tokenRef} on ${chain}`;
      logger.info(`Executing Bankr buy: ${prompt}`);
      
      const response = await executeBankrPrompt(prompt, bankrConfig!);
      logger.info(`Bankr buy response: ${response.slice(0, 200)}`);
      
      // Parse what we can from the response
      const price = parsePrice(response);
      
      return {
        id: tradeId,
        side: 'buy',
        baseAmount: price ? amountUsd / price : 0,
        quoteAmount: amountUsd,
        price: price || 0,
        timestamp: new Date(),
        status: 'executed',
      };
    },

    async sell(token: string, amountUsd: number, tokenAddress?: string): Promise<Trade> {
      const tradeId = `trade_${Date.now()}`;
      
      if (mode === 'simulation') {
        const tokensSold = amountUsd / simPrice;
        simBalance.base -= tokensSold;
        simBalance.quote += amountUsd;
        
        logger.info(`[SIMULATION] SELL ${tokensSold.toFixed(4)} ${token} for $${amountUsd}`);
        
        return {
          id: tradeId,
          side: 'sell',
          baseAmount: tokensSold,
          quoteAmount: amountUsd,
          price: simPrice,
          timestamp: new Date(),
          status: 'executed',
        };
      }

      // Live: execute sell via Bankr (use contract address if provided)
      const tokenRef = tokenAddress || token;
      const prompt = `Sell $${amountUsd} worth of ${tokenRef} on ${chain}`;
      logger.info(`Executing Bankr sell: ${prompt}`);
      
      const response = await executeBankrPrompt(prompt, bankrConfig!);
      logger.info(`Bankr sell response: ${response.slice(0, 200)}`);
      
      const price = parsePrice(response);
      
      return {
        id: tradeId,
        side: 'sell',
        baseAmount: price ? amountUsd / price : 0,
        quoteAmount: amountUsd,
        price: price || 0,
        timestamp: new Date(),
        status: 'executed',
      };
    },

    async getPosition(baseToken: string, quoteToken: string, baseAddress?: string, quoteAddress?: string): Promise<Position> {
      if (mode === 'simulation') {
        const priceData = await this.getPrice(baseToken, quoteToken);
        return {
          baseAmount: simBalance.base,
          quoteAmount: simBalance.quote,
          baseValueUsd: simBalance.base * priceData.price,
          quoteValueUsd: simBalance.quote,
          totalValueUsd: simBalance.base * priceData.price + simBalance.quote,
          timestamp: new Date(),
        };
      }

      // For live mode, we need to get balances and price
      const [baseBalance, quoteBalance, priceData] = await Promise.all([
        this.getBalance(baseToken, baseAddress),
        this.getBalance(quoteToken, quoteAddress),
        this.getPrice(baseToken, quoteToken, baseAddress),
      ]);
      
      const baseValueUsd = baseBalance * priceData.price;
      const quoteValueUsd = quoteBalance; // Assuming quote is a stablecoin
      
      return {
        baseAmount: baseBalance,
        quoteAmount: quoteBalance,
        baseValueUsd,
        quoteValueUsd,
        totalValueUsd: baseValueUsd + quoteValueUsd,
        timestamp: new Date(),
      };
    },
  };
}
