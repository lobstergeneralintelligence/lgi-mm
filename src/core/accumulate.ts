/**
 * Accumulate Mode Engine
 * 
 * DCA + dip buying strategy for building a position over time.
 * Now with database persistence for crash recovery.
 * 
 * Logic:
 * 1. Regular DCA buys on schedule (every X hours)
 * 2. Extra buys when price dips from recent high
 * 3. Optional take-profit sells on big pumps
 * 4. Stop accumulating when position reaches max
 */

import { logger } from '../utils/logger.js';
import { getTokenPrice } from '../price/dexscreener.js';
import { 
  updateAccumulateState, 
  recordTradeWithStateUpdate,
  type Job 
} from '../db/index.js';
import type { BankrClient } from '../bankr/client.js';
import type { 
  Config, 
  AccumulateConfig, 
  AccumulateState, 
  PriceData
} from '../types/index.js';

/**
 * Format price to show full decimal (no scientific notation)
 */
function formatPrice(price: number): string {
  if (price === 0) return '0';
  if (price >= 0.01) return price.toFixed(6);
  // For very small numbers, show up to 12 decimal places
  return price.toFixed(12).replace(/\.?0+$/, '');
}

export interface AccumulateEngine {
  tick(): Promise<void>;
  getState(): AccumulateState;
  getJobId(): string;
  isLocked(): boolean;
}

/**
 * Create accumulate mode engine with DB persistence
 */
export function createAccumulateEngine(
  config: Config,
  bankr: BankrClient,
  job: Job
): AccumulateEngine {
  const { pair, limits } = config;
  const acc = config.accumulate as AccumulateConfig;
  const jobId = job.id;

  // Load state from job (persisted in DB)
  const state: AccumulateState = {
    lastDcaBuyTime: job.lastDcaBuyTime,
    recentHigh: job.recentHigh,
    recentHighTime: job.recentHighTime,
    totalAccumulated: job.totalAccumulated,
    tokenBalance: job.tokenBalance,
  };

  // Trade lock to prevent concurrent tick execution
  // (Bankr API is slow, ticks can overlap without this)
  let tickLock = false;

  logger.info('Accumulate engine initialized from DB state', {
    jobId,
    tokenBalance: state.tokenBalance,
    totalAccumulated: state.totalAccumulated,
    lastDcaBuyTime: state.lastDcaBuyTime,
  });

  /**
   * Save state to database
   */
  async function saveState(): Promise<void> {
    await updateAccumulateState(jobId, {
      lastDcaBuyTime: state.lastDcaBuyTime ?? undefined,
      recentHigh: state.recentHigh,
      recentHighTime: state.recentHighTime ?? undefined,
      tokenBalance: state.tokenBalance,
      totalAccumulated: state.totalAccumulated,
    });
  }

  /**
   * Check if it's time for a DCA buy
   */
  function isDcaTime(): boolean {
    if (!state.lastDcaBuyTime) return true; // First buy
    
    const hoursSinceLast = (Date.now() - state.lastDcaBuyTime.getTime()) / (1000 * 60 * 60);
    return hoursSinceLast >= acc.dcaIntervalHours;
  }

  /**
   * Check if price has dipped enough to trigger extra buy
   */
  function isDip(currentPrice: number): boolean {
    if (state.recentHigh === 0) return false;
    
    const dropPercent = ((state.recentHigh - currentPrice) / state.recentHigh) * 100;
    return dropPercent >= acc.dipBuyThreshold;
  }

  /**
   * Check if price has pumped enough to take profit
   */
  function shouldTakeProfit(currentPrice: number): boolean {
    if (acc.takeProfitPercent === 0) return false;
    if (state.tokenBalance === 0) return false;
    
    const baseValueUsd = state.tokenBalance * currentPrice;
    if (baseValueUsd < limits.minTradeUsd) return false;
    
    // Calculate average buy price from total accumulated / token balance
    const avgPrice = state.totalAccumulated / state.tokenBalance;
    if (avgPrice === 0) return false;
    
    const gainPercent = ((currentPrice - avgPrice) / avgPrice) * 100;
    
    return gainPercent >= acc.takeProfitPercent;
  }

  /**
   * Update recent high tracking
   */
  function updateRecentHigh(currentPrice: number): void {
    // Reset recent high if it's been more than 24 hours
    const hoursSinceHigh = state.recentHighTime 
      ? (Date.now() - state.recentHighTime.getTime()) / (1000 * 60 * 60)
      : Infinity;
    
    if (currentPrice > state.recentHigh || hoursSinceHigh > 24) {
      state.recentHigh = currentPrice;
      state.recentHighTime = new Date();
    }
  }

  /**
   * Execute a buy and record to DB
   */
  async function executeBuy(
    amount: number, 
    reason: 'DCA' | 'DIP_BUY', 
    currentPrice: number, 
    quoteBalanceUsd: number
  ): Promise<boolean> {
    if (amount < limits.minTradeUsd) {
      logger.debug(`Buy amount $${amount} below minimum $${limits.minTradeUsd}`);
      return false;
    }

    // Check if we've hit max accumulation
    const currentValueUsd = state.tokenBalance * currentPrice;
    if (currentValueUsd >= acc.maxAccumulationUsd) {
      logger.info(`Max accumulation reached ($${currentValueUsd.toFixed(2)} >= $${acc.maxAccumulationUsd})`);
      return false;
    }

    // Check if we have enough quote balance
    if (quoteBalanceUsd < amount) {
      logger.warn(`Insufficient ${pair.quote} balance: $${quoteBalanceUsd.toFixed(2)} < $${amount}`);
      return false;
    }

    if (config.dryRun) {
      logger.info(`[DRY RUN] Would BUY $${amount} of ${pair.base} (${reason})`);
      // Still update state for dry run testing
      if (reason === 'DCA') {
        state.lastDcaBuyTime = new Date();
        await saveState();
      }
      return true;
    }

    logger.info(`Executing ${reason}: BUY $${amount} of ${pair.base}`);
    
    const trade = await bankr.buy(pair.base, amount, pair.baseAddress);
    
    // Update local state
    state.totalAccumulated += amount;
    if (trade.baseAmount) {
      state.tokenBalance += trade.baseAmount;
    }
    if (reason === 'DCA') {
      state.lastDcaBuyTime = new Date();
    }

    // Calculate new average buy price
    const avgBuyPrice = state.tokenBalance > 0 
      ? state.totalAccumulated / state.tokenBalance 
      : 0;

    // Record trade and update state atomically in DB
    await recordTradeWithStateUpdate(jobId, {
      side: 'BUY',
      reason: reason,
      baseAmount: trade.baseAmount || 0,
      quoteAmount: amount,
      priceUsd: currentPrice,
      txHash: trade.txHash,
    }, {
      tokenBalance: state.tokenBalance,
      totalAccumulated: state.totalAccumulated,
      avgBuyPrice,
      lastDcaBuyTime: reason === 'DCA' ? new Date() : undefined,
      recentHigh: state.recentHigh,
      recentHighTime: state.recentHighTime,
    });

    logger.info(`${reason} BUY executed and saved to DB`, {
      amount,
      token: pair.base,
      price: trade.price,
      totalAccumulated: state.totalAccumulated,
      tokenBalance: state.tokenBalance,
    });

    return true;
  }

  /**
   * Execute take-profit sell and record to DB
   */
  async function executeTakeProfit(currentPrice: number): Promise<boolean> {
    const baseValueUsd = state.tokenBalance * currentPrice;
    const sellValueUsd = baseValueUsd * (acc.takeProfitSellPercent / 100);
    
    if (sellValueUsd < limits.minTradeUsd) {
      logger.debug(`Take-profit sell $${sellValueUsd.toFixed(2)} below minimum`);
      return false;
    }

    if (config.dryRun) {
      logger.info(`[DRY RUN] Would SELL $${sellValueUsd.toFixed(2)} of ${pair.base} (take-profit)`);
      return true;
    }

    logger.info(`Executing take-profit: SELL $${sellValueUsd.toFixed(2)} of ${pair.base}`);
    
    const trade = await bankr.sell(pair.base, sellValueUsd, pair.baseAddress);
    
    // Update local state
    if (trade.baseAmount) {
      state.tokenBalance -= trade.baseAmount;
    }
    state.recentHigh = currentPrice;
    state.recentHighTime = new Date();

    // Record trade and update state atomically in DB
    await recordTradeWithStateUpdate(jobId, {
      side: 'SELL',
      reason: 'TAKE_PROFIT',
      baseAmount: trade.baseAmount || 0,
      quoteAmount: sellValueUsd,
      priceUsd: currentPrice,
      txHash: trade.txHash,
    }, {
      tokenBalance: state.tokenBalance,
      recentHigh: currentPrice,
      recentHighTime: new Date(),
    });

    logger.info(`Take-profit SELL executed and saved to DB`, {
      amount: sellValueUsd,
      token: pair.base,
      price: currentPrice,
      tokenBalance: state.tokenBalance,
    });

    return true;
  }

  return {
    async tick(): Promise<void> {
      // Prevent concurrent tick execution
      if (tickLock) {
        logger.debug('Tick skipped - previous tick still running');
        return;
      }
      
      tickLock = true;
      try {
        logger.info('Accumulate tick starting...');
        
        // 1. Get current price from DexScreener (fast, no Bankr API needed)
        let priceData: PriceData;
        if (pair.baseAddress) {
          priceData = await getTokenPrice(pair.baseAddress, pair.chain);
        } else {
          priceData = await bankr.getPrice(pair.base, pair.quote, pair.baseAddress);
        }
        
        const currentPrice = priceData.price;
        logger.info(`Price: $${formatPrice(currentPrice)} | Recent high: $${formatPrice(state.recentHigh)}`);

        // 2. Update recent high tracking
        const prevHigh = state.recentHigh;
        updateRecentHigh(currentPrice);
        
        // Save if recent high changed
        if (state.recentHigh !== prevHigh) {
          await saveState();
        }

        // 3. Get quote balance (ETH) for checking if we can buy
        logger.info('Fetching quote balance from Bankr...');
        const quoteBalance = await bankr.getBalance(pair.quote, pair.quoteAddress);
        logger.info(`Quote balance received: ${quoteBalance}`);
        
        // Convert quote balance to USD (rough estimate: ETH ~ $3000)
        // TODO: Get actual ETH price from API
        const ethPriceUsd = 3000; 
        const quoteBalanceUsd = quoteBalance * ethPriceUsd;
        
        logger.debug(`Quote balance: ${quoteBalance.toFixed(6)} ${pair.quote} (~$${quoteBalanceUsd.toFixed(2)}) | Token balance: ${state.tokenBalance.toFixed(2)}`);

        // 4. Check take-profit first (before buying more)
        if (shouldTakeProfit(currentPrice)) {
          await executeTakeProfit(currentPrice);
          return; // Don't buy and sell in same tick
        }

        // 5. Check for dip buy opportunity
        if (isDip(currentPrice)) {
          const dipAmount = acc.dcaAmount * acc.dipBuyMultiplier;
          logger.info(`Dip detected! Price down ${acc.dipBuyThreshold}%+ from recent high`);
          
          if (await executeBuy(dipAmount, 'DIP_BUY', currentPrice, quoteBalanceUsd)) {
            // Reset recent high after dip buy
            state.recentHigh = currentPrice;
            state.recentHighTime = new Date();
            await saveState();
          }
          return;
        }

        // 6. Check for regular DCA
        if (isDcaTime()) {
          await executeBuy(acc.dcaAmount, 'DCA', currentPrice, quoteBalanceUsd);
        }

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Accumulate tick error: ${errorMsg}`);
        throw err;
      } finally {
        tickLock = false;
      }
    },

    getState(): AccumulateState {
      return { ...state };
    },

    getJobId(): string {
      return jobId;
    },

    isLocked(): boolean {
      return tickLock;
    },
  };
}
