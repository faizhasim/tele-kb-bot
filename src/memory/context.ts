/**
 * Context builder for tele-kb-bot.
 *
 * Builds a system prompt context string from memory files.
 * All functions are pure — no IO.
 *
 * @module
 */

import type { SearchResult } from "./types";

// ─── Limits ─────────────────────────────────────────────────────────

const MAX_TOTAL = 16_000;
const LIMIT_SCRATCHPAD = 2_000;
const LIMIT_TODAY_LOG = 3_000;
const LIMIT_SEARCH = 2_500;
const LIMIT_MEMORY = 4_000;
const LIMIT_YESTERDAY_LOG = 3_000;

// ─── Helpers ────────────────────────────────────────────────────────

const tail = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `…${text.slice(-maxChars + 1)}`;
};

const middleTruncate = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
};

// ─── Section Builders ───────────────────────────────────────────────

const buildScratchpadSection = (content?: string): string | undefined => {
  if (!content) return undefined;
  const truncated = tail(content, LIMIT_SCRATCHPAD);
  return `### SCRATCHPAD.md (working context)\n${truncated}`;
};

const buildDailySection = (label: string, content?: string, limit = LIMIT_TODAY_LOG): string | undefined => {
  if (!content) return undefined;
  return `### ${label}\n${tail(content, limit)}`;
};

const buildSearchSection = (results: ReadonlyArray<SearchResult>): string | undefined => {
  if (results.length === 0) return undefined;
  const lines = results.map((r) => `- **${r.filePath}** (score: ${r.score}): ${r.snippet}`);
  const joined = lines.join("\n");
  if (joined.length > LIMIT_SEARCH) {
    return `### Relevant memories\n${joined.slice(0, LIMIT_SEARCH)}`;
  }
  return `### Relevant memories\n${joined}`;
};

const buildMemorySection = (content?: string): string | undefined => {
  if (!content) return undefined;
  return `### MEMORY.md (long-term)\n${middleTruncate(content, LIMIT_MEMORY)}`;
};

// ─── Main Builder ───────────────────────────────────────────────────

interface ContextInput {
  readonly scratchpad?: string;
  readonly todayLog?: string;
  readonly yesterdayLog?: string;
  readonly searchResults?: ReadonlyArray<SearchResult>;
  readonly longTermMemory?: string;
}

/**
 * Build the full memory context injection string.
 * All sections are additive. Total capped at MAX_TOTAL chars.
 * Order: scratchpad → today log → search → long-term → yesterday log
 */
const buildMemoryContext = (input: ContextInput): string => {
  const sections: Array<string> = [];
  let total = 0;

  const add = (text: string | undefined): void => {
    if (!text) return;
    const remaining = MAX_TOTAL - total;
    if (remaining <= 0) return;
    const clipped = text.length > remaining ? `${text.slice(0, remaining)}…` : text;
    sections.push(clipped);
    total += clipped.length;
  };

  add(buildScratchpadSection(input.scratchpad));
  add(buildDailySection("Daily log (today)", input.todayLog, LIMIT_TODAY_LOG));
  add(buildSearchSection(input.searchResults ?? []));
  add(buildMemorySection(input.longTermMemory));
  add(buildDailySection("Daily log (yesterday)", input.yesterdayLog, LIMIT_YESTERDAY_LOG));

  return sections.join("\n\n");
};

export type { ContextInput };
export { buildMemoryContext };
