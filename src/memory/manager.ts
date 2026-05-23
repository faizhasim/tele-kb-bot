/**
 * Memory file manager for tele-kb-bot.
 *
 * Reads/writes MEMORY.md, SCRATCHPAD.md, and daily/YYYY-MM-DD.md files
 * using both sync (for CLI/extensions) and Effect (for daemon) APIs.
 * Factory function wires backend + LRU cache into a MemoryContext.
 *
 * @module
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform/FileSystem';
import { Effect } from 'effect';
import type { Config } from '../config/schema';
import { createBM25MemoryBackend } from './bm25-backend';
import type { MemoryContext } from './interface';
import { LRUCache } from './lru-cache';
import type { IndexState } from './search';
import { indexDocuments, search } from './search';
import type { SearchResult } from './types';

// ─── File Names ──────────────────────────────────────────────────────

const MEMORY_FILE = 'MEMORY.md';
const SCRATCHPAD_FILE = 'SCRATCHPAD.md';
const DAILY_DIR = 'daily';

// ─── Path Helpers ───────────────────────────────────────────────────

const memoryPath = (baseDir: string) => join(baseDir, MEMORY_FILE);
const scratchpadPath = (baseDir: string) => join(baseDir, SCRATCHPAD_FILE);
const dailyPath = (baseDir: string, date: string) => join(baseDir, DAILY_DIR, `${date}.md`);

const todayDate = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const yesterdayDate = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─── Sync Read/Write (for CLI / extensions) ─────────────────────────

const readFileSyncSafe = (path: string): string => {
  try {
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
};

const appendFileSyncSafe = (path: string, content: string): void => {
  try {
    appendFileSync(path, content, 'utf-8');
  } catch {
    // best-effort
  }
};

const writeFileSyncSafe = (path: string, content: string): void => {
  try {
    writeFileSync(path, content, 'utf-8');
  } catch {
    // best-effort
  }
};

/** Read MEMORY.md (sync). */
const readMemorySync = (baseDir: string): string => readFileSyncSafe(memoryPath(baseDir));

/** Read SCRATCHPAD.md (sync). */
const readScratchpadSync = (baseDir: string): string => readFileSyncSafe(scratchpadPath(baseDir));

/** Read a daily log file (sync). */

/** Append content to MEMORY.md (sync). */
const appendMemorySync = (baseDir: string, content: string): void => {
  const p = memoryPath(baseDir);
  const prefix = existsSync(p) ? '\n' : '';
  appendFileSyncSafe(p, prefix + content);
};

/** Overwrite SCRATCHPAD.md (sync). */
const writeScratchpadSync = (baseDir: string, content: string): void => {
  writeFileSyncSafe(scratchpadPath(baseDir), content);
};

/** Append content to today's daily log (sync). */
const appendTodaySync = (baseDir: string, content: string): void => {
  const p = dailyPath(baseDir, todayDate());
  const prefix = existsSync(p) ? '\n' : '';
  appendFileSyncSafe(p, prefix + content);
};

// ─── Effect-based Read/Write ─────────────────────────────────────────

const readSafe = (path: string): Effect.Effect<string, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!exists) return '';
    return yield* fs.readFileString(path).pipe(Effect.catchAll(() => Effect.succeed('')));
  });

const readMemory = (baseDir: string): Effect.Effect<string, never, FileSystem> => readSafe(memoryPath(baseDir));

const readScratchpad = (baseDir: string): Effect.Effect<string, never, FileSystem> => readSafe(scratchpadPath(baseDir));

const readDaily = (baseDir: string, date: string): Effect.Effect<string, never, FileSystem> =>
  readSafe(dailyPath(baseDir, date));

const readToday = (baseDir: string): Effect.Effect<string, never, FileSystem> => readDaily(baseDir, todayDate());

const readYesterday = (baseDir: string): Effect.Effect<string, never, FileSystem> =>
  readDaily(baseDir, yesterdayDate());

const appendToFile = (path: string, content: string): Effect.Effect<void, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.catchAll(() => Effect.succeed(false)));
    const prefix = exists ? '\n' : '';
    yield* fs.writeFileString(path, prefix + content, { flag: 'a' }).pipe(Effect.catchAll(() => Effect.void));
  });

const overwriteFile = (path: string, content: string): Effect.Effect<void, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.writeFileString(path, content).pipe(Effect.catchAll(() => Effect.void));
  });

const appendToMemory = (baseDir: string, content: string): Effect.Effect<void, never, FileSystem> =>
  appendToFile(memoryPath(baseDir), content);

const writeScratchpad = (baseDir: string, content: string): Effect.Effect<void, never, FileSystem> =>
  overwriteFile(scratchpadPath(baseDir), content);

const appendToToday = (baseDir: string, content: string): Effect.Effect<void, never, FileSystem> =>
  appendToFile(dailyPath(baseDir, todayDate()), content);

// ─── Search Index ────────────────────────────────────────────────────

const buildSearchIndex = (baseDir: string): Effect.Effect<IndexState, never, FileSystem> =>
  Effect.gen(function* () {
    const [memory, today, yesterday] = yield* Effect.all([
      readMemory(baseDir),
      readToday(baseDir),
      readYesterday(baseDir),
    ]);

    const docs = [
      ...(memory ? [{ path: `memory/${MEMORY_FILE}`, content: memory }] : []),
      ...(today ? [{ path: `memory/daily/${todayDate()}.md`, content: today }] : []),
      ...(yesterday ? [{ path: `memory/daily/${yesterdayDate()}.md`, content: yesterday }] : []),
    ];

    return indexDocuments(docs);
  });

const searchMemory = (state: IndexState, query: string, maxResults = 5): ReadonlyArray<SearchResult> =>
  search(state, query, maxResults);

// ─── Memory Context Factory ─────────────────────────────────────────

/**
 * Create a memory backend + LRU cache based on config.
 * For ephemeral mode: creates BM25MemoryBackend, rebuilds index.
 * For persistent mode: would create QmdMemoryBackend (TODO).
 *
 * Returns a MemoryContext with the backend and cache layer.
 */
const createMemoryContext = async (config: Config, configDir: string): Promise<MemoryContext> => {
  const memoryDir = join(configDir, 'memory');

  // LRU cache wraps the backend
  const cache = new LRUCache<ReadonlyArray<SearchResult>>({
    maxEntries: config.memory.cache.max_entries,
    maxSizeBytes: config.memory.cache.max_size_bytes,
  });

  let backend: import('./interface').MemoryBackend;

  if (config.memory.mode === 'persistent') {
    // qmd backend — use BM25 as fallback if qmd not available
    const { createQmdMemoryBackend: loadQmd } = await import('./qmd-backend').catch(() => ({
      createQmdMemoryBackend: undefined as undefined,
    }));
    if (loadQmd) {
      backend = loadQmd(config.vault_directories);
    } else {
      backend = createBM25MemoryBackend(memoryDir, config.vault_directories);
    }
  } else {
    backend = createBM25MemoryBackend(memoryDir, config.vault_directories);
  }

  // Rebuild index at startup
  await backend.rebuildIndex();

  // Wrap the backend with LRU cache
  const cachedBackend: import('./interface').MemoryBackend = {
    isAvailable: () => backend.isAvailable(),
    rebuildIndex: () => backend.rebuildIndex(),
    search: async (query: string, maxResults = 5) => {
      const cacheKey = `${query}::${maxResults}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const results = await backend.search(query, maxResults);
      cache.set(cacheKey, results);
      return results;
    },
  };

  return {
    backend: cachedBackend,
    configDir,
    maxEntries: config.memory.cache.max_entries,
    maxSizeBytes: config.memory.cache.max_size_bytes,
    vaultDirectories: config.vault_directories,
  };
};

export type { SearchResult };
export {
  appendMemorySync,
  appendTodaySync,
  appendToMemory,
  appendToToday,
  buildSearchIndex,
  createMemoryContext,
  dailyPath,
  memoryPath,
  readMemory,
  readMemorySync,
  readScratchpad,
  readScratchpadSync,
  readToday,
  readYesterday,
  scratchpadPath,
  searchMemory,
  todayDate,
  writeScratchpad,
  writeScratchpadSync,
  yesterdayDate,
};
