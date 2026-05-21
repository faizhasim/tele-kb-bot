/**
 * qmd memory backend — persistent, on-disk search index.
 *
 * Uses the qmd CLI (https://github.com/tobi/qmd) for semantic/vector search.
 * Index survives process restarts. Falls back to BM25 if qmd binary not found.
 *
 * @module
 */

import type { MemoryBackend } from './interface';
import { detect, query as qmdQuery } from './qmd';
import type { SearchResult } from './types';

class QmdMemoryBackend implements MemoryBackend {
  private _available = false;

  isAvailable(): boolean {
    return this._available;
  }

  async rebuildIndex(): Promise<void> {
    // qmd auto-indexes based on working directory.
    // We just check if the binary is available.
    this._available = detect();
  }

  async search(query: string, maxResults = 5): Promise<ReadonlyArray<SearchResult>> {
    if (!this._available) return [];

    const results = qmdQuery(query, maxResults);
    if (results === null) return [];

    return results.map((r) => ({
      filePath: r.filePath,
      score: r.score,
      snippet: r.snippet,
    }));
  }
}

export { QmdMemoryBackend };
