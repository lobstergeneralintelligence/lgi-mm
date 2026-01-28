-- CreateEnum
CREATE TYPE "JobMode" AS ENUM ('ACCUMULATE', 'LIQUIDITY');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('IDLE', 'RUNNING', 'PAUSED', 'LIQUIDATING', 'ERROR');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "TradeReason" AS ENUM ('DCA', 'DIP_BUY', 'TAKE_PROFIT', 'REBALANCE', 'SPREAD_BUY', 'SPREAD_SELL', 'LIQUIDATE', 'MANUAL');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'SUBMITTED', 'EXECUTED', 'FAILED');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "chain" TEXT NOT NULL DEFAULT 'base',
    "quoteToken" TEXT NOT NULL DEFAULT 'ETH',
    "mode" "JobMode" NOT NULL DEFAULT 'ACCUMULATE',
    "status" "JobStatus" NOT NULL DEFAULT 'IDLE',
    "lastDcaBuyTime" TIMESTAMP(3),
    "recentHigh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recentHighTime" TIMESTAMP(3),
    "totalAccumulated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tokenBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgBuyPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastRebalanceTime" TIMESTAMP(3),
    "dailyVolumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyVolumeResetAt" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "lastError" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "reason" "TradeReason" NOT NULL,
    "baseAmount" DOUBLE PRECISION NOT NULL,
    "quoteAmount" DOUBLE PRECISION NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "txHash" TEXT,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "gasUsed" DOUBLE PRECISION,
    "gasPriceGwei" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_tokenAddress_key" ON "Job"("tokenAddress");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_chain_status_idx" ON "Job"("chain", "status");

-- CreateIndex
CREATE INDEX "Trade_jobId_createdAt_idx" ON "Trade"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_status_idx" ON "Trade"("status");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
