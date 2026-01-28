#!/usr/bin/env node
/**
 * Pause the market maker
 * 
 * Stops the process and sets job status to PAUSED in DB.
 * Position is preserved for later resume.
 */

import { execSync } from 'child_process';
import { connectDb, disconnectDb, updateJobStatus } from '../db/index.js';
import { loadConfig } from '../config/index.js';

async function main() {
  console.log('🦞 Pausing market maker...\n');

  // 1. Stop the process
  try {
    execSync('pkill -f "tsx.*lgi-mm" 2>/dev/null || pkill -f "node.*lgi-mm" 2>/dev/null', {
      encoding: 'utf-8',
    });
    console.log('✓ Process stopped');
  } catch {
    console.log('✓ Process already stopped');
  }

  // 2. Update job status in DB
  try {
    const config = loadConfig();
    const tokenAddress = config.pair.baseAddress?.toLowerCase();
    
    if (!tokenAddress) {
      console.log('⚠ No token address in config, skipping DB update');
      return;
    }

    await connectDb();
    
    // Find the job and update status
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    
    const job = await prisma.job.findUnique({
      where: { tokenAddress },
    });
    
    if (job) {
      await updateJobStatus(job.id, 'PAUSED');
      console.log(`✓ Job ${job.tokenSymbol} set to PAUSED`);
      console.log(`  Accumulated: $${job.totalAccumulated.toFixed(2)}`);
      console.log(`  Token balance: ${job.tokenBalance.toFixed(2)}`);
    } else {
      console.log('⚠ No job found for this token');
    }
    
    await prisma.$disconnect();
    await disconnectDb();
  } catch (err) {
    console.error(`DB update failed: ${err}`);
  }

  console.log('\n✓ Market maker paused');
  console.log('  Run `npm run mm:start` to resume');
}

main().catch(console.error);
