/**
 * Reset a job to initial state
 */
import { connectDb, disconnectDb } from '../db/client.js';
import { getJob, resetJob } from '../db/jobs.js';

const TOKEN_ADDRESS = '0xbbd9aDe16525acb4B336b6dAd3b9762901522B07';

async function main() {
  await connectDb();
  
  const job = await getJob(TOKEN_ADDRESS);
  if (!job) {
    console.log('No job found for token');
    await disconnectDb();
    return;
  }
  
  console.log('Current state:', {
    status: job.status,
    totalAccumulated: job.totalAccumulated,
    tokenBalance: job.tokenBalance,
    recentHigh: job.recentHigh,
  });
  
  await resetJob(job.id);
  console.log('Job reset to IDLE state');
  
  await disconnectDb();
}

main().catch(console.error);
