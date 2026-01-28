#!/usr/bin/env node
/**
 * LGI Market Maker - Entry Point
 * 
 * Usage:
 *   npm run start                    # Start with config.json
 *   npm run start -- --dry-run       # Dry run mode
 *   npm run start -- --simulation    # Use simulated trading
 *   npm run start -- --no-db         # Skip database (legacy mode)
 */

import { loadConfig } from './config/index.js';
import { createBankrClient } from './bankr/index.js';
import { createEngine } from './core/index.js';
import { logger } from './utils/logger.js';
import { 
  connectDb, 
  disconnectDb, 
  getJob, 
  createJob, 
  updateJobStatus,
  type Job 
} from './db/index.js';

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const simulation = args.includes('--simulation') || args.includes('--sim');
  const debug = args.includes('--debug');
  const noDb = args.includes('--no-db');
  const configPath = args.find((a) => a.startsWith('--config='))?.split('=')[1];

  if (debug) {
    logger.setLevel('debug');
  }

  // Banner
  console.log(`
  🦞 LGI Market Maker
  ══════════════════════════════════════
  `);

  let job: Job | undefined;

  try {
    // Load configuration
    const config = loadConfig(configPath);
    
    // Override dry run from CLI
    if (dryRun) {
      config.dryRun = true;
    }

    logger.info('Configuration loaded', {
      mode: config.mode,
      pair: `${config.pair.base}/${config.pair.quote}`,
      chain: config.pair.chain,
      tickInterval: `${config.strategy.tickIntervalSeconds}s`,
      dryRun: config.dryRun,
      ...(config.mode === 'accumulate' && config.accumulate ? {
        dcaAmount: `$${config.accumulate.dcaAmount}`,
        dcaInterval: `${config.accumulate.dcaIntervalHours}h`,
      } : {}),
    });

    // Connect to database (unless --no-db)
    if (!noDb) {
      logger.info('Connecting to database...');
      await connectDb();
      
      // Get or create job for this token
      const tokenAddress = config.pair.baseAddress?.toLowerCase();
      if (!tokenAddress) {
        throw new Error('Token address required for database mode. Use --no-db for legacy mode.');
      }

      job = await getJob(tokenAddress) ?? undefined;
      
      if (job) {
        logger.info('Resuming existing job', {
          jobId: job.id,
          status: job.status,
          tokenBalance: job.tokenBalance,
          totalAccumulated: job.totalAccumulated,
        });
        
        // Check if job is in a resumable state
        if (job.status === 'LIQUIDATING') {
          throw new Error('Job is being liquidated. Wait for completion or reset.');
        }
        if (job.status === 'ERROR') {
          logger.warn('Resuming job that was in ERROR state');
        }
      } else {
        // Create new job
        logger.info('Creating new job for token', { tokenAddress });
        job = await createJob({
          tokenAddress,
          tokenSymbol: config.pair.base,
          chain: config.pair.chain,
          quoteToken: config.pair.quote,
          mode: config.mode === 'accumulate' ? 'ACCUMULATE' : 'LIQUIDITY',
          config: JSON.parse(JSON.stringify(config.accumulate || config.liquidity || {})),
        });
      }

      // Update job status to RUNNING
      job = await updateJobStatus(job.id, 'RUNNING');
    } else {
      logger.warn('Running without database (--no-db). State will not persist.');
    }

    // Create Bankr client
    const bankr = createBankrClient({
      mode: simulation ? 'simulation' : 'live',
      chain: config.pair.chain,
    });

    // Create engine (pass job for DB persistence)
    const engine = createEngine(config, bankr, job);

    // Handle shutdown gracefully
    const shutdown = async (): Promise<void> => {
      logger.info('Shutdown signal received');
      engine.stop();
      
      // Update job status to PAUSED
      if (job && !noDb) {
        try {
          await updateJobStatus(job.id, 'PAUSED');
          await disconnectDb();
        } catch (err) {
          logger.error(`Error updating job status: ${err}`);
        }
      }
      
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start the engine
    await engine.start();

    // Keep process alive
    logger.info('Market maker running. Press Ctrl+C to stop.');

  } catch (err) {
    logger.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
    
    // Update job status to ERROR
    if (job && !noDb) {
      try {
        await updateJobStatus(job.id, 'ERROR', { lastError: String(err) });
        await disconnectDb();
      } catch (dbErr) {
        logger.error(`Error updating job status: ${dbErr}`);
      }
    }
    
    process.exit(1);
  }
}

main();
