# LGI-MM Usage Guide

## Quick Start

```bash
# Start accumulating
npm run mm:start

# Check status
npm run mm:status

# Pause (preserves state)
npm run mm:pause

# Stop (kills process)
npm run mm:stop

# Reset database (fresh start)
npm run mm:reset
```

## Configuration (`config.json`)

### Timing & Speed

The bottleneck is **Bankr API latency** (30-90 seconds per call). Plan around this:

| Setting | What it does | Recommended |
|---------|--------------|-------------|
| `strategy.tickIntervalSeconds` | How often to check prices/execute | 120-300s (2-5 min) |
| `accumulate.dcaIntervalHours` | Time between DCA buys | 0.0833+ (5+ min) |
| `accumulate.dcaAmount` | USD per DCA buy | $5-50 |

**Why not faster?**
- Each tick: price check (~1s via DexScreener) + balance check (~30-60s via Bankr) + trade (~60-120s via Bankr)
- Total tick time: 90-180 seconds
- Setting `tickIntervalSeconds` below 120 will cause overlapping ticks (handled via lock, but wasteful)

### Speed Presets

**Slow & Steady (default)**
```json
{
  "strategy": { "tickIntervalSeconds": 120 },
  "accumulate": {
    "dcaAmount": 5,
    "dcaIntervalHours": 0.1667  // 10 min
  }
}
```
- $5 every 10 min = $30/hour = ~6.5 hours for $200

**Medium**
```json
{
  "strategy": { "tickIntervalSeconds": 120 },
  "accumulate": {
    "dcaAmount": 10,
    "dcaIntervalHours": 0.0833  // 5 min
  }
}
```
- $10 every 5 min = $120/hour = ~1.7 hours for $200

**Fast (aggressive)**
```json
{
  "strategy": { "tickIntervalSeconds": 120 },
  "accumulate": {
    "dcaAmount": 20,
    "dcaIntervalHours": 0.05  // 3 min
  }
}
```
- $20 every 3 min = $400/hour = 30 min for $200
- ⚠️ May hit rate limits or cause price impact

### Announcements

```json
{
  "announcements": {
    "enabled": true,
    "telegram": {
      "chatId": "@your_channel",
      "botTokenPath": "~/.clawdbot/secrets/telegram-bot.json"
    }
  }
}
```

Bot token JSON format:
```json
{ "botToken": "123456:ABC-xyz..." }
```

### Limits

```json
{
  "limits": {
    "maxPositionUsd": 200,      // Max total position value
    "minTradeUsd": 1,           // Minimum trade size
    "maxTradesPerHour": 20      // Rate limit
  },
  "accumulate": {
    "maxAccumulationUsd": 200   // Stop buying after spending this much
  }
}
```

## Database

State persists in PostgreSQL. Key tables:

- `Job`: Current position, accumulated amount, last DCA time
- `Trade`: History of all trades

### Resuming After Restart

The MM automatically resumes from DB state:
- Knows how much you've accumulated
- Respects last DCA time (won't double-buy)
- Tracks token balance

### Fresh Start

```bash
npm run mm:reset  # Wipes DB, starts fresh
```

## Troubleshooting

### "Bankr job timed out"

Bankr API can be slow (30-120s). The MM retries twice automatically.

If persistent:
- Check Bankr API status
- Increase timeout in `src/bankr/client.ts` (BALANCE_TIMEOUT_MS, TRADE_TIMEOUT_MS)

### Overlapping Ticks

If you see "Tick skipped - previous tick still running", that's normal.
The tick lock prevents duplicate trades. Consider increasing `tickIntervalSeconds`.

### No Trades Happening

Check:
1. `dcaIntervalHours` - is it time for the next DCA?
2. `maxAccumulationUsd` - have you hit the limit?
3. Quote balance - do you have enough ETH/USDC?
