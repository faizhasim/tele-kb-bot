/**
 * qmd memory backend — persistent, on-disk search index.
 *
 * Uses the qmd CLI (https://github.com/tobi/qmd) for semantic/vector search.
 * Index survives process restarts. Falls back to BM25 if qmd binary not found.
 *
 * @module
 */

import type { MemoryBackend } from './interface';
import { configure as configureQmd, detect, query as qmdQuery, run } from './qmd';
import type { SearchResult } from './types';

// ─── Factory ─────────────────────────────────────────────────────────

const createQmdMemoryBackend = (binaryPath: string, vaultDirectories: ReadonlyArray<string> = []): MemoryBackend => {
  // Apply the configured binary path so detect() and run() use it
  configureQmd(binaryPath);

  let available = false;

  const backend: MemoryBackend = {
    isAvailable: () => available,

    rebuildIndex: async () => {
      available = detect();
      if (!available) return;

      // Add/update each vault directory as a qmd collection, then update index
      for (const vaultDir of vaultDirectories) {
        run(['collection', 'add', vaultDir], 30_000);
      }
      run(['update'], 120_000);
    },

    search: async (query: string, maxResults = 5): Promise<ReadonlyArray<SearchResult>> => {
      if (!available) return [];

      const results = qmdQuery(query, maxResults);
      if (results === null) return [];

      return results.map((r) => ({
        filePath: r.filePath,
        score: r.score,
        snippet: r.snippet,
      }));
    },
  };

  return backend;
};

export { createQmdMemoryBackend };
