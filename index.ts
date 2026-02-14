/**
 * NeuroVault — OpenClaw Memory Plugin
 *
 * Unified memory: VaultGraph (knowledge graph) + BrainBox (Hebbian learning).
 * Replaces the built-in memory system with graph-based spreading activation
 * and procedural memory that learns from every tool call.
 *
 * Hooks:
 *   - before_agent_start: inject relevant context (VaultGraph + BrainBox recall)
 *   - after_tool_call: learn from file access patterns (Hebbian recording)
 *   - agent_end: capture facts/preferences from conversations
 *
 * Tools:
 *   - neurovault_recall: manually query memory
 *   - neurovault_stats: show memory statistics
 *
 * Zero API keys required. Fully local. No network calls.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { BrainBoxDB } from "./src/brainbox-db.js";
import { isVaultGraphAvailable, recallVaultGraph } from "./src/vaultgraph.js";
import {
  extractFilePaths,
  extractFilePathsFromResult,
  extractToolContext,
  extractResultKeywords,
  detectError,
  shouldCapture,
  detectCategory,
  sanitizePrompt,
} from "./src/utils.js";

// --- Config defaults ---

const DEFAULTS = {
  vaultPath: `${process.env.HOME}/.openclaw/memory`,
  bbDbPath: `${process.env.HOME}/.openclaw/neurovault/brainbox.db`,
  vgBudget: 3000,
  autoRecall: true,
  autoCapture: true,
};

// --- File-access tool names ---

// Claude Code uses PascalCase, OpenClaw embedded agent uses lowercase
const FILE_TOOLS = new Set([
  "Read", "Write", "Edit", "Grep", "Glob", "Bash",   // Claude Code
  "read", "write", "edit", "grep", "glob", "exec",    // OpenClaw embedded
]);

// --- Plugin ---

const neurovaultPlugin = {
  id: "neurovault",
  name: "NeuroVault Memory",
  description: "VaultGraph (knowledge graph) + BrainBox (Hebbian learning) — fully local, zero API keys",
  kind: "memory" as const,

  register(api: OpenClawPluginApi) {
    const cfg = {
      vaultPath: (api.pluginConfig as any)?.vaultPath || DEFAULTS.vaultPath,
      bbDbPath: (api.pluginConfig as any)?.bbDbPath || DEFAULTS.bbDbPath,
      vgBudget: (api.pluginConfig as any)?.vgBudget || DEFAULTS.vgBudget,
      autoRecall: (api.pluginConfig as any)?.autoRecall ?? DEFAULTS.autoRecall,
      autoCapture: (api.pluginConfig as any)?.autoCapture ?? DEFAULTS.autoCapture,
    };

    const resolvedDbPath = api.resolvePath(cfg.bbDbPath);
    const resolvedVaultPath = api.resolvePath(cfg.vaultPath);

    let db: BrainBoxDB;
    try {
      db = new BrainBoxDB(resolvedDbPath);
    } catch (err) {
      api.logger.error(`neurovault: failed to open BrainBox DB: ${err}`);
      return;
    }

    const hasVG = isVaultGraphAvailable();
    const caps = [hasVG ? "VaultGraph" : null, "BrainBox"].filter(Boolean).join(" + ");
    api.logger.info(`neurovault: ready with ${caps} (db: ${resolvedDbPath})`);

    // ====================================================================
    // Tools
    // ====================================================================

    api.registerTool(
      {
        name: "neurovault_recall",
        label: "NeuroVault Recall",
        description: "Search through neural memory. Finds files, tools, and facts related to your query using Hebbian recall and knowledge graph spreading activation.",
        parameters: Type.Object({
          query: Type.String({ description: "What are you looking for?" }),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
        }),
        async execute(_toolCallId, params) {
          const { query, limit = 5 } = params as { query: string; limit?: number };
          const results = db.recall(query, "file", limit);

          if (results.length === 0) {
            return {
              content: [{ type: "text", text: "No relevant memories found." }],
              details: { count: 0 },
            };
          }

          const lines = results.map((r, i) => {
            const pct = Math.round(r.confidence * 100);
            const myelin = Math.round(r.neuron.myelination * 100);
            return `${i + 1}. ${r.neuron.path} (${pct}% confidence, ${myelin}% myelin, via ${r.activation_path})`;
          });

          return {
            content: [{ type: "text", text: `Found ${results.length} neural matches:\n\n${lines.join("\n")}` }],
            details: { count: results.length, results: results.map(r => ({ path: r.neuron.path, confidence: r.confidence })) },
          };
        },
      },
      { name: "neurovault_recall" },
    );

    api.registerTool(
      {
        name: "neurovault_stats",
        label: "NeuroVault Stats",
        description: "Show memory statistics: neurons, synapses, superhighways, and learning progress.",
        parameters: Type.Object({}),
        async execute() {
          const s = db.stats();
          const text = [
            `Neurons: ${s.neuron_count}`,
            `Synapses: ${s.synapse_count}`,
            `Superhighways (>50% myelin): ${s.superhighways}`,
            `Total accesses recorded: ${s.total_accesses}`,
            `Avg myelination: ${(s.avg_myelination * 100).toFixed(1)}%`,
            `VaultGraph: ${hasVG ? "available" : "not installed"}`,
            `Vault path: ${resolvedVaultPath}`,
            `DB path: ${resolvedDbPath}`,
          ].join("\n");

          return {
            content: [{ type: "text", text }],
            details: s,
          };
        },
      },
      { name: "neurovault_stats" },
    );

    // ====================================================================
    // Lifecycle Hooks
    // ====================================================================

    // --- Auto-Recall: inject context before agent starts ---

    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event) => {
        const prompt = event.prompt;
        if (!prompt || prompt.length < 5) return;

        const sanitized = sanitizePrompt(prompt);
        const parts: string[] = [];

        // VaultGraph: knowledge graph context
        if (hasVG) {
          try {
            const vgResult = await recallVaultGraph(sanitized, resolvedVaultPath, cfg.vgBudget);
            if (vgResult) parts.push(vgResult);
          } catch (err) {
            api.logger.warn(`neurovault: VaultGraph recall failed: ${err}`);
          }
        }

        // BrainBox: Hebbian recall of co-accessed files
        try {
          const bbResults = db.recall(sanitized, "file", 5);
          if (bbResults.length > 0) {
            const lines = bbResults.map(r => {
              const pct = Math.round(r.confidence * 100);
              return `  - ${r.neuron.path} (${pct}% match)`;
            });
            parts.push(`[brainbox] Relevant files from past sessions:\n${lines.join("\n")}`);
          }
        } catch (err) {
          api.logger.warn(`neurovault: BrainBox recall failed: ${err}`);
        }

        // BrainBox: semantic memories (facts, preferences)
        try {
          const semanticResults = db.recall(sanitized, "semantic", 3);
          if (semanticResults.length > 0) {
            const lines = semanticResults.map(r => `  - ${r.neuron.path}`);
            parts.push(`[brainbox] Remembered context:\n${lines.join("\n")}`);
          }
        } catch {}

        if (parts.length === 0) return;

        const combined = parts.join("\n\n");
        api.logger.info(`neurovault: injecting context (${combined.length} chars): ${combined.slice(0, 200)}`);

        return {
          prependContext: `<neurovault-context>\n${combined}\n</neurovault-context>`,
        };
      });
    }

    // --- Auto-Learn: record file access from every tool call ---

    if (cfg.autoCapture) {
      api.on("after_tool_call", async (event) => {
        try {
          const toolName = event.toolName;
          api.logger.debug?.(`neurovault: after_tool_call tool=${toolName} matched=${FILE_TOOLS.has(toolName)}`);
          if (!FILE_TOOLS.has(toolName)) return;

          const params = (event.params || {}) as Record<string, unknown>;
          const context = extractToolContext(toolName, params);

          // Extract paths from params
          const paramPaths = extractFilePaths(toolName, params);

          // Extract paths from results (for Grep/Glob)
          // event.result can be string, object with .content[].text, or other shapes
          let resultText = "";
          if (typeof event.result === "string") {
            resultText = event.result;
          } else if (event.result && typeof event.result === "object") {
            const r = event.result as Record<string, unknown>;
            if (typeof r.text === "string") {
              resultText = r.text;
            } else if (Array.isArray(r.content)) {
              resultText = (r.content as any[])
                .filter(b => b && typeof b.text === "string")
                .map(b => b.text)
                .join("\n");
            } else {
              // Last resort: stringify
              try { resultText = JSON.stringify(r).slice(0, 2000); } catch {}
            }
          }
          const resultPaths = extractFilePathsFromResult(toolName, resultText);

          const allPaths = [...new Set([...paramPaths, ...resultPaths])];

          // Extract keywords from result text for richer context matching
          const resultType = typeof event.result;
          const resultLen = resultText.length;
          const keywords = extractResultKeywords(resultText);
          api.logger.debug?.(`neurovault: result type=${resultType} len=${resultLen} keywords=[${keywords.join(",")}]`);
          const richContext = keywords.length > 0
            ? `${context} keywords:${keywords.join(",")}`
            : context;

          for (const path of allPaths) {
            db.record(path, "file", richContext);
          }

          // Also record tool usage
          db.record(toolName, "tool", richContext);

          // Detect errors in exec/Bash output
          const tool = toolName.toLowerCase();
          if ((tool === "exec" || tool === "bash") && resultText) {
            const error = detectError(resultText);
            if (error) {
              db.record(error, "error", richContext);
            }
          }

          if (allPaths.length > 0) {
            api.logger.debug?.(`neurovault: learned ${allPaths.length} paths from ${toolName}`);
          }
        } catch (err) {
          api.logger.warn?.(`neurovault: learning failed: ${err}`);
        }
      });

      // --- Auto-Capture: extract facts from conversations ---

      api.on("agent_end", async (event) => {
        try {
          if (!event.success || !event.messages || event.messages.length === 0) return;

          const texts: string[] = [];
          for (const msg of event.messages) {
            if (!msg || typeof msg !== "object") continue;
            const msgObj = msg as Record<string, unknown>;
            const role = msgObj.role;
            if (role !== "user" && role !== "assistant") continue;

            const content = msgObj.content;
            if (typeof content === "string") { texts.push(content); continue; }
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block && typeof block === "object" && "type" in block && (block as any).type === "text" && typeof (block as any).text === "string") {
                  texts.push((block as any).text);
                }
              }
            }
          }

          const toCapture = texts.filter(t => t && shouldCapture(t));
          let stored = 0;
          for (const text of toCapture.slice(0, 3)) {
            const category = detectCategory(text);
            db.recordSemantic(text, category);
            stored++;
          }

          if (stored > 0) {
            api.logger.info(`neurovault: captured ${stored} memories`);
          }
        } catch (err) {
          api.logger.warn?.(`neurovault: capture failed: ${err}`);
        }
      });
    }

    // ====================================================================
    // Service
    // ====================================================================

    api.registerService({
      id: "neurovault",
      start: () => {
        api.logger.info(`neurovault: service started (${caps})`);
      },
      stop: () => {
        try { db.close(); } catch {}
        api.logger.info("neurovault: service stopped");
      },
    });
  },
};

export default neurovaultPlugin;
