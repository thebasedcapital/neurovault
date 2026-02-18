# NeuroVault

Unified memory system for OpenClaw agents. Combines **Hebbian learning** (BrainBox) with **knowledge graph** (VaultGraph) for intelligent context injection.

## How It Works

Before every agent prompt (`before_agent_start`), NeuroVault queries two memory systems in parallel and injects relevant context:

```
[neurovault] Unified memory context for this session:

[vaultgraph] Relevant memory files for this task:
  - trading-polymarket (score: 100%, ~1699tok) — Polymarket API docs
  - general-lessons (score: 79%, ~1072tok) — Past mistakes
Load with: Read ~/.openclaw/memory/trading-polymarket.md

[brainbox] Neural recall for this task:
  - ~/project/src/market.py (confidence: 82%, myelin: 45%)
  - ~/project/src/redeem.py (confidence: 68%, myelin: 38%)
These files were frequently accessed together in similar contexts.
```

### Two Memory Types

| System | What It Does | Speed |
|--------|-------------|-------|
| **VaultGraph** | Knowledge graph over markdown notes — spreading activation finds related concepts | <5ms |
| **BrainBox** | Learns file access patterns via Hebbian learning — "neurons that fire together wire together" | ~100ms |

Together: **declarative memory** (what you know) + **procedural memory** (how you work) = complete agent memory.

## Install

```bash
# Clone the repo
git clone https://github.com/thebasedcapital/neurovault.git
cd neurovault && npm install

# Install as OpenClaw plugin
openclaw --dev plugins install -l /path/to/neurovault
```

Then set the memory slot in `~/.openclaw-dev/openclaw.json`:

```json
{
  "plugins": {
    "slots": {
      "memory": "neurovault"
    }
  }
}
```

### Memory Backends (install at least one)

```bash
# VaultGraph — Rust CLI, knowledge graph over markdown notes
# https://github.com/thebasedcapital/vaultgraph
cargo install vaultgraph

# BrainBox — Hebbian memory engine (optional, enhances recall)
# https://github.com/thebasedcapital/brainbox
npm install brainbox-hebbian
```

### Verify

```bash
# Check that backends are available
./bin/check-deps.js

# Quick test with OpenClaw
openclaw --dev agent --agent main --local -m "test message"
# Look for [neurovault] in logs: ~/.openclaw-dev/logs/gateway.log
```

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `NEUROVAULT_ENABLED` | `true` | Master enable/disable |
| `NEUROVAULT_VAULT_PATH` | `~/.openclaw/memory` | VaultGraph vault directory |
| `NEUROVAULT_VG_BUDGET` | `3000` | Max tokens for VaultGraph |
| `NEUROVAULT_BB_BUDGET` | `5000` | Max tokens for BrainBox |
| `NEUROVAULT_MIN_CONFIDENCE` | `0.5` | BrainBox minimum confidence |

## vs ClawVault

| | ClawVault | NeuroVault |
|---|---|---|
| Memory type | Declarative only (notes) | Declarative + procedural |
| Learning | None — static storage | Hebbian — learns from usage |
| Graph engine | Wiki-link traversal | Spreading activation (<5ms Rust) |
| Error learning | No | Yes — debugging immune system |
| Tool prediction | No | Yes — myelinated tool chains |
| Speed | JS semantic search | Rust graph + SQLite neural net |

## Architecture

```
OpenClaw before_agent_start event
    |
    |---> VaultGraph (Rust subprocess, <5ms)
    |     Spreading activation over wikilink graph
    |
    +---> BrainBox (Node.js import, ~100ms)
          Hebbian recall over file co-access patterns
    |
    v
Combined context injected as system message
```

## License

MIT
