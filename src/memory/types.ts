/**
 * Memory types for tele-kb-bot.
 *
 * TypeScript interfaces for the memory system.
 *
 * @module
 */

/** A single scratchpad checklist item */
export interface ScratchpadItem {
  text: string;
  done: boolean;
}

/** Search result from BM25 */
export interface SearchResult {
  filePath: string;
  score: number;
  snippet: string;
}

/** Options for context injection */
export interface ContextInjectionOptions {
  /** User's current prompt for BM25 search */
  userPrompt?: string;
  /** Max total chars for context injection (default: 16000) */
  maxTotalChars?: number;
}

/** Sections that can be injected */
export interface ContextSections {
  scratchpad?: string;
  todayLog?: string;
  searchResults?: string;
  longTermMemory?: string;
  yesterdayLog?: string;
}

/** Memory file names */
export const MEMORY_FILES = {
  MEMORY: "MEMORY.md",
  SCRATCHPAD: "SCRATCHPAD.md",
  DAILY_PREFIX: "", // YYYY-MM-DD.md
} as const;
