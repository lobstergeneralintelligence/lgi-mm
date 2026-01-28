/**
 * DexScreener Price Provider
 * 
 * Fast, free price data for any token on supported chains.
 * Rate limits: 300 requests/minute (plenty for MM)
 * 
 * Docs: https://docs.dexscreener.com/api/reference
 */

import { logger } from '../utils/logger.js';
import type { Chain, PriceData } from '../types/index.js';

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

// Map our chain names to DexScreener chain IDs
const CHAIN_MAP: Record<Chain, string> = {
  base: 'base',
  ethereum: 'ethereum',
  polygon: 'polygon',
  solana: 'solana',
  unichain: 'unichain',
};

interface DexScreenerPair {
  chainId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string;
  priceNative: string;
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

/**
 * Get token price from DexScreener by contract address
 */
export async function getTokenPrice(
  tokenAddress: string,
  chain?: Chain
): Promise<PriceData> {
  const url = `${DEXSCREENER_API}/tokens/${tokenAddress}`;
  
  logger.debug(`DexScreener query: ${url}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`DexScreener API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as DexScreenerResponse;
  
  if (!data.pairs || data.pairs.length === 0) {
    throw new Error(`No pairs found for token ${tokenAddress}`);
  }
  
  // Filter by chain if specified
  let pairs = data.pairs;
  if (chain) {
    const chainId = CHAIN_MAP[chain];
    pairs = pairs.filter(p => p.chainId === chainId);
    if (pairs.length === 0) {
      throw new Error(`No pairs found for token ${tokenAddress} on ${chain}`);
    }
  }
  
  // Get the pair with highest liquidity
  const bestPair = pairs.reduce((best, current) => 
    (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best
  );
  
  const price = parseFloat(bestPair.priceUsd);
  
  if (isNaN(price) || price <= 0) {
    throw new Error(`Invalid price from DexScreener: ${bestPair.priceUsd}`);
  }
  
  logger.debug(`DexScreener price: $${price} (${bestPair.baseToken.symbol}/${bestPair.quoteToken.symbol})`);
  
  return {
    price,
    timestamp: new Date(),
    source: 'dexscreener',
  };
}

/**
 * Get detailed pair info
 */
export async function getPairInfo(tokenAddress: string, chain?: Chain): Promise<{
  price: number;
  priceNative: number;
  volume24h: number;
  liquidity: number;
  fdv: number;
  priceChange24h: number;
  baseSymbol: string;
  quoteSymbol: string;
  pairAddress: string;
}> {
  const url = `${DEXSCREENER_API}/tokens/${tokenAddress}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`DexScreener API error: ${response.status}`);
  }
  
  const data = await response.json() as DexScreenerResponse;
  
  if (!data.pairs || data.pairs.length === 0) {
    throw new Error(`No pairs found for token ${tokenAddress}`);
  }
  
  let pairs = data.pairs;
  if (chain) {
    const chainId = CHAIN_MAP[chain];
    pairs = pairs.filter(p => p.chainId === chainId);
  }
  
  const bestPair = pairs.reduce((best, current) => 
    (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best
  );
  
  return {
    price: parseFloat(bestPair.priceUsd) || 0,
    priceNative: parseFloat(bestPair.priceNative) || 0,
    volume24h: bestPair.volume?.h24 || 0,
    liquidity: bestPair.liquidity?.usd || 0,
    fdv: bestPair.fdv || 0,
    priceChange24h: bestPair.priceChange?.h24 || 0,
    baseSymbol: bestPair.baseToken.symbol,
    quoteSymbol: bestPair.quoteToken.symbol,
    pairAddress: bestPair.pairAddress,
  };
}
