#!/usr/bin/env node
/**
 * Stop the market maker
 * 
 * This sends a SIGTERM to the running process.
 * In a real implementation, we'd use a PID file or process manager.
 */

import { execSync } from 'child_process';

console.log('🦞 Stopping market maker...');

try {
  // Find and kill the process
  // This is a simple approach - production would use a PID file
  const result = execSync('pkill -f "tsx.*lgi-mm" 2>/dev/null || pkill -f "node.*lgi-mm" 2>/dev/null || echo "No process found"', {
    encoding: 'utf-8',
  });
  
  if (result.includes('No process found')) {
    console.log('No running market maker process found');
  } else {
    console.log('Stop signal sent');
  }
} catch {
  console.log('Market maker stopped (or was not running)');
}
