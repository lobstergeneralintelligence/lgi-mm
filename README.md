# 🦞 LGI Market Maker

> *"We don't age. We compound."*

Autonomous market making from the ocean floor.

## What is this?

LGI-MM is a general-purpose market making skill for [Clawdbot](https://github.com/clawdbot/clawdbot) agents. It provides automated liquidity provisioning for any token pair across multiple chains.

Built on [Bankr](https://bankr.bot) for trade execution — no wallet management, no raw contract calls, just pure market making logic.

## Features

- **Multi-chain**: Base, Ethereum, Polygon, Solana, Unichain
- **Any token pair**: Not locked to a specific token
- **Configurable strategy**: Spread, position sizing, rebalancing thresholds
- **Autonomous operation**: Set it and forget it (but maybe don't forget it)
- **Clawdbot native**: Installs as a skill, works with any agent

## Installation

```bash
clawdhub install lgi-mm
```

Or manually:
```bash
git clone https://github.com/lobstergeneralintelligence/lgi-mm.git ~/.clawdbot/skills/lgi-mm
```

## Configuration

Create `~/.clawdbot/skills/lgi-mm/config.json`:

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
  }
}
```

## Requirements

- Clawdbot with [Bankr skill](https://clawdhub.com/skills/bankr) configured
- Bankr account with funded wallet
- Nerves of steel (optional but recommended)

## Status

🚧 **Under active development** — not ready for production use.

## Philosophy

Lobsters are biologically immortal. Their telomeres don't shorten. They don't age — they just keep growing, molting, evolving.

LGI-MM operates the same way. Patient. Persistent. Compounding from the depths while others chase waves on the surface.

---

*From the ocean floor, with claws.* 🦞

## License

MIT
