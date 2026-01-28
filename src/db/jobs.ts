/**
 * Job Database Operations
 * 
 * CRUD and state management for jobs.
 */

import { getDb } from './client.js';
import { logger } from '../utils/logger.js';
import type { Job, Trade, JobStatus, JobMode, TradeSide, TradeReason, TradeStatus, Prisma } from '@prisma/client';

// Re-export types
export type { Job, Trade, JobStatus, JobMode, TradeSide, TradeReason, TradeStatus };

// ============================================================
// Job Operations
// ============================================================

/**
 * Get a job by token address
 */
export async function getJob(tokenAddress: string): Promise<Job | null> {
  const db = getDb();
  return db.job.findUnique({
    where: { tokenAddress: tokenAddress.toLowerCase() },
  });
}

/**
 * Get a job by ID
 */
export async function getJobById(id: string): Promise<Job | null> {
  const db = getDb();
  return db.job.findUnique({
    where: { id },
  });
}

/**
 * List all jobs, optionally filtered by status
 */
export async function listJobs(status?: JobStatus): Promise<Job[]> {
  const db = getDb();
  return db.job.findMany({
    where: status ? { status } : undefined,
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Create a new job
 */
export async function createJob(data: {
  tokenAddress: string;
  tokenSymbol: string;
  chain?: string;
  quoteToken?: string;
  mode: JobMode;
  config: Prisma.InputJsonValue;
}): Promise<Job> {
  const db = getDb();
  
  const job = await db.job.create({
    data: {
      tokenAddress: data.tokenAddress.toLowerCase(),
      tokenSymbol: data.tokenSymbol,
      chain: data.chain ?? 'base',
      quoteToken: data.quoteToken ?? 'ETH',
      mode: data.mode,
      config: data.config,
      status: 'IDLE',
    },
  });

  logger.info(`Job created: ${job.tokenSymbol}`, { jobId: job.id });
  return job;
}

/**
 * Update job status
 */
export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  extra?: Partial<Prisma.JobUpdateInput>
): Promise<Job> {
  const db = getDb();
  
  const updateData: Prisma.JobUpdateInput = {
    status,
    ...extra,
  };

  // Set timestamps based on status
  if (status === 'RUNNING') {
    updateData.startedAt = new Date();
    updateData.pausedAt = null;
    updateData.lastError = null;
  } else if (status === 'PAUSED') {
    updateData.pausedAt = new Date();
  } else if (status === 'IDLE') {
    updateData.startedAt = null;
    updateData.pausedAt = null;
  }

  const job = await db.job.update({
    where: { id: jobId },
    data: updateData,
  });

  logger.info(`Job ${job.tokenSymbol} status: ${status}`, { jobId });
  return job;
}

/**
 * Update accumulate mode state after a tick
 */
export async function updateAccumulateState(
  jobId: string,
  state: {
    lastDcaBuyTime?: Date;
    recentHigh?: number;
    recentHighTime?: Date;
    tokenBalance?: number;
    totalAccumulated?: number;
    avgBuyPrice?: number;
  }
): Promise<Job> {
  const db = getDb();
  
  return db.job.update({
    where: { id: jobId },
    data: state,
  });
}

/**
 * Record an error on a job
 */
export async function recordJobError(jobId: string, error: string): Promise<Job> {
  const db = getDb();
  
  return db.job.update({
    where: { id: jobId },
    data: {
      lastError: error,
      errorCount: { increment: 1 },
      status: 'ERROR',
    },
  });
}

/**
 * Reset job to idle state (after liquidation)
 */
export async function resetJob(jobId: string): Promise<Job> {
  const db = getDb();
  
  return db.job.update({
    where: { id: jobId },
    data: {
      status: 'IDLE',
      lastDcaBuyTime: null,
      recentHigh: 0,
      recentHighTime: null,
      totalAccumulated: 0,
      tokenBalance: 0,
      avgBuyPrice: 0,
      lastRebalanceTime: null,
      dailyVolumeUsd: 0,
      startedAt: null,
      pausedAt: null,
      lastError: null,
      errorCount: 0,
    },
  });
}

/**
 * Delete a job and all its trades
 */
export async function deleteJob(jobId: string): Promise<void> {
  const db = getDb();
  await db.job.delete({ where: { id: jobId } });
  logger.info(`Job deleted`, { jobId });
}

// ============================================================
// Trade Operations
// ============================================================

/**
 * Record a new trade
 */
export async function createTrade(data: {
  jobId: string;
  side: TradeSide;
  reason: TradeReason;
  baseAmount: number;
  quoteAmount: number;
  priceUsd: number;
  txHash?: string;
  status?: TradeStatus;
}): Promise<Trade> {
  const db = getDb();
  
  return db.trade.create({
    data: {
      jobId: data.jobId,
      side: data.side,
      reason: data.reason,
      baseAmount: data.baseAmount,
      quoteAmount: data.quoteAmount,
      priceUsd: data.priceUsd,
      txHash: data.txHash,
      status: data.status ?? 'PENDING',
      executedAt: data.txHash ? new Date() : null,
    },
  });
}

/**
 * Update trade status after execution
 */
export async function updateTradeStatus(
  tradeId: string,
  status: TradeStatus,
  txHash?: string,
  error?: string
): Promise<Trade> {
  const db = getDb();
  
  return db.trade.update({
    where: { id: tradeId },
    data: {
      status,
      txHash,
      error,
      executedAt: status === 'EXECUTED' ? new Date() : undefined,
    },
  });
}

/**
 * Get trade history for a job
 */
export async function getTradeHistory(
  jobId: string,
  limit: number = 50
): Promise<Trade[]> {
  const db = getDb();
  
  return db.trade.findMany({
    where: { jobId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Record a completed trade and update job state in a transaction
 */
export async function recordTradeWithStateUpdate(
  jobId: string,
  trade: {
    side: TradeSide;
    reason: TradeReason;
    baseAmount: number;
    quoteAmount: number;
    priceUsd: number;
    txHash?: string;
  },
  stateUpdate: Partial<Prisma.JobUpdateInput>
): Promise<{ trade: Trade; job: Job }> {
  const db = getDb();
  
  const [newTrade, updatedJob] = await db.$transaction([
    db.trade.create({
      data: {
        jobId,
        side: trade.side,
        reason: trade.reason,
        baseAmount: trade.baseAmount,
        quoteAmount: trade.quoteAmount,
        priceUsd: trade.priceUsd,
        txHash: trade.txHash,
        status: trade.txHash ? 'EXECUTED' : 'PENDING',
        executedAt: trade.txHash ? new Date() : null,
      },
    }),
    db.job.update({
      where: { id: jobId },
      data: stateUpdate,
    }),
  ]);

  logger.info(`Trade recorded: ${trade.side} ${trade.baseAmount} @ $${trade.priceUsd}`, {
    jobId,
    tradeId: newTrade.id,
    reason: trade.reason,
  });

  return { trade: newTrade, job: updatedJob };
}
