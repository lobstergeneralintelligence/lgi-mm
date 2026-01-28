/**
 * Core type definitions for LGI Market Maker
 */

export interface TokenPair {
  base: string;      // Token to market make (e.g., "CLAWDIA", "ETH")
  quote: string;     // Quote token (e.g., "USDC", "ETH")
  chain: Chain;      // Which chain to operate on
}

export type Chain = 'base' | 'ethereum' | 'polygon' | 'solana' | 'unichain';

export interface StrategyConfig {
  spreadPercent: number;       // Target spread (e.g., 2.0 = 2%)
  positionSize: number;        // Size per trade in USD
  rebalanceThreshold: number;  // Rebalance when position drifts this %
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
  pair: TokenPair;
  strategy: StrategyConfig;
  limits: Limits;
  notifications: NotificationConfig;
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

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}
