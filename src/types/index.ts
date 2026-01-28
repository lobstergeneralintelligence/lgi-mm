/**
 * Core type definitions for LGI Market Maker
 */

export interface TokenPair {
  base: string;           // Token symbol (e.g., "CLAWDIA", "ETH")
  baseAddress?: string;   // Contract address (more reliable for obscure tokens)
  quote: string;          // Quote token (e.g., "USDC", "ETH")
  quoteAddress?: string;  // Quote contract address
  chain: Chain;           // Which chain to operate on
}

export type Chain = 'base' | 'ethereum' | 'polygon' | 'solana' | 'unichain';

export type OperatingMode = 'liquidity' | 'accumulate';

export interface StrategyConfig {
  spreadPercent: number;       // Target spread (e.g., 2.0 = 2%)
  positionSize: number;        // Size per trade in USD
  rebalanceThreshold: number;  // Rebalance when position drifts this %
  tickIntervalSeconds: number; // How often to check prices (5-300 seconds)
}

/**
 * Accumulate mode config - DCA + dip buying
 */
export interface AccumulateConfig {
  dcaAmount: number;              // Buy this much USD worth each interval
  dcaIntervalHours: number;       // Hours between DCA buys
  dipBuyThreshold: number;        // Buy extra if price drops this % from recent high
  dipBuyMultiplier: number;       // Multiply dcaAmount by this on dips
  takeProfitPercent: number;      // Sell some if price up this % (0 = disabled)
  takeProfitSellPercent: number;  // Sell this % of holdings on take-profit
  maxAccumulationUsd: number;     // Stop accumulating when position reaches this USD value
}

/**
 * Liquidity mode config - market making for token owners
 */
export interface LiquidityConfig {
  targetRatio: number;            // Target base/total ratio (0.5 = 50/50)
  rebalanceThreshold: number;     // Rebalance when this % off target
  supportBuyMultiplier: number;   // Buy this much extra on dips
  maxDailyVolume: number;         // Max USD volume per day
}

export interface Limits {
  maxPositionUsd: number;      // Maximum position size in USD
  minTradeUsd: number;         // Minimum trade size
  maxTradesPerHour: number;    // Rate limit
}

export interface NotificationConfig {
  enabled: boolean;
  onTrade: boolean;
  onError: boolean;
  onRebalance: boolean;
}

export interface Config {
  mode: OperatingMode;         // 'liquidity' or 'accumulate'
  pair: TokenPair;
  strategy: StrategyConfig;
  limits: Limits;
  notifications: NotificationConfig;
  accumulate?: AccumulateConfig;  // Required if mode = 'accumulate'
  liquidity?: LiquidityConfig;    // Required if mode = 'liquidity'
  dryRun?: boolean;            // If true, log decisions but don't execute
}

export interface Position {
  baseAmount: number;          // Amount of base token held
  quoteAmount: number;         // Amount of quote token held
  baseValueUsd: number;        // USD value of base position
  quoteValueUsd: number;       // USD value of quote position
  totalValueUsd: number;       // Total position value
  timestamp: Date;
}

export interface PriceData {
  price: number;               // Current price of base in quote terms
  timestamp: Date;
  source: string;              // Where the price came from
}

export interface Trade {
  id: string;
  side: 'buy' | 'sell';
  baseAmount: number;
  quoteAmount: number;
  price: number;
  timestamp: Date;
  txHash?: string;
  status: 'pending' | 'executed' | 'failed';
}

export interface MarketMakerState {
  isRunning: boolean;
  position: Position | null;
  lastPrice: PriceData | null;
  lastTrade: Trade | null;
  tradesThisHour: number;
  startedAt: Date | null;
  errors: string[];
}

/**
 * Accumulate mode state - persisted between ticks
 */
export interface AccumulateState {
  lastDcaBuyTime: Date | null;    // When we last did a DCA buy
  recentHigh: number;             // Recent high price (for dip detection)
  recentHighTime: Date | null;    // When we saw the recent high
  totalAccumulated: number;       // Total USD spent accumulating
  tokenBalance: number;           // Tokens accumulated
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}
