# NeuroVault

OpenClaw plugin for [BrainBox](https://github.com/thebasedcapital/brainbox). Gives your agent memory that learns — combines **Hebbian learning** (procedural memory) with [VaultGraph](https://github.com/thebasedcapital/vaultgraph) (knowledge graph).

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/thebasedcapital/neurovault.git
cd neurovault && npm install

# 2. Install backends (both optional — install at least one)
cargo install --git https://github.com/thebasedcapital/vaultgraph  # knowledge graph
npm install -g brainbox-hebbian                                     # Hebbian memory

# 3. Register with OpenClaw
openclaw --dev plugins install -l $(pwd)
```

Then add to `~/.openclaw-dev/openclaw.json`:

```json
{
  "plugins": {
    "slots": {
      "memory": "neurovault"
    }
  }
}
```

Restart the gateway and you're done:

```bash
launchctl kickstart -k gui/$(id -u)/ai.openclaw.dev
```

### Verify

```bash
openclaw --dev agent --agent main --local -m "hello"
# Check logs for [neurovault]:
tail -20 ~/.openclaw-dev/logs/gateway.log
```

## What It Does

Before every agent prompt, NeuroVault queries two memory systems and injects relevant context:

```
[neurovault] Unified memory context for this session:

[vaultgraph] Relevant memory files for this task:
  - trading-polymarket (score: 100%, ~1699tok)
  - general-lessons (score: 79%, ~1072tok)

[brainbox] Neural recall for this task:
  - ~/project/src/market.py (confidence: 82%, myelin: 45%)
  - ~/project/src/redeem.py (confidence: 68%, myelin: 38%)
```

After every tool call, it learns which files were accessed together (Hebbian learning). Over time, it builds muscle memory for your codebase.

| System | Type | What It Learns | Speed |
|--------|------|---------------|-------|
| **VaultGraph** | Declarative (what you know) | Knowledge graph over markdown notes | <5ms |
| **BrainBox** | Procedural (how you work) | File access patterns, error-fix pairs, tool chains | ~100ms |

## Configuration

All optional — defaults work out of the box:

| Variable | Default | Description |
|----------|---------|-------------|
| `NEUROVAULT_ENABLED` | `true` | Master enable/disable |
| `NEUROVAULT_VAULT_PATH` | `~/.openclaw/memory` | Markdown vault directory |
| `NEUROVAULT_VG_BUDGET` | `3000` | Max tokens for VaultGraph context |
| `NEUROVAULT_BB_BUDGET` | `5000` | Max tokens for BrainBox context |
| `NEUROVAULT_MIN_CONFIDENCE` | `0.5` | Minimum BrainBox confidence to show |

## Architecture

```
OpenClaw before_agent_start
    |
    |---> VaultGraph (Rust subprocess, <5ms)
    |     Spreading activation over wikilink graph
    |
    +---> BrainBox (SQLite + Hebbian engine, ~100ms)
          Neural recall over file co-access patterns
    |
    v
Combined context injected as system message

OpenClaw after_tool_call
    |
    +---> BrainBox records file access (Hebbian learning)

OpenClaw agent_end
    |
    +---> Captures facts/preferences as semantic neurons
```

## Hooks & Tools

| Hook | Event | Purpose |
|------|-------|---------|
| `before_agent_start` | Every prompt | Inject relevant context |
| `after_tool_call` | Every tool use | Learn file access patterns |
| `agent_end` | Session end | Capture conversation highlights |

| Tool | Description |
|------|-------------|
| `neurovault_recall` | Manually query memory |
| `neurovault_stats` | Show memory statistics |

## Related

- [BrainBox](https://github.com/thebasedcapital/brainbox) — Core Hebbian memory engine (also works standalone with Claude Code, Kilo)
- [VaultGraph](https://github.com/thebasedcapital/vaultgraph) — Knowledge graph CLI for markdown vaults
- [OpenClaw](https://github.com/openclaw) — AI agent platform

## License

MIT
