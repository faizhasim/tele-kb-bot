/**
 * qmd integration for tele-kb-bot.
 *
 * qmd (https://github.com/tobi/qmd) is a local markdown search engine supporting
 * BM25, vector semantic search, and hybrid search with LLM reranking.
 *
 * Integration strategy (informed by pi-memory):
 * - Detect qmd binary in PATH at startup
 * - Index memory directory as a qmd collection
 * - Route search calls to qmd CLI based on configured mode
 * - Graceful degradation: if qmd not found, caller falls back to built-in BM25
 *
 * @module
 */

import { execFileSync } from "node:child_process";

let _available: boolean | null = null;
let _binaryPath: string = "qmd";

const configure = (binaryPath: string): void => {
  _binaryPath = binaryPath;
  _available = null; // re-detect with new path
};

const detect = (): boolean => {
  if (_available !== null) return _available;
  try {
    execFileSync("command", ["-v", _binaryPath], { stdio: "ignore" });
    _available = true;
  } catch {
    _available = false;
  }
  return _available;
};

const reset = (): void => {
  _available = null;
};

const run = (args: Array<string>, timeout = 30_000): string | null => {
  if (!detect()) return null;
  try {
    return execFileSync(_binaryPath, args, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout,
    });
  } catch {
    return null;
  }
};

interface QmdResult {
  readonly filePath: string;
  readonly score: number;
  readonly snippet: string;
}

const parseOutput = (raw: string): Array<QmdResult> => {
  try {
    const parsed = JSON.parse(raw);
    const items: Array<Record<string, unknown>> = Array.isArray(parsed)
      ? parsed
      : (((parsed as Record<string, unknown>).results as Array<Record<string, unknown>>) ?? []);
    return items.map((i) => ({
      filePath: String(i.path ?? i.file ?? i.filePath ?? ""),
      score: Number(i.score ?? i.relevance ?? 0),
      snippet: String(i.snippet ?? i.content ?? i.text ?? "").slice(0, 200),
    }));
  } catch {
    return [];
  }
};

const search = (q: string, maxResults = 5): Array<QmdResult> | null => {
  const out = run(["search", q, "--json", "--limit", String(maxResults)]);
  return out ? parseOutput(out) : null;
};

const vsearch = (q: string, maxResults = 5): Array<QmdResult> | null => {
  const out = run(["vsearch", q, "--json", "--limit", String(maxResults)], 60_000);
  return out ? parseOutput(out) : null;
};

const query = (q: string, maxResults = 5): Array<QmdResult> | null => {
  const out = run(["query", q, "--json", "--limit", String(maxResults)], 60_000);
  return out ? parseOutput(out) : null;
};

export type { QmdResult };
export { configure, detect, query, reset, run, search, vsearch };
