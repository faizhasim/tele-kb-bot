/**
 * BM25 memory backend — ephemeral, in-memory search.
 *
 * Rebuilds the BM25 index from memory files AND vault directories on each startup.
 * All data is lost on process restart (hence "ephemeral").
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryBackend } from './interface';
import { indexDocuments, search } from './search';
import type { SearchResult } from './types';

// ─── Helpers ────────────────────────────────────────────────────────

const dateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const MAX_READ_SIZE = 1_048_576; // 1 MB per file

const collectMarkdownFiles = (dir: string): Array<string> => {
  const files: Array<string> = [];
  const walk = (d: string): void => {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
          files.push(full);
        }
      }
    } catch {
      // skip unreadable directories
    }
  };
  walk(dir);
  return files;
};

// ─── Factory ─────────────────────────────────────────────────────────

const createBM25MemoryBackend = (memoryDir: string, vaultDirectories: ReadonlyArray<string> = []): MemoryBackend => {
  let indexState: ReturnType<typeof indexDocuments> | null = null;
  let available = false;

  const backend: MemoryBackend = {
    isAvailable: () => available,

    rebuildIndex: async () => {
      const docs: Array<{ path: string; content: string }> = [];

      // 1. Memory directory files
      const memoryPath = join(memoryDir, 'MEMORY.md');
      const dailyDir = join(memoryDir, 'daily');

      if (existsSync(memoryPath)) {
        docs.push({ path: 'MEMORY.md', content: readFileSync(memoryPath, 'utf-8') });
      }

      const today = dateStr(new Date());
      const yesterday = dateStr(new Date(Date.now() - 86_400_000));

      for (const date of [today, yesterday]) {
        const p = join(dailyDir, `${date}.md`);
        if (existsSync(p)) {
          docs.push({ path: `daily/${date}.md`, content: readFileSync(p, 'utf-8') });
        }
      }

      // 2. Vault directories — scan for markdown files
      for (const vaultDir of vaultDirectories) {
        if (!existsSync(vaultDir)) continue;
        for (const filePath of collectMarkdownFiles(vaultDir)) {
          try {
            const content = readFileSync(filePath, 'utf-8');
            if (content.length <= MAX_READ_SIZE) {
              docs.push({ path: filePath, content });
            }
          } catch {
            // skip unreadable files
          }
        }
      }

      indexState = indexDocuments(docs);
      available = indexState.docCount > 0;
    },

    search: async (query: string, maxResults = 5): Promise<ReadonlyArray<SearchResult>> => {
      if (!indexState) return [];
      return search(indexState, query, maxResults);
    },
  };

  return backend;
};

export { createBM25MemoryBackend };
