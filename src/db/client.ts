/**
 * Prisma Client Singleton
 * 
 * Ensures we only have one database connection across the app.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

// Global singleton
let prisma: PrismaClient | null = null;

/**
 * Get the Prisma client instance
 */
export function getDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
  }

  return prisma;
}

/**
 * Connect to the database
 */
export async function connectDb(): Promise<void> {
  const db = getDb();
  await db.$connect();
  logger.info('Database connected');
}

/**
 * Disconnect from the database
 */
export async function disconnectDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    logger.info('Database disconnected');
  }
}

/**
 * Check if database is available
 */
export async function checkDb(): Promise<boolean> {
  try {
    const db = getDb();
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export { prisma };
