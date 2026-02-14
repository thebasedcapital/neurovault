/**
 * NeuroVault Utilities
 *
 * Path extraction from tool calls, sanitization, capture filtering.
 */

// --- Skip patterns (noise files) ---

const SKIP_PATTERNS = [
  /node_modules\//,
  /\.git\//,
  /\.DS_Store/,
  /\.swp$/,
  /\.tmp$/,
  /~$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /bun\.lock$/,
];

export function shouldSkipPath(path: string): boolean {
  return SKIP_PATTERNS.some(p => p.test(path));
}

// --- Extract file paths from tool calls ---

/**
 * Extract file paths from tool call parameters.
 * Handles Read, Write, Edit, Grep, Glob, and Bash tools.
 */
export function extractFilePaths(toolName: string, params: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const tool = toolName.toLowerCase();

  switch (tool) {
    case "read":
    case "write":
    case "edit":
      // Claude Code uses file_path, OpenClaw uses path
      if (typeof params.file_path === "string") paths.push(params.file_path);
      if (typeof params.path === "string") paths.push(params.path);
      break;

    case "grep":
    case "glob":
      if (typeof params.path === "string") paths.push(params.path);
      break;

    case "bash":
    case "exec": {
      // Try to extract file paths from common commands
      const cmd = typeof params.command === "string" ? params.command : "";
      const fileRefs = extractPathsFromCommand(cmd);
      paths.push(...fileRefs);
      break;
    }
  }

  return paths.filter(p => p && !shouldSkipPath(p));
}

/**
 * Extract file paths from tool call results (output text).
 * Used for Grep/Glob which return file lists.
 */
export function extractFilePathsFromResult(toolName: string, resultText: string): string[] {
  if (!resultText) return [];

  const tool = toolName.toLowerCase();
  if (tool === "grep" || tool === "glob") {
    // Results are typically one file path per line
    return resultText
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("/") && !shouldSkipPath(line))
      .slice(0, 20); // Cap at 20 to avoid noise
  }

  if (tool === "exec") {
    // exec results may contain file paths in output (from cat, ls, find, etc.)
    const matches = resultText.match(/(?:^|\s)(\/[\w./-]+)/gm);
    if (matches) {
      return matches
        .map(m => m.trim())
        .filter(p => p.startsWith("/") && !shouldSkipPath(p) && !p.startsWith("/dev/") && !p.startsWith("/proc/"))
        .slice(0, 10);
    }
  }

  return [];
}

function extractPathsFromCommand(cmd: string): string[] {
  // Match absolute file paths in common commands
  const matches = cmd.match(/(?:^|\s)(\/[^\s;|&>]+)/g);
  if (!matches) return [];
  return matches
    .map(m => m.trim())
    .filter(p => p.includes("/") && !p.startsWith("/dev/") && !p.startsWith("/proc/"));
}

// --- Extract query context from tool params ---

export function extractToolContext(toolName: string, params: Record<string, unknown>): string {
  const tool = toolName.toLowerCase();
  switch (tool) {
    case "grep":
      return `grep:${params.pattern || ""}`;
    case "glob":
      return `glob:${params.pattern || ""}`;
    case "edit":
      return `edit:${String(params.old_string || "").slice(0, 80)}`;
    case "read":
      return `read:${params.file_path || params.path || ""}`;
    case "write":
      return `write:${params.file_path || params.path || ""}`;
    case "bash":
    case "exec":
      return `bash:${String(params.command || "").slice(0, 80)}`;
    default:
      return toolName;
  }
}

// --- Extract rich keywords from tool results for better recall ---

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "are", "was", "were",
  "been", "have", "has", "had", "not", "but", "can", "will", "all", "its",
  "you", "your", "which", "when", "what", "how", "each", "into", "more",
  "also", "than", "then", "them", "they", "just", "only", "some", "any",
  "use", "used", "uses", "using", "file", "line", "code", "true", "false",
  "null", "undefined", "return", "const", "let", "var", "function", "import",
  "export", "default", "type", "string", "number", "boolean", "void", "new",
]);

/**
 * Extract meaningful keywords from tool result text.
 * These get stored as neuron contexts for better Phase 1 keyword matching.
 */
export function extractResultKeywords(resultText: string, maxKeywords = 8): string[] {
  if (!resultText || resultText.length < 20) return [];

  // Extract identifiers: camelCase, PascalCase, UPPER_CASE, snake_case
  const identifiers = resultText.match(/\b[A-Z_][A-Z_0-9]{2,}\b|\b[a-z][a-zA-Z0-9]{3,}\b/g) || [];

  // Count frequency, filter stop words
  const freq = new Map<string, number>();
  for (const id of identifiers) {
    const lower = id.toLowerCase();
    if (STOP_WORDS.has(lower) || lower.length < 4) continue;
    freq.set(lower, (freq.get(lower) || 0) + 1);
  }

  // Return top keywords by frequency
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

// --- Error detection from tool results ---

const ERROR_PATTERNS = [
  /Error:\s+(.{10,80})/,
  /ENOENT:\s+(.{10,80})/,
  /EACCES:\s+(.{10,80})/,
  /command not found:\s*(\S+)/,
  /Cannot find module\s+'([^']+)'/,
  /SyntaxError:\s+(.{10,80})/,
  /TypeError:\s+(.{10,80})/,
  /FATAL:\s+(.{10,80})/,
];

/**
 * Detect error signatures in tool output text.
 * Returns a normalized error string or null if no error found.
 */
export function detectError(resultText: string): string | null {
  if (!resultText || resultText.length < 10) return null;
  for (const pat of ERROR_PATTERNS) {
    const m = resultText.match(pat);
    if (m) return m[0].slice(0, 100);
  }
  return null;
}

// --- Capture filtering (facts, preferences, decisions from conversations) ---

const MEMORY_TRIGGERS = [
  /remember/i,
  /prefer|i like|i hate|i love|i want|i need/i,
  /always|never|important/i,
  /my\s+\w+\s+is|is\s+my/i,
  /decided|will use|we should/i,
  /\+\d{10,}/, // Phone numbers
  /[\w.-]+@[\w.-]+\.\w+/, // Email addresses
];

export function shouldCapture(text: string): boolean {
  if (text.length < 10 || text.length > 500) return false;
  if (text.includes("<neurovault-context>")) return false;
  if (text.startsWith("<") && text.includes("</")) return false;
  if (text.includes("**") && text.includes("\n-")) return false;
  const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > 3) return false;
  return MEMORY_TRIGGERS.some(r => r.test(text));
}

export function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/prefer|like|love|hate|want/i.test(lower)) return "preference";
  if (/decided|will use/i.test(lower)) return "decision";
  if (/\+\d{10,}|@[\w.-]+\.\w+|is called/i.test(lower)) return "entity";
  if (/is|are|has|have/i.test(lower)) return "fact";
  return "other";
}

// --- Sanitization ---

export function sanitizePrompt(str: string): string {
  if (typeof str !== "string") return "";
  return str.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}
