/**
 * Memory backend interface for tele-kb-bot.
 *
 * Common interface for BM25 (ephemeral) and qmd (persistent) backends.
 *
 * @module
 */

import type { SearchResult } from './types';

/**
 * Unified memory backend interface.
 * Both ephemeral (BM25) and persistent (qmd) backends implement this.
 */
interface MemoryBackend {
  /** Search the memory index for relevant results. */
  search(query: string, maxResults?: number): Promise<ReadonlyArray<SearchResult>>;
  /** Rebuild the search index from memory files. */
  rebuildIndex(): Promise<void>;
  /** Check if the backend is available and healthy. */
  isAvailable(): boolean;
}

/**
 * Context object passed around the application for memory operations.
 * Contains the backend and its LRU cache configuration.
 */
interface MemoryContext {
  readonly backend: MemoryBackend;
  readonly configDir: string;
  readonly maxEntries: number;
  readonly maxSizeBytes: number;
}

export type { MemoryBackend, MemoryContext };
