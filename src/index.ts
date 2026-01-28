#!/usr/bin/env node
/**
 * LGI Market Maker - Entry Point
 * 
 * Usage:
 *   npm run mm:start          # Start with config.json
 *   npm run mm:start -- --dry-run   # Dry run mode
 *   npm run mm:start -- --simulation # Use simulated trading
 */

import { loadConfig } from './config/index.js';
import { createBankrClient } from './bankr/index.js';
import { createEngine } from './core/index.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const simulation = args.includes('--simulation') || args.includes('--sim');
  const debug = args.includes('--debug');
  const configPath = args.find((a) => a.startsWith('--config='))?.split('=')[1];

  if (debug) {
    logger.setLevel('debug');
  }

  // Banner
  console.log(`
  🦞 LGI Market Maker
  ══════════════════════════════════════
  `);

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

    // Create Bankr client
    const bankr = createBankrClient({
      mode: simulation ? 'simulation' : 'live',
      chain: config.pair.chain,
    });

    // Create and start engine
    const engine = createEngine(config, bankr);

    // Handle shutdown gracefully
    const shutdown = (): void => {
      logger.info('Shutdown signal received');
      engine.stop();
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
    process.exit(1);
  }
}

main();
