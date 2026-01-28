/**
 * Accumulate Mode Engine
 * 
 * DCA + dip buying strategy for building a position over time.
 * 
 * Logic:
 * 1. Regular DCA buys on schedule (every X hours)
 * 2. Extra buys when price dips from recent high
 * 3. Optional take-profit sells on big pumps
 * 4. Stop accumulating when position reaches max
 */

import { logger } from '../utils/logger.js';
import { getTokenPrice } from '../price/dexscreener.js';
import type { BankrClient } from '../bankr/client.js';
import type { 
  Config, 
  AccumulateConfig, 
  AccumulateState, 
  PriceData
} from '../types/index.js';

export interface AccumulateEngine {
  tick(): Promise<void>;
  getState(): AccumulateState;
  setState(state: Partial<AccumulateState>): void;
}

/**
 * Create accumulate mode engine
 */
export function createAccumulateEngine(
  config: Config,
  bankr: BankrClient
): AccumulateEngine {
  const { pair, limits } = config;
  const acc = config.accumulate as AccumulateConfig;

  // State - should be persisted between restarts
  const state: AccumulateState = {
    lastDcaBuyTime: null,
    recentHigh: 0,
    recentHighTime: null,
    totalAccumulated: 0,
    tokenBalance: 0,
  };

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
   * Execute a buy
   */
  async function executeBuy(amount: number, reason: string, currentPrice: number, quoteBalance: number): Promise<void> {
    if (amount < limits.minTradeUsd) {
      logger.debug(`Buy amount $${amount} below minimum $${limits.minTradeUsd}`);
      return;
    }

    // Check if we've hit max accumulation (use tracked state instead of API call)
    const currentValueUsd = state.tokenBalance * currentPrice;
    if (currentValueUsd >= acc.maxAccumulationUsd) {
      logger.info(`Max accumulation reached ($${currentValueUsd.toFixed(2)} >= $${acc.maxAccumulationUsd})`);
      return;
    }

    // Check if we have enough quote balance
    if (quoteBalance < amount) {
      logger.warn(`Insufficient ${pair.quote} balance: ${quoteBalance.toFixed(4)} < $${amount}`);
      return;
    }

    if (config.dryRun) {
      logger.info(`[DRY RUN] Would BUY $${amount} of ${pair.base} (${reason})`);
      return;
    }

    logger.info(`Executing ${reason}: BUY $${amount} of ${pair.base}`);
    
    const trade = await bankr.buy(pair.base, amount, pair.baseAddress);
    
    // Update state
    state.totalAccumulated += amount;
    if (trade.baseAmount) {
      state.tokenBalance += trade.baseAmount;
    }
    
    if (reason === 'DCA') {
      state.lastDcaBuyTime = new Date();
    }

    logger.info(`${reason} BUY executed`, {
      amount,
      token: pair.base,
      price: trade.price,
      totalAccumulated: state.totalAccumulated,
    });
  }

  /**
   * Execute take-profit sell
   */
  async function executeTakeProfit(currentPrice: number): Promise<void> {
    const baseValueUsd = state.tokenBalance * currentPrice;
    const sellValueUsd = baseValueUsd * (acc.takeProfitSellPercent / 100);
    
    if (sellValueUsd < limits.minTradeUsd) {
      logger.debug(`Take-profit sell $${sellValueUsd.toFixed(2)} below minimum`);
      return;
    }

    if (config.dryRun) {
      logger.info(`[DRY RUN] Would SELL $${sellValueUsd.toFixed(2)} of ${pair.base} (take-profit)`);
      return;
    }

    logger.info(`Executing take-profit: SELL $${sellValueUsd.toFixed(2)} of ${pair.base}`);
    
    const trade = await bankr.sell(pair.base, sellValueUsd, pair.baseAddress);
    
    // Update state - reduce token balance
    if (trade.baseAmount) {
      state.tokenBalance -= trade.baseAmount;
    }

    logger.info(`Take-profit SELL executed`, {
      amount: sellValueUsd,
      token: pair.base,
      price: currentPrice,
      gainPercent: acc.takeProfitPercent,
    });

    // Reset recent high after taking profit (so we can detect next pump)
    state.recentHigh = currentPrice;
    state.recentHighTime = new Date();
  }

  return {
    async tick(): Promise<void> {
      try {
        logger.info('Accumulate tick starting...');
        
        // 1. Get current price from DexScreener (fast, no Bankr API needed)
        logger.debug('Fetching price from DexScreener...');
        let priceData: PriceData;
        if (pair.baseAddress) {
          priceData = await getTokenPrice(pair.baseAddress, pair.chain);
        } else {
          priceData = await bankr.getPrice(pair.base, pair.quote, pair.baseAddress);
        }
        
        const currentPrice = priceData.price;
        logger.info(`Price: $${currentPrice.toFixed(10)} | Recent high: $${state.recentHigh.toFixed(10)}`);

        // 2. Update recent high tracking
        updateRecentHigh(currentPrice);

        // 3. Get quote balance (ETH) for checking if we can buy
        // Only call Bankr for quote balance, not base (avoid flagged token issues)
        logger.info('Fetching quote balance from Bankr...');
        const quoteBalance = await bankr.getBalance(pair.quote, pair.quoteAddress);
        logger.info(`Quote balance received: ${quoteBalance}`);
        
        // Convert quote balance to USD (rough estimate: ETH ~ $3000)
        // TODO: Get actual ETH price from API
        const ethPriceUsd = 3000; 
        const quoteBalanceUsd = quoteBalance * ethPriceUsd;
        
        logger.debug(`Quote balance: ${quoteBalance.toFixed(6)} ${pair.quote} (~$${quoteBalanceUsd.toFixed(2)}) | Token balance (tracked): ${state.tokenBalance.toFixed(2)}`);

        // 4. Check take-profit first (before buying more)
        if (shouldTakeProfit(currentPrice)) {
          await executeTakeProfit(currentPrice);
          return; // Don't buy and sell in same tick
        }

        // 5. Check for dip buy opportunity
        if (isDip(currentPrice)) {
          const dipAmount = acc.dcaAmount * acc.dipBuyMultiplier;
          logger.info(`Dip detected! Price down ${acc.dipBuyThreshold}%+ from recent high`);
          await executeBuy(dipAmount, 'DIP_BUY', currentPrice, quoteBalanceUsd);
          
          // Reset recent high after dip buy so we track from new level
          state.recentHigh = currentPrice;
          state.recentHighTime = new Date();
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
      }
    },

    getState(): AccumulateState {
      return { ...state };
    },

    setState(newState: Partial<AccumulateState>): void {
      Object.assign(state, newState);
    },
  };
}
