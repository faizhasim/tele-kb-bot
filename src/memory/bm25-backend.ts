/**
 * BM25 memory backend — ephemeral, in-memory search.
 *
 * Rebuilds the BM25 index from memory files on each startup.
 * All data is lost on process restart (hence "ephemeral").
 *
 * @module
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryBackend } from './interface';
import { indexDocuments, search } from './search';
import type { SearchResult } from './types';

class BM25MemoryBackend implements MemoryBackend {
  private _indexState: ReturnType<typeof indexDocuments> | null = null;
  private _available = false;
  private readonly _memoryDir: string;

  constructor(memoryDir: string) {
    this._memoryDir = memoryDir;
  }

  isAvailable(): boolean {
    return this._available;
  }

  async rebuildIndex(): Promise<void> {
    const docs: Array<{ path: string; content: string }> = [];
    const memoryPath = join(this._memoryDir, 'MEMORY.md');
    const dailyDir = join(this._memoryDir, 'daily');

    if (existsSync(memoryPath)) {
      docs.push({ path: 'MEMORY.md', content: readFileSync(memoryPath, 'utf-8') });
    }

    const today = this._dateStr(new Date());
    const yesterday = this._dateStr(new Date(Date.now() - 86400000));

    for (const date of [today, yesterday]) {
      const p = join(dailyDir, `${date}.md`);
      if (existsSync(p)) {
        docs.push({ path: `daily/${date}.md`, content: readFileSync(p, 'utf-8') });
      }
    }

    this._indexState = indexDocuments(docs);
    this._available = this._indexState.docCount > 0;
  }

  async search(query: string, maxResults = 5): Promise<ReadonlyArray<SearchResult>> {
    if (!this._indexState) {
      return [];
    }
    return search(this._indexState, query, maxResults);
  }

  private _dateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

export { BM25MemoryBackend };
