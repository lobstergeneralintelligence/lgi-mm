/**
 * Configuration schema and validation using Zod
 */

import { z } from 'zod';

const chainSchema = z.enum(['base', 'ethereum', 'polygon', 'solana', 'unichain']);

const modeSchema = z.enum(['liquidity', 'accumulate']);

const tokenPairSchema = z.object({
  base: z.string().min(1, 'Base token is required'),
  baseAddress: z.string().optional(),  // Contract address (more reliable for obscure tokens)
  quote: z.string().default('USDC'),
  quoteAddress: z.string().optional(),
  chain: chainSchema.default('base'),
});

const strategySchema = z.object({
  spreadPercent: z.number().min(0.1).max(50).default(2.0),
  positionSize: z.number().min(1).default(100),
  rebalanceThreshold: z.number().min(1).max(100).default(10),
  // Tick interval: Bankr API is slow (~30-60s per call), so don't tick too often
  // Balance check + trade can take 2-3 minutes total
  tickIntervalSeconds: z.number().min(60).max(3600).default(120),
});

const limitsSchema = z.object({
  maxPositionUsd: z.number().min(10).default(1000),
  minTradeUsd: z.number().min(1).default(10),
  maxTradesPerHour: z.number().min(1).max(1000).default(20),
});

const notificationsSchema = z.object({
  enabled: z.boolean().default(false),
  onTrade: z.boolean().default(true),
  onError: z.boolean().default(true),
  onRebalance: z.boolean().default(true),
});

/**
 * Announcement config - broadcast trades to external channels
 */
const announcementsSchema = z.object({
  enabled: z.boolean().default(false),
  telegram: z.object({
    chatId: z.string().optional(),  // @channel or numeric chat ID
    botTokenPath: z.string().optional(),  // Path to bot token JSON (default: ~/.clawdbot/secrets/telegram-lgi.json)
  }).optional(),
});

/**
 * Accumulate mode - DCA + dip buying
 */
const accumulateSchema = z.object({
  dcaAmount: z.number().min(1).default(10),                    // USD per DCA buy
  dcaIntervalHours: z.number().min(0.01).max(168).default(4),  // ~36s to 1 week (relaxed for testing)
  dipBuyThreshold: z.number().min(1).max(50).default(5),       // % drop to trigger dip buy
  dipBuyMultiplier: z.number().min(1).max(5).default(2),       // Multiply DCA amount on dips
  takeProfitPercent: z.number().min(0).max(100).default(0),    // 0 = disabled
  takeProfitSellPercent: z.number().min(1).max(50).default(10), // % of holdings to sell
  maxAccumulationUsd: z.number().min(1).default(1000),         // Stop accumulating at this (relaxed for testing)
});

/**
 * Liquidity mode - market making for token owners
 */
const liquiditySchema = z.object({
  targetRatio: z.number().min(0.1).max(0.9).default(0.5),      // Target base/total ratio
  rebalanceThreshold: z.number().min(1).max(50).default(10),   // % drift to trigger rebalance
  supportBuyMultiplier: z.number().min(1).max(5).default(1.5), // Extra buy size on dips
  maxDailyVolume: z.number().min(10).default(500),             // Max daily USD volume
});

export const configSchema = z.object({
  mode: modeSchema.default('accumulate'),
  pair: tokenPairSchema,
  strategy: strategySchema,
  limits: limitsSchema,
  notifications: notificationsSchema.default({}),
  announcements: announcementsSchema.default({}),
  accumulate: accumulateSchema.optional(),
  liquidity: liquiditySchema.optional(),
  dryRun: z.boolean().default(false),
}).refine(
  (data) => {
    // Require mode-specific config
    if (data.mode === 'accumulate' && !data.accumulate) {
      return false;
    }
    if (data.mode === 'liquidity' && !data.liquidity) {
      return false;
    }
    return true;
  },
  {
    message: "Mode-specific config required (accumulate or liquidity section)",
  }
);

export type ConfigInput = z.input<typeof configSchema>;
export type ValidatedConfig = z.output<typeof configSchema>;
