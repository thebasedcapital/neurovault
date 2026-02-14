/**
 * VaultGraph Subprocess Wrapper
 *
 * Queries the VaultGraph binary for knowledge graph context.
 * Uses JSON output to get file list, then reads file content.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const VAULTGRAPH_PATHS = [
  "/opt/homebrew/bin/vaultgraph",
  "/usr/local/bin/vaultgraph",
  "/usr/bin/vaultgraph",
];

let _binaryPath: string | null | undefined;

function findBinary(): string | null {
  if (_binaryPath !== undefined) return _binaryPath;
  for (const p of VAULTGRAPH_PATHS) {
    if (existsSync(p)) { _binaryPath = p; return p; }
  }
  // Try PATH
  try {
    const { stdout } = require("node:child_process").execFileSync("which", ["vaultgraph"], { timeout: 2000, encoding: "utf-8" });
    const path = stdout.trim();
    if (path) { _binaryPath = path; return path; }
  } catch {}
  _binaryPath = null;
  return null;
}

export function isVaultGraphAvailable(): boolean {
  return findBinary() !== null;
}

interface VaultGraphResult {
  selected: Array<{
    file: string;
    score: number;
    reason: string;
    estimated_tokens: number;
  }>;
  total_tokens: number;
}

/**
 * Query VaultGraph for relevant context using spreading activation.
 * Returns the actual file content, not just the file list.
 *
 * @param prompt - User's query/task description
 * @param vaultPath - Path to markdown vault
 * @param budget - Token budget for context
 * @returns Formatted context string with file contents, or null
 */
export async function recallVaultGraph(
  prompt: string,
  vaultPath: string,
  budget = 3000,
): Promise<string | null> {
  const binary = findBinary();
  if (!binary) return null;

  try {
    // Get JSON list of relevant files
    const { stdout } = await execFileAsync(binary, [
      "--format", "json",
      "--vault", vaultPath,
      "context",
      "--budget", String(budget),
      prompt.slice(0, 500),
    ], { timeout: 5000 });

    // Parse JSON — strip trailing "Indexed N files..." line
    const text = stdout.trim();
    const lastBrace = text.lastIndexOf("}");
    if (lastBrace === -1) return null;
    const jsonStr = text.slice(0, lastBrace + 1);

    const result: VaultGraphResult = JSON.parse(jsonStr);
    if (!result.selected || result.selected.length === 0) return null;

    // Read each selected file and build context
    const parts: string[] = [];
    for (const entry of result.selected) {
      const filePath = join(vaultPath, entry.file.endsWith(".md") ? entry.file : `${entry.file}.md`);
      try {
        const content = readFileSync(filePath, "utf-8");
        const pct = Math.round(entry.score * 100);
        parts.push(`[${entry.file}] (${pct}% match, ${entry.reason}):\n${content.trim()}`);
      } catch {
        // File not readable, skip
      }
    }

    if (parts.length === 0) return null;
    return `[vaultgraph] Knowledge graph context:\n\n${parts.join("\n\n---\n\n")}`;
  } catch {
    return null;
  }
}
