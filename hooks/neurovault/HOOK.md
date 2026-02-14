---
name: neurovault
description: "Unified memory — Hebbian file patterns (BrainBox) + knowledge graph (VaultGraph) for intelligent context injection"
metadata:
  openclaw:
    emoji: "🧠"
    events: ["agent:bootstrap"]
    requires:
      bins: []
---

# NeuroVault Hook

Combines two memory systems for OpenClaw agents:

- **VaultGraph** — Knowledge graph over markdown notes. Spreading activation finds relevant context in <5ms.
- **BrainBox** — Hebbian learning from file access patterns. Learns which files are used together, builds neural pathways.

## What It Does

### On Session Start

1. Extracts the user's initial prompt
2. Queries VaultGraph (knowledge graph) and BrainBox (file patterns) in parallel
3. Injects relevant context as a system message

## Installation

```bash
npm install -g neurovault
openclaw hooks install neurovault
openclaw hooks enable neurovault
```

## Requirements

At least one memory backend:
- **VaultGraph** — `brew install vaultgraph` (Rust CLI)
- **BrainBox** — `npm install -g brainbox` (Node.js + SQLite)

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NEUROVAULT_ENABLED` | `true` | Master enable/disable |
| `NEUROVAULT_VAULT_PATH` | `~/.openclaw/memory` | VaultGraph vault directory |
| `NEUROVAULT_VG_BUDGET` | `3000` | Max tokens for VaultGraph context |
| `NEUROVAULT_BB_BUDGET` | `5000` | Max tokens for BrainBox recall |
| `NEUROVAULT_MIN_CONFIDENCE` | `0.5` | Minimum BrainBox confidence threshold |
