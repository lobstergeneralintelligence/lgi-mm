/**
 * Market Maker Engine
 * 
 * The core decision-making loop:
 * 1. Get current price
 * 2. Calculate where our bids/asks should be
 * 3. Check if we should trade
 * 4. Execute if conditions met
 * 5. Track position, rebalance if needed
 */

import { logger } from '../utils/logger.js';
import type { BankrClient } from '../bankr/client.js';
import type { Config, MarketMakerState, PriceData, Trade, Position } from '../types/index.js';

export interface MarketMakerEngine {
  start(): Promise<void>;
  stop(): void;
  getState(): MarketMakerState;
}

interface PriceLevel {
  bid: number;  // Price we're willing to buy at
  ask: number;  // Price we're willing to sell at
  mid: number;  // Midpoint (current market price)
}

/**
 * Calculate bid/ask prices based on spread
 */
function calculatePriceLevels(currentPrice: number, spreadPercent: number): PriceLevel {
  const halfSpread = spreadPercent / 100 / 2;
  return {
    mid: currentPrice,
    bid: currentPrice * (1 - halfSpread),
    ask: currentPrice * (1 + halfSpread),
  };
}

/**
 * Determine if position needs rebalancing
 */
function needsRebalance(position: Position, targetRatio: number, threshold: number): 'buy' | 'sell' | null {
  const totalValue = position.totalValueUsd;
  if (totalValue === 0) return null;

  const currentRatio = position.baseValueUsd / totalValue;
  const drift = Math.abs(currentRatio - targetRatio) * 100;

  if (drift > threshold) {
    return currentRatio < targetRatio ? 'buy' : 'sell';
  }

  return null;
}

/**
 * Create a market maker engine
 */
export function createEngine(config: Config, bankr: BankrClient): MarketMakerEngine {
  const { pair, strategy, limits } = config;
  
  let isRunning = false;
  let loopInterval: ReturnType<typeof setInterval> | null = null;
  let tradesThisHour = 0;
  let hourResetInterval: ReturnType<typeof setInterval> | null = null;
  
  const state: MarketMakerState = {
    isRunning: false,
    position: null,
    lastPrice: null,
    lastTrade: null,
    tradesThisHour: 0,
    startedAt: null,
    errors: [],
  };

  // Track recent prices for trend detection (optional enhancement)
  const priceHistory: number[] = [];
  const MAX_PRICE_HISTORY = 10;

  /**
   * Main decision loop - runs on each tick
   */
  async function tick(): Promise<void> {
    try {
      // 1. Get current price
      const priceData = await bankr.getPrice(pair.base, pair.quote);
      state.lastPrice = priceData;
      
      // Track price history
      priceHistory.push(priceData.price);
      if (priceHistory.length > MAX_PRICE_HISTORY) {
        priceHistory.shift();
      }

      // 2. Calculate our price levels
      const levels = calculatePriceLevels(priceData.price, strategy.spreadPercent);
      
      logger.debug(`Price: ${priceData.price.toFixed(6)} | Bid: ${levels.bid.toFixed(6)} | Ask: ${levels.ask.toFixed(6)}`);

      // 3. Get current position
      const position = await bankr.getPosition(pair.base, pair.quote);
      state.position = position;

      // 4. Check rate limits
      if (tradesThisHour >= limits.maxTradesPerHour) {
        logger.warn(`Rate limit reached (${limits.maxTradesPerHour}/hour). Waiting...`);
        return;
      }

      // 5. Check if we need to rebalance
      const targetRatio = 0.5; // 50/50 split between base and quote
      const rebalanceAction = needsRebalance(position, targetRatio, strategy.rebalanceThreshold);

      if (rebalanceAction) {
        logger.info(`Rebalance triggered: need to ${rebalanceAction}`);
        await executeRebalance(rebalanceAction, position, levels);
        return;
      }

      // 6. Market making logic - simple version
      // In a real MM, we'd place limit orders. With Bankr, we execute market orders
      // when price moves enough to capture spread.
      await checkSpreadOpportunity(position, priceData, levels);

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Tick error: ${errorMsg}`);
      state.errors.push(errorMsg);
      
      // Keep only last 10 errors
      if (state.errors.length > 10) {
        state.errors.shift();
      }
    }
  }

  /**
   * Execute a rebalancing trade
   */
  async function executeRebalance(
    action: 'buy' | 'sell',
    _position: Position,
    levels: PriceLevel
  ): Promise<void> {
    const tradeSize = Math.min(strategy.positionSize, limits.maxPositionUsd * 0.1);
    
    if (tradeSize < limits.minTradeUsd) {
      logger.warn(`Trade size $${tradeSize} below minimum $${limits.minTradeUsd}`);
      return;
    }

    if (config.dryRun) {
      logger.info(`[DRY RUN] Would ${action} $${tradeSize} of ${pair.base}`);
      return;
    }

    let trade: Trade;
    if (action === 'buy') {
      trade = await bankr.buy(pair.base, tradeSize);
    } else {
      trade = await bankr.sell(pair.base, tradeSize);
    }

    state.lastTrade = trade;
    tradesThisHour++;
    state.tradesThisHour = tradesThisHour;

    logger.info(`Rebalance ${action.toUpperCase()} executed`, {
      amount: tradeSize,
      token: pair.base,
      price: levels.mid,
    });
  }

  /**
   * Check if there's a spread capture opportunity
   * This is simplified - real MM would use limit orders
   */
  async function checkSpreadOpportunity(
    position: Position,
    _priceData: PriceData,
    levels: PriceLevel
  ): Promise<void> {
    // Simple logic: if we have room in position limits, make small trades
    // to maintain inventory and capture spread over time
    
    const canBuy = position.quoteAmount >= strategy.positionSize &&
                   position.baseValueUsd < limits.maxPositionUsd;
    const canSell = position.baseValueUsd >= strategy.positionSize &&
                    position.baseValueUsd > limits.minTradeUsd;

    // Random walk market making - occasionally trade to maintain presence
    // In production, this would be more sophisticated
    const shouldTrade = Math.random() < 0.1; // 10% chance each tick
    
    if (!shouldTrade) return;

    const action = Math.random() < 0.5 ? 'buy' : 'sell';
    
    if (action === 'buy' && canBuy) {
      if (config.dryRun) {
        logger.info(`[DRY RUN] Would BUY $${strategy.positionSize} of ${pair.base} at ~${levels.bid.toFixed(6)}`);
        return;
      }
      const trade = await bankr.buy(pair.base, strategy.positionSize);
      state.lastTrade = trade;
      tradesThisHour++;
    } else if (action === 'sell' && canSell) {
      if (config.dryRun) {
        logger.info(`[DRY RUN] Would SELL $${strategy.positionSize} of ${pair.base} at ~${levels.ask.toFixed(6)}`);
        return;
      }
      const trade = await bankr.sell(pair.base, strategy.positionSize);
      state.lastTrade = trade;
      tradesThisHour++;
    }

    state.tradesThisHour = tradesThisHour;
  }

  return {
    async start(): Promise<void> {
      if (isRunning) {
        logger.warn('Engine already running');
        return;
      }

      logger.info('🦞 Starting market maker', {
        pair: `${pair.base}/${pair.quote}`,
        chain: pair.chain,
        spread: `${strategy.spreadPercent}%`,
        dryRun: config.dryRun,
      });

      isRunning = true;
      state.isRunning = true;
      state.startedAt = new Date();
      state.errors = [];

      // Run initial tick
      await tick();

      // Set up main loop (every 30 seconds)
      const TICK_INTERVAL_MS = 30_000;
      loopInterval = setInterval(() => {
        tick().catch((err) => {
          logger.error(`Tick failed: ${err}`);
        });
      }, TICK_INTERVAL_MS);

      // Reset hourly trade counter
      hourResetInterval = setInterval(() => {
        tradesThisHour = 0;
        state.tradesThisHour = 0;
        logger.debug('Hourly trade counter reset');
      }, 60 * 60 * 1000);

      logger.info('Engine started. Running every 30 seconds.');
    },

    stop(): void {
      if (!isRunning) {
        logger.warn('Engine not running');
        return;
      }

      logger.info('Stopping market maker...');

      if (loopInterval) {
        clearInterval(loopInterval);
        loopInterval = null;
      }

      if (hourResetInterval) {
        clearInterval(hourResetInterval);
        hourResetInterval = null;
      }

      isRunning = false;
      state.isRunning = false;

      logger.info('🦞 Market maker stopped');
    },

    getState(): MarketMakerState {
      return { ...state };
    },
  };
}
