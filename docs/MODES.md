# LGI-MM Operating Modes

Two distinct strategies for different goals.

---

## Mode 1: `liquidity` (Token Project Owner)

**Goal:** Provide liquidity and support healthy price action for your token.

### Behavior
- Maintain balanced inventory (configurable ratio, default 50/50)
- Buy when price drops below moving average (support the floor)
- Sell when price spikes above moving average (reduce volatility)
- Tighter spread tolerance — active trading
- React to large sells with supportive buys

### Config Example
```json
{
  "mode": "liquidity",
  "pair": {
    "base": "MYTOKEN",
    "baseAddress": "0x...",
    "quote": "ETH",
    "chain": "base"
  },
  "liquidity": {
    "targetRatio": 0.5,           // 50% token, 50% ETH
    "rebalanceThreshold": 10,     // Rebalance when 10% off target
    "supportBuyMultiplier": 1.5,  // Buy 1.5x normal size on dips
    "maxDailyVolume": 500         // Max $500/day in trades
  }
}
```

### Logic
```
On each tick:
  1. Get price + moving average
  2. If price < MA * (1 - spreadPercent): BUY (support)
  3. If price > MA * (1 + spreadPercent): SELL (take profit)
  4. If inventory drifts > threshold: REBALANCE
```

---

## Mode 2: `accumulate` (DCA / Stack)

**Goal:** Build a position in a token over time at favorable prices.

### Behavior
- Primary action: BUY
- Buy on schedule (time-based DCA)
- Buy extra on dips (opportunistic)
- Only sell on major pumps to rebuy lower (optional)
- Goal: maximize token count, not USD balance

### Config Example
```json
{
  "mode": "accumulate",
  "pair": {
    "base": "TARGETTOKEN",
    "baseAddress": "0x...",
    "quote": "ETH",
    "chain": "base"
  },
  "accumulate": {
    "dcaAmount": 10,              // Buy $10 worth
    "dcaIntervalHours": 4,        // Every 4 hours
    "dipBuyThreshold": 5,         // Buy extra if price drops 5%+
    "dipBuyMultiplier": 2,        // Buy 2x on dips
    "takeProfitPercent": 20,      // Sell 10% of stack if up 20%
    "takeProfitSellPercent": 10,  // Only sell 10% of holdings
    "maxAccumulationUsd": 1000    // Stop accumulating at $1000 position
  }
}
```

### Logic
```
On each tick:
  1. Check if DCA interval passed → BUY dcaAmount
  2. Check if price dropped > dipBuyThreshold from recent high → BUY extra
  3. Check if price up > takeProfitPercent → SELL small % to lock gains
  4. Stop buying if position > maxAccumulationUsd
```

---

## Implementation Plan

### Phase 1: Schema & Types
- [ ] Add `mode: 'liquidity' | 'accumulate'` to config
- [ ] Add mode-specific config sections
- [ ] Update Zod schema with conditional validation

### Phase 2: Price Tracking
- [ ] Implement moving average calculation
- [ ] Track recent high/low for dip detection
- [ ] Add price history persistence (survive restarts)

### Phase 3: Liquidity Mode Engine
- [ ] Refactor `checkSpreadOpportunity` → `liquidityTick`
- [ ] Implement MA-based buy/sell decisions
- [ ] Add support buy logic (larger buys on dips)

### Phase 4: Accumulate Mode Engine  
- [ ] Implement DCA scheduler
- [ ] Add dip detection + opportunistic buys
- [ ] Add optional take-profit logic
- [ ] Track accumulated amount vs target

### Phase 5: Shared Infrastructure
- [ ] Unified tick dispatcher (routes to correct mode)
- [ ] State persistence (position, last DCA time, price history)
- [ ] Telegram notifications for trades

---

## Comparison

| Feature | Liquidity Mode | Accumulate Mode |
|---------|---------------|-----------------|
| Primary goal | Support token | Build position |
| Buy trigger | Price < MA | Schedule + dips |
| Sell trigger | Price > MA | Big pumps only |
| Inventory | Balanced | Maximize tokens |
| Trade frequency | High | Low-medium |
| Best for | Token creators | Investors |

---

*Pick your mode. Let it run.* 🦞
