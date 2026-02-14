# NeuroVault — OpenClaw Memory Plugin Handover

**Version:** 0.3.0 | **Updated:** 2026-02-14

## What It Is

NeuroVault replaces OpenClaw's built-in memory with two systems:
- **VaultGraph** — knowledge graph from markdown files (spreading activation over wikilinks)
- **BrainBox** — Hebbian learning engine (learns from every tool call, recalls relevant files)

Fully local. Zero API keys. No network calls.

## Architecture

```
~/Projects/neurovault/
├── index.ts              — Plugin entry: hooks + tools registration
├── src/brainbox-db.ts    — SQLite Hebbian engine (record, recall, decay)
├── src/vaultgraph.ts     — VaultGraph subprocess wrapper (JSON mode + file content)
├── src/utils.ts          — Path extraction, keyword enrichment, error detection
├── openclaw.plugin.json  — Plugin manifest (memory slot)
└── package.json          — better-sqlite3 + @sinclair/typebox
```

## Runtime

- **Gateway:** port 19001, launchd `ai.openclaw.dev`
- **Config:** `~/.openclaw-dev/openclaw.json`
- **DB:** `~/.openclaw/neurovault/brainbox.db` (NOT in `.openclaw-dev/`)
- **Vault:** `~/.openclaw/memory` (default) or `~/.claude/projects/-Users-bbclaude/memory/`
- **Model:** `fireworks/accounts/fireworks/models/glm-4p7` (GLM-4.7)
- **Restart:** `launchctl kickstart -k gui/$(id -u)/ai.openclaw.dev`
- **CLI test:** `openclaw --dev agent --agent main --local -m "message"`

## Plugin Hooks

| Event | What It Does |
|-------|-------------|
| `before_agent_start` | Injects VaultGraph context + BrainBox recall into prompt |
| `after_tool_call` | Records file paths, extracts keywords, detects errors (Hebbian learning) |
| `agent_end` | Captures facts/preferences from conversation text |

## Agent Tools

| Tool | Description |
|------|------------|
| `neurovault_recall` | Query neural memory (keyword + spreading activation) |
| `neurovault_stats` | Show neurons, synapses, superhighways, learning progress |

## Key Design Decisions

### Tool Name Compatibility
OpenClaw embedded agent uses lowercase tool names (`read`, `exec`) with `path` param.
Claude Code uses PascalCase (`Read`, `Bash`) with `file_path` param.
Both are handled via case-insensitive matching.

### Result Object Parsing
OpenClaw's `event.result` is an object (not a string). We extract text from:
1. `result.text` (direct string)
2. `result.content[].text` (content blocks)
3. `JSON.stringify(result)` (last resort)

### Keyword Enrichment (No Embeddings)
Without vector embeddings, we compensate by extracting top-frequency identifiers
from tool results and storing them as context entries:
`read:/path keywords:neurovault,memory,vitest,openclaw,hooks`

### Confidence Tuning
- Gate: 0.3 (vs Claude Code's 0.4) — no embeddings means keyword matching needs leeway
- Keyword weight: 50% (vs 40%) — primary signal without vectors
- Myelination weight: 20% (vs 30%) — less trust in frequency alone

### Multi-hop Spreading (Ported from Claude Code)
- 3 hops BFS with fan-out 10
- Collins & Loftus convergence (take max confidence on re-activation)
- Activation path labels: `spread(2) via file.ts → utils.ts`

### Myelinated Fallback Fix
Original BrainBox had a bug: `myelination * 0.3 < 0.4` was always true (max 0.285).
Fixed in both NeuroVault and Claude Code BrainBox: `myelination * 0.5` with gate 0.15.

## Current State (2026-02-14)

```
Neurons:      13
Synapses:     150
Accesses:     301
Superhighways: 4 (83.4%, 72.0%, 62.8%, 54.5%)
```

## What's NOT Ported from Claude Code BrainBox

- **Vector embeddings** (Phase 1b cosine similarity) — would need an embedding model
- **Token budget tracking** in recall — lower priority
- **Token savings reporting** — nice to have

## Gotchas

1. `session:start` event is NEVER dispatched by OpenClaw — use `agent:bootstrap`
2. VaultGraph now injects full file content (~26K chars) — agent often answers from context without tool calls
3. `after_tool_call` won't fire when agent answers from injected context (no tools used)
4. Gateway log at `~/.openclaw-dev/logs/gateway.log` only shows first startup — check `/tmp/openclaw/openclaw-YYYY-MM-DD.log` for runtime logs
5. `api.logger.debug?.()` is a no-op — gateway only records INFO+
6. Session lock: can't run parallel `openclaw agent` commands on same session
