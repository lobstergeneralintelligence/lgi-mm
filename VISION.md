# Vision

## The Problem

Market making traditionally requires:
- Complex infrastructure
- Direct wallet/key management
- Chain-specific contract integrations
- 24/7 monitoring
- Deep technical knowledge

This locks out most people from providing liquidity and capturing spreads.

## The Solution

LGI-MM abstracts all of this away:

```
┌─────────────────────────────────────────┐
│            LGI-MM Skill                 │
│  ┌───────────────────────────────────┐  │
│  │  Strategy Layer                   │  │
│  │  - When to buy/sell               │  │
│  │  - Spread calculations            │  │
│  │  - Position management            │  │
│  │  - Risk controls                  │  │
│  └───────────────────────────────────┘  │
│                  │                      │
│                  ▼                      │
│  ┌───────────────────────────────────┐  │
│  │  Bankr (execution layer)          │  │
│  │  Natural language → trades        │  │
│  │  Multi-chain, managed wallets     │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

You configure *what* you want to do. Bankr handles *how* it gets done.

## Roadmap

### Phase 1: Foundation ✅ (current)
- [x] Repository setup
- [ ] Port existing clawdia-mm logic
- [ ] Replace ethers.js with Bankr integration
- [ ] Basic config schema

### Phase 2: Generalization
- [ ] Multi-pair support
- [ ] Chain selection
- [ ] Strategy presets (conservative, aggressive, degen)
- [ ] Position limits and risk controls

### Phase 3: Skill Packaging
- [ ] SKILL.md with full documentation
- [ ] Reference docs for strategies
- [ ] ClawdHub publication
- [ ] Install/config automation

### Phase 4: Advanced Features
- [ ] Multiple concurrent pairs
- [ ] Cross-chain arbitrage detection
- [ ] Dynamic spread adjustment
- [ ] Performance analytics
- [ ] Telegram/Discord alerts

## Non-Goals

- **Not a trading bot**: This is a market maker, not a directional trader
- **Not financial advice**: You're responsible for your own funds
- **Not foolproof**: Markets can move against you

## Principles

1. **Simplicity over features** — Do one thing well
2. **Safety by default** — Conservative defaults, explicit risk-taking
3. **Transparency** — Log everything, hide nothing
4. **Composability** — Play nice with other skills

---

*Slow and steady wins the race. Especially when you're immortal.* 🦞
