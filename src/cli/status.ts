#!/usr/bin/env node
/**
 * Check market maker status
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, '..', '..', 'state.json');
const LOG_FILE = join(__dirname, '..', '..', 'logs', 'mm.log');

console.log(`
🦞 LGI Market Maker Status
══════════════════════════════════════
`);

// Check for state file
if (existsSync(STATE_FILE)) {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    console.log('State:', JSON.stringify(state, null, 2));
  } catch {
    console.log('State: Unable to read');
  }
} else {
  console.log('State: No state file found (not running or never started)');
}

// Show recent logs
console.log('\nRecent log entries:');
console.log('─'.repeat(40));

if (existsSync(LOG_FILE)) {
  try {
    const logs = readFileSync(LOG_FILE, 'utf-8');
    const lines = logs.trim().split('\n');
    const recent = lines.slice(-10);
    console.log(recent.join('\n'));
  } catch {
    console.log('Unable to read log file');
  }
} else {
  console.log('No log file found');
}
