/**
 * Configuration schema and validation using Zod
 */

import { z } from 'zod';

const chainSchema = z.enum(['base', 'ethereum', 'polygon', 'solana', 'unichain']);

const tokenPairSchema = z.object({
  base: z.string().min(1, 'Base token is required'),
  quote: z.string().default('USDC'),
  chain: chainSchema.default('base'),
});

const strategySchema = z.object({
  spreadPercent: z.number().min(0.1).max(50).default(2.0),
  positionSize: z.number().min(1).default(100),
  rebalanceThreshold: z.number().min(1).max(100).default(10),
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

export const configSchema = z.object({
  pair: tokenPairSchema,
  strategy: strategySchema,
  limits: limitsSchema,
  notifications: notificationsSchema.default({}),
  dryRun: z.boolean().default(false),
});

export type ConfigInput = z.input<typeof configSchema>;
export type ValidatedConfig = z.output<typeof configSchema>;
