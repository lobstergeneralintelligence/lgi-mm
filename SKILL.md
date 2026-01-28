---
name: lgi-mm
description: Autonomous market making for any token pair. Uses Bankr for execution. Configure your pair, set your spread, let it run.
metadata: {"clawdbot":{"emoji":"🦞","homepage":"https://github.com/lobstergeneralintelligence/lgi-mm","requires":{"skills":["bankr"],"bins":["curl","jq"]}}}
---

# LGI Market Maker

Autonomous market making from the ocean floor.

## Prerequisites

This skill requires the **bankr** skill to be installed and configured:
```bash
clawdhub install bankr
# Then configure with your Bankr API key
```

## Configuration

Create `config.json` in the skill directory:

```json
{
  "pair": {
    "base": "ETH",
    "quote": "USDC",
    "chain": "base"
  },
  "strategy": {
    "spreadPercent": 2.0,
    "positionSize": 100,
    "rebalanceThreshold": 10
  },
  "limits": {
    "maxPositionUsd": 1000,
    "minTradeUsd": 10,
    "maxTradesPerHour": 20
  }
}
```

### Configuration Options

| Field | Description | Default |
|-------|-------------|---------|
| `pair.base` | Token to market make | Required |
| `pair.quote` | Quote token (usually USDC) | `USDC` |
| `pair.chain` | Chain to operate on | `base` |
| `strategy.spreadPercent` | Target spread percentage | `2.0` |
| `strategy.positionSize` | Size per trade in USD | `100` |
| `strategy.rebalanceThreshold` | Rebalance when position drifts this % | `10` |

## Usage

### Start Market Making
```bash
scripts/mm-start.sh
```

### Check Status
```bash
scripts/mm-status.sh
```

### Stop
```bash
scripts/mm-stop.sh
```

### Check Balance
```bash
scripts/balance.sh
```

## How It Works

1. **Monitor**: Watches the current price of the pair
2. **Quote**: Maintains bid/ask spread around fair value
3. **Execute**: Uses Bankr to execute trades when opportunities arise
4. **Rebalance**: Adjusts position when inventory drifts too far

## Safety

- All trades go through Bankr (no direct wallet access)
- Position limits enforced
- Rate limiting on trades
- Logs all activity

## Logs

Activity is logged to `logs/mm.log` (created automatically).

---

*From the ocean floor, with claws.* 🦞
