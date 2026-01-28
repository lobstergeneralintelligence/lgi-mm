/**
 * Configuration loading and validation
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { configSchema, type ValidatedConfig } from './schema.js';
import type { Config } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILENAME = 'config.json';

/**
 * Find and load the config file
 * Looks in: current skill directory, then ~/.clawdbot/skills/lgi-mm/
 */
export function findConfigPath(): string | null {
  const paths = [
    join(process.cwd(), CONFIG_FILENAME),
    join(__dirname, '..', '..', CONFIG_FILENAME),
    join(process.env.HOME || '', '.clawdbot', 'skills', 'lgi-mm', CONFIG_FILENAME),
  ];

  for (const path of paths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Load and validate configuration
 */
export function loadConfig(configPath?: string): Config {
  const path = configPath || findConfigPath();

  if (!path) {
    throw new Error(
      'No config.json found. Create one based on config.example.json'
    );
  }

  let rawConfig: unknown;
  try {
    const content = readFileSync(path, 'utf-8');
    rawConfig = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to read config from ${path}: ${err}`);
  }

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data as Config;
}

/**
 * Get default config (for generating examples)
 */
export function getDefaultConfig(): ValidatedConfig {
  return configSchema.parse({
    pair: { base: 'ETH' },
  });
}
