/**
 * BrainBox SQLite Layer for NeuroVault
 *
 * Direct SQLite access using better-sqlite3 for synchronous operations.
 * Compatible with the BrainBox schema from ~/happy-cli-new/brainbox/.
 * Implements core Hebbian learning: record, strengthen, recall, decay.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// --- Constants ---

const LEARNING_RATE = 0.1;
const MYELIN_RATE = 0.02;
const MYELIN_MAX = 0.95;
const SYNAPSE_DECAY_RATE = 0.02;
const ACTIVATION_DECAY_RATE = 0.15;
const MYELIN_DECAY_RATE = 0.005;
const SYNAPSE_PRUNE_THRESHOLD = 0.05;
const CONFIDENCE_GATE = 0.4;
const CO_ACCESS_WINDOW_SIZE = 10;

// --- Types ---

export interface Neuron {
  id: string;
  type: "file" | "tool" | "error" | "semantic";
  path: string;
  activation: number;
  myelination: number;
  access_count: number;
  last_accessed: string | null;
  created_at: string;
  contexts: string[];
}

export interface RecallResult {
  neuron: Neuron;
  confidence: number;
  activation_path: string;
}

export interface BrainBoxStats {
  neuron_count: number;
  synapse_count: number;
  superhighways: number;
  total_accesses: number;
  avg_myelination: number;
}

// --- Database ---

export class BrainBoxDB {
  private db: Database.Database;
  private dbPath: string;
  private recentAccesses: string[] = [];
  private sessionId: string;
  private accessOrder = 0;
  private stmts: ReturnType<BrainBoxDB["prepareStatements"]>;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.sessionId = `nv-${Date.now()}`;
    this.stmts = this.prepareStatements();

    // Create session record
    this.stmts.createSession.run({ id: this.sessionId, now: new Date().toISOString() });

    // Seed recent accesses from last hour
    const recent = this.db.prepare(`
      SELECT neuron_id FROM access_log
      WHERE timestamp > datetime('now', '-1 hour')
      ORDER BY timestamp ASC, access_order ASC
    `).all() as { neuron_id: string }[];
    for (const row of recent) {
      const idx = this.recentAccesses.indexOf(row.neuron_id);
      if (idx !== -1) this.recentAccesses.splice(idx, 1);
      this.recentAccesses.push(row.neuron_id);
    }
    if (this.recentAccesses.length > CO_ACCESS_WINDOW_SIZE) {
      this.recentAccesses = this.recentAccesses.slice(-CO_ACCESS_WINDOW_SIZE);
    }
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS neurons (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        activation REAL DEFAULT 0,
        myelination REAL DEFAULT 0,
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT,
        created_at TEXT NOT NULL,
        contexts TEXT DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS synapses (
        source_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
        weight REAL DEFAULT 0.1,
        co_access_count INTEGER DEFAULT 1,
        last_fired TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id)
      );
      CREATE TABLE IF NOT EXISTS access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        neuron_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        query TEXT,
        timestamp TEXT NOT NULL,
        token_cost INTEGER DEFAULT 0,
        access_order INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        total_accesses INTEGER DEFAULT 0,
        tokens_used INTEGER DEFAULT 0,
        tokens_saved INTEGER DEFAULT 0,
        hit_rate REAL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_neurons_type ON neurons(type);
      CREATE INDEX IF NOT EXISTS idx_neurons_myelination ON neurons(myelination DESC);
      CREATE INDEX IF NOT EXISTS idx_synapses_weight ON synapses(weight DESC);
      CREATE INDEX IF NOT EXISTS idx_access_log_session ON access_log(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_access_log_neuron ON access_log(neuron_id);
    `);

    // v2 migration
    try { this.db.exec(`ALTER TABLE access_log ADD COLUMN access_order INTEGER DEFAULT 0`); } catch {}
    // v3 migration
    try { this.db.exec(`ALTER TABLE neurons ADD COLUMN embedding BLOB DEFAULT NULL`); } catch {}
  }

  private prepareStatements() {
    return {
      getNeuron: this.db.prepare(`SELECT * FROM neurons WHERE id = ?`),
      upsertNeuron: this.db.prepare(`
        INSERT INTO neurons (id, type, path, activation, myelination, access_count, last_accessed, created_at, contexts)
        VALUES (@id, @type, @path, @activation, @myelination, 1, @now, @now, @contexts)
        ON CONFLICT(id) DO UPDATE SET
          activation = @activation,
          myelination = MIN(neurons.myelination + ${MYELIN_RATE} * (1.0 - neurons.myelination), ${MYELIN_MAX}),
          access_count = neurons.access_count + 1,
          last_accessed = @now,
          contexts = @contexts
      `),
      getSynapses: this.db.prepare(`SELECT * FROM synapses WHERE source_id = ? ORDER BY weight DESC`),
      upsertSynapse: this.db.prepare(`
        INSERT INTO synapses (source_id, target_id, weight, co_access_count, last_fired, created_at)
        VALUES (@source, @target, @weight, 1, @now, @now)
        ON CONFLICT(source_id, target_id) DO UPDATE SET
          weight = MIN(synapses.weight + @delta * (1.0 - synapses.weight), 1.0),
          co_access_count = synapses.co_access_count + 1,
          last_fired = @now
      `),
      logAccess: this.db.prepare(`
        INSERT INTO access_log (neuron_id, session_id, query, timestamp, token_cost, access_order)
        VALUES (@neuron_id, @session_id, @query, @now, @token_cost, @access_order)
      `),
      createSession: this.db.prepare(`INSERT OR IGNORE INTO sessions (id, started_at) VALUES (@id, @now)`),
      updateSession: this.db.prepare(`
        UPDATE sessions SET total_accesses = total_accesses + 1, tokens_used = tokens_used + @tokens_used WHERE id = @id
      `),
      searchByContext: this.db.prepare(`
        SELECT * FROM neurons WHERE contexts LIKE @pattern ORDER BY myelination DESC LIMIT @limit
      `),
      topByMyelination: this.db.prepare(`
        SELECT * FROM neurons WHERE type = COALESCE(@type, type) ORDER BY myelination DESC LIMIT @limit
      `),
      stats: this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM neurons) as neuron_count,
          (SELECT COUNT(*) FROM synapses) as synapse_count,
          (SELECT COUNT(*) FROM neurons WHERE myelination > 0.5) as superhighways,
          (SELECT COUNT(*) FROM access_log) as total_accesses,
          (SELECT AVG(myelination) FROM neurons) as avg_myelination
      `),
      decayAll: this.db.prepare(`UPDATE neurons SET activation = activation * ${1 - ACTIVATION_DECAY_RATE}, myelination = myelination * ${1 - MYELIN_DECAY_RATE}`),
      decaySynapses: this.db.prepare(`UPDATE synapses SET weight = weight * ${1 - SYNAPSE_DECAY_RATE}`),
      pruneSynapses: this.db.prepare(`DELETE FROM synapses WHERE weight < ${SYNAPSE_PRUNE_THRESHOLD}`),
      pruneNeurons: this.db.prepare(`DELETE FROM neurons WHERE activation < 0.01 AND myelination < 0.01 AND access_count < 2`),
    };
  }

  // --- Record a file/tool access (Hebbian learning) ---

  record(path: string, type: Neuron["type"] = "file", query?: string): void {
    this.ensureOpen();
    const now = new Date().toISOString();
    const id = `${type}:${path}`;

    const existing = this.stmts.getNeuron.get(id) as Neuron | undefined;
    const contexts: string[] = existing?.contexts
      ? (typeof existing.contexts === "string" ? JSON.parse(existing.contexts) : existing.contexts)
      : [];
    if (query && !contexts.includes(query)) {
      contexts.push(query);
      if (contexts.length > 20) contexts.shift();
    }

    this.stmts.upsertNeuron.run({
      id, type, path,
      activation: 1.0,
      myelination: existing ? existing.myelination : 0,
      now,
      contexts: JSON.stringify(contexts),
    });

    this.accessOrder++;
    this.stmts.logAccess.run({
      neuron_id: id, session_id: this.sessionId,
      query: query || null, now,
      token_cost: type === "file" ? 1500 : 500,
      access_order: this.accessOrder,
    });

    // Hebbian: strengthen synapses with recent co-accesses
    for (let i = 0; i < this.recentAccesses.length; i++) {
      const recentId = this.recentAccesses[i];
      if (recentId === id) continue;
      const positionFactor = (i + 1) / this.recentAccesses.length;
      const delta = LEARNING_RATE * positionFactor;
      this.stmts.upsertSynapse.run({ source: id, target: recentId, weight: delta, delta, now });
      this.stmts.upsertSynapse.run({ source: recentId, target: id, weight: delta, delta, now });
    }

    // Track in window
    const idx = this.recentAccesses.indexOf(id);
    if (idx !== -1) this.recentAccesses.splice(idx, 1);
    this.recentAccesses.push(id);
    if (this.recentAccesses.length > CO_ACCESS_WINDOW_SIZE) this.recentAccesses.shift();

    this.stmts.updateSession.run({ id: this.sessionId, tokens_used: type === "file" ? 1500 : 500 });
  }

  // --- Record a semantic memory (fact, preference, decision) ---

  recordSemantic(text: string, context?: string): void {
    this.ensureOpen();
    this.record(text, "semantic", context);
  }

  // --- Recall: spreading activation ---

  recall(query: string, type: Neuron["type"] = "file", limit = 5): RecallResult[] {
    this.ensureOpen();
    const results: RecallResult[] = [];
    const activated = new Set<string>();

    // Phase 1: Direct context keyword match
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const directMatches: Neuron[] = [];
    for (const kw of keywords) {
      const matches = this.stmts.searchByContext.all({ pattern: `%${kw}%`, limit: 10 }) as Neuron[];
      for (const m of matches) {
        if (!directMatches.find(d => d.id === m.id)) directMatches.push(m);
      }
    }

    for (const neuron of directMatches) {
      if (type && neuron.type !== type) continue;
      const confidence = this.computeConfidence(neuron, query);
      if (confidence < CONFIDENCE_GATE) continue;
      activated.add(neuron.id);
      results.push({ neuron: this.parseNeuron(neuron), confidence, activation_path: "direct" });
    }

    // Phase 2: Spreading activation (1 hop)
    const frontier = [...results];
    for (const seed of frontier) {
      const synapses = (this.stmts.getSynapses.all(seed.neuron.id) as any[]).slice(0, 10);
      for (const syn of synapses) {
        if (syn.weight < 0.3 || activated.has(syn.target_id)) continue;
        const target = this.stmts.getNeuron.get(syn.target_id) as Neuron | undefined;
        if (!target || (type && target.type !== type)) continue;
        const spreadConf = seed.confidence * syn.weight * (1 + target.myelination);
        if (spreadConf < CONFIDENCE_GATE) continue;
        activated.add(syn.target_id);
        results.push({ neuron: this.parseNeuron(target), confidence: Math.min(spreadConf, 0.99), activation_path: "spread" });
      }
    }

    // Phase 3: Myelinated fallback — superhighways get lower gate
    if (results.length < limit) {
      const MYELIN_GATE = 0.15; // Lower gate: superhighways earned trust through repeated use
      const top = this.stmts.topByMyelination.all({ type: type || null, limit: limit - results.length }) as Neuron[];
      for (const n of top) {
        if (activated.has(n.id)) continue;
        const conf = n.myelination * 0.5;
        if (conf < MYELIN_GATE) continue;
        results.push({ neuron: this.parseNeuron(n), confidence: conf, activation_path: "myelinated" });
      }
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return results.slice(0, limit);
  }

  private computeConfidence(neuron: Neuron, query: string): number {
    let score = 0;
    const contexts = typeof neuron.contexts === "string" ? JSON.parse(neuron.contexts) as string[] : neuron.contexts;
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const contextStr = contexts.join(" ").toLowerCase();
    const matchCount = keywords.filter(k => contextStr.includes(k)).length;
    score += (keywords.length > 0 ? matchCount / keywords.length : 0) * 0.4;
    score += neuron.myelination * 0.3;
    if (neuron.last_accessed) {
      const ageMs = Date.now() - new Date(neuron.last_accessed).getTime();
      score += Math.max(0, 1 - ageMs / (168 * 3_600_000)) * 0.2;
    }
    const pathLower = neuron.path.toLowerCase();
    const pathMatches = keywords.filter(k => pathLower.includes(k)).length;
    score += (keywords.length > 0 ? pathMatches / keywords.length : 0) * 0.1;
    return Math.min(score, 1.0);
  }

  // --- Decay ---

  decay(): { pruned_synapses: number; pruned_neurons: number } {
    this.ensureOpen();
    this.stmts.decayAll.run();
    this.stmts.decaySynapses.run();
    const syn = this.stmts.pruneSynapses.run();
    const neu = this.stmts.pruneNeurons.run();
    return { pruned_synapses: syn.changes, pruned_neurons: neu.changes };
  }

  // --- Stats ---

  stats(): BrainBoxStats {
    this.ensureOpen();
    return this.stmts.stats.get() as BrainBoxStats;
  }

  // --- Ensure DB is open (reconnect if closed) ---

  private ensureOpen(): void {
    if (!this.db.open) {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
      this.stmts = this.prepareStatements();
    }
  }

  // --- Cleanup ---

  close(): void {
    try { if (this.db.open) this.db.close(); } catch {}
  }

  private parseNeuron(n: Neuron): Neuron {
    return { ...n, contexts: typeof n.contexts === "string" ? JSON.parse(n.contexts) : n.contexts };
  }
}
