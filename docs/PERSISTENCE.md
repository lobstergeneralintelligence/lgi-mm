# State Persistence Design

## Overview

PostgreSQL + Prisma for crash-resistant state management. Each token position is a "job" that can be paused, resumed, or liquidated.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    LGI-MM Process                       │
│  ┌─────────────┐    ┌─────────────┐    ┌────────────┐  │
│  │   Engine    │───▶│   Prisma    │───▶│  Postgres  │  │
│  │  (per job)  │    │   Client    │    │ (Docker)   │  │
│  └─────────────┘    └─────────────┘    └────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Database Schema

```prisma
model Job {
  id              String    @id @default(uuid())
  
  // Token identification
  tokenAddress    String    @unique
  tokenSymbol     String
  chain           String    @default("base")
  
  // Operating mode
  mode            JobMode   @default(ACCUMULATE)
  status          JobStatus @default(IDLE)
  
  // Accumulate mode state
  lastDcaBuyTime  DateTime?
  recentHigh      Float     @default(0)
  recentHighTime  DateTime?
  totalAccumulated Float    @default(0)  // USD spent
  tokenBalance    Float     @default(0)  // Tokens held (tracked)
  
  // Liquidity mode state
  lastRebalanceTime DateTime?
  
  // Configuration (JSON for flexibility)
  config          Json
  
  // Timestamps
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  startedAt       DateTime?
  stoppedAt       DateTime?
  
  // Relations
  trades          Trade[]
}

model Trade {
  id              String    @id @default(uuid())
  jobId           String
  job             Job       @relation(fields: [jobId], references: [id])
  
  // Trade details
  side            TradeSide
  reason          String    // DCA, DIP_BUY, REBALANCE, TAKE_PROFIT, LIQUIDATE
  
  // Amounts
  baseAmount      Float     // Token amount
  quoteAmount     Float     // ETH/USDC amount
  priceUsd        Float
  
  // Execution
  txHash          String?
  status          TradeStatus @default(PENDING)
  error           String?
  
  // Timestamps
  createdAt       DateTime  @default(now())
  executedAt      DateTime?
}

enum JobMode {
  ACCUMULATE
  LIQUIDITY
}

enum JobStatus {
  IDLE          // No position, not running
  RUNNING       // Actively trading
  PAUSED        // Stopped but keeping position
  LIQUIDATING   // Selling all to return to idle
  ERROR         // Stopped due to error
}

enum TradeSide {
  BUY
  SELL
}

enum TradeStatus {
  PENDING
  EXECUTED
  FAILED
}
```

---

## Job Lifecycle

```
                    ┌─────────┐
                    │  IDLE   │◀──────────────────┐
                    └────┬────┘                   │
                         │ start                  │ liquidate complete
                         ▼                        │
                    ┌─────────┐                   │
         ┌─────────▶│ RUNNING │───────────────────┤
         │          └────┬────┘                   │
         │               │                        │
    resume│         pause│      liquidate         │
         │               ▼           │            │
         │          ┌─────────┐      │            │
         └──────────│ PAUSED  │──────┘            │
                    └────┬────┘                   │
                         │ liquidate              │
                         ▼                        │
                    ┌─────────────┐               │
                    │ LIQUIDATING │───────────────┘
                    └─────────────┘
```

---

## CLI Commands

```bash
# Start/resume accumulating a token
lgi-mm start 0xbbd9aDe16525acb4B336b6dAd3b9762901522B07 --mode accumulate

# Pause (stop trading but keep position)
lgi-mm pause 0xbbd9aDe16525acb4B336b6dAd3b9762901522B07

# Resume a paused job
lgi-mm resume 0xbbd9aDe16525acb4B336b6dAd3b9762901522B07

# Liquidate (sell all, return to idle)
lgi-mm liquidate 0xbbd9aDe16525acb4B336b6dAd3b9762901522B07

# Check status
lgi-mm status 0xbbd9aDe16525acb4B336b6dAd3b9762901522B07

# List all jobs
lgi-mm list

# Run daemon (processes all RUNNING jobs)
lgi-mm daemon
```

---

## Docker Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: lgi-mm-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: lgi
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-lgi_dev_password}
      POSTGRES_DB: lgi_mm
    volumes:
      - lgi_mm_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lgi -d lgi_mm"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  lgi_mm_data:
```

---

## State Recovery on Startup

When the daemon starts:

```typescript
async function recoverJobs(): Promise<void> {
  // Find all jobs that were RUNNING when we crashed
  const runningJobs = await prisma.job.findMany({
    where: { status: 'RUNNING' }
  });

  for (const job of runningJobs) {
    logger.info(`Recovering job for ${job.tokenSymbol}`, {
      lastDcaBuy: job.lastDcaBuyTime,
      tokenBalance: job.tokenBalance,
      totalAccumulated: job.totalAccumulated,
    });
    
    // Optionally sync on-chain balance
    // const actualBalance = await getOnChainBalance(job.tokenAddress);
    
    // Resume the engine for this job
    startEngine(job);
  }
}
```

---

## State Updates

After each trade:

```typescript
async function recordTrade(job: Job, trade: Trade): Promise<void> {
  await prisma.$transaction([
    // Record the trade
    prisma.trade.create({
      data: {
        jobId: job.id,
        side: trade.side,
        reason: trade.reason,
        baseAmount: trade.baseAmount,
        quoteAmount: trade.quoteAmount,
        priceUsd: trade.price,
        txHash: trade.txHash,
        status: 'EXECUTED',
        executedAt: new Date(),
      }
    }),
    
    // Update job state
    prisma.job.update({
      where: { id: job.id },
      data: {
        tokenBalance: { increment: trade.side === 'BUY' ? trade.baseAmount : -trade.baseAmount },
        totalAccumulated: { increment: trade.side === 'BUY' ? trade.quoteAmount : 0 },
        lastDcaBuyTime: trade.reason === 'DCA' ? new Date() : undefined,
        updatedAt: new Date(),
      }
    })
  ]);
}
```

---

## Implementation Plan

### Phase 1: Database Setup
- [ ] Add docker-compose.yml
- [ ] Install Prisma dependencies
- [ ] Create schema.prisma
- [ ] Run initial migration

### Phase 2: Job Management
- [ ] Create JobManager class
- [ ] Implement CRUD operations
- [ ] Add state machine logic

### Phase 3: Trade Recording
- [ ] Record all trades to DB
- [ ] Update job state after trades
- [ ] Add transaction support

### Phase 4: Recovery
- [ ] Implement startup recovery
- [ ] Optional: sync on-chain balance
- [ ] Add health checks

### Phase 5: CLI
- [ ] Refactor CLI to use commands
- [ ] Add start/pause/resume/liquidate
- [ ] Add status/list commands

---

## File Structure

```
lgi-mm/
├── docker-compose.yml
├── prisma/
│   └── schema.prisma
├── src/
│   ├── db/
│   │   ├── client.ts      # Prisma client singleton
│   │   └── jobs.ts        # Job CRUD operations
│   ├── core/
│   │   ├── job-manager.ts # Job lifecycle management
│   │   └── daemon.ts      # Multi-job runner
│   └── cli/
│       └── commands/      # CLI command handlers
└── ...
```

---

*Crash, recover, keep stacking.* 🦞
