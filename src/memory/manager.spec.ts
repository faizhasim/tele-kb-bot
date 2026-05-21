import { FileSystem } from '@effect/platform/FileSystem';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultConfig } from '../config/defaults';
import { EffectLoggerLive } from '../logger';
import { indexDocuments } from './search';
import {
  appendMemorySync,
  appendToMemory,
  appendToToday,
  appendTodaySync,
  buildSearchIndex,
  createMemoryContext,
  dailyPath,
  memoryPath,
  readMemory,
  readMemorySync,
  readScratchpad,
  readToday,
  readYesterday,
  scratchpadPath,
  searchMemory,
  todayDate,
  writeScratchpad,
  writeScratchpadSync,
  yesterdayDate,
} from './manager';

// ─── Pure Function Tests ────────────────────────────────────────────

describe('todayDate', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(todayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('yesterdayDate', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(yesterdayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(yesterdayDate()).not.toBe(todayDate());
  });
});

describe('memoryPath / scratchpadPath / dailyPath', () => {
  it('returns correct path for memory', () => {
    expect(memoryPath('/base')).toBe('/base/MEMORY.md');
  });

  it('returns correct path for scratchpad', () => {
    expect(scratchpadPath('/base')).toBe('/base/SCRATCHPAD.md');
  });

  it('returns correct path for daily', () => {
    expect(dailyPath('/base', '2026-05-21')).toBe('/base/daily/2026-05-21.md');
  });
});

// ─── Effect-based Tests ─────────────────────────────────────────────

describe('read/write scratchpad', () => {
  const runtime = ManagedRuntime.make(Layer.merge(BunFileSystem.layer, EffectLoggerLive('test', 'silent')));

  it('writes and reads scratchpad content', async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          yield* writeScratchpad(baseDir, '- [ ] test task\n- [x] done task');
          const content = yield* readScratchpad(baseDir);
          return content;
        }),
      ),
    );
    expect(result).toContain('test task');
    expect(result).toContain('done task');
  });

  it('appends to memory and reads it back', async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          yield* appendToMemory(baseDir, '#decisions model-choice');
          yield* appendToMemory(baseDir, 'Using Opencode Go + deepseek-v4-flash');
          const content = yield* readMemory(baseDir);
          return content;
        }),
      ),
    );
    expect(result).toContain('model-choice');
    expect(result).toContain('deepseek-v4-flash');
  });

  it('readScratchpad returns empty string for non-existent file', async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          const content = yield* readScratchpad(baseDir);
          return content;
        }),
      ),
    );
    expect(result).toBe('');
  });
});

// ─── Sync Read/Write Tests ──────────────────────────────────────────

describe('appendMemorySync', () => {
  it('writes to MEMORY.md file and appends', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    try {
      appendMemorySync(baseDir, 'First entry');
      const p = join(baseDir, 'MEMORY.md');
      expect(readFileSync(p, 'utf-8')).toBe('First entry');

      appendMemorySync(baseDir, 'Second entry');
      expect(readFileSync(p, 'utf-8')).toBe('First entry\nSecond entry');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe('readFileSyncSafe (via readMemorySync)', () => {
  it('returns empty string when readFileSync throws (path is a directory)', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    try {
      // Create MEMORY.md as a directory — readFileSync throws EISDIR
      const p = join(baseDir, 'MEMORY.md');
      mkdirSync(p, { recursive: true });
      const result = readMemorySync(baseDir);
      expect(result).toBe('');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe('writeScratchpadSync', () => {
  it('writes and overwrites SCRATCHPAD.md', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    try {
      writeScratchpadSync(baseDir, '- [ ] task 1\n- [x] task 2');
      const p = join(baseDir, 'SCRATCHPAD.md');
      expect(readFileSync(p, 'utf-8')).toBe('- [ ] task 1\n- [x] task 2');

      writeScratchpadSync(baseDir, '- [ ] overwritten');
      expect(readFileSync(p, 'utf-8')).toBe('- [ ] overwritten');
      expect(readFileSync(p, 'utf-8')).not.toContain('task 1');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe('readMemorySync', () => {
  it('reads back content from MEMORY.md', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    try {
      writeFileSync(join(baseDir, 'MEMORY.md'), 'Stored memory', 'utf-8');
      expect(readMemorySync(baseDir)).toBe('Stored memory');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('returns empty string for non-existent MEMORY.md', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    try {
      expect(readMemorySync(baseDir)).toBe('');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe('appendTodaySync', () => {
  it("creates and appends to today's daily file", () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    try {
      const dailyDir = join(baseDir, 'daily');
      mkdirSync(dailyDir, { recursive: true });

      appendTodaySync(baseDir, 'Log entry 1');
      const today = todayDate();
      const p = join(dailyDir, `${today}.md`);
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf-8')).toBe('Log entry 1');

      appendTodaySync(baseDir, 'Log entry 2');
      expect(readFileSync(p, 'utf-8')).toBe('Log entry 1\nLog entry 2');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe('searchMemory (pure wrapper)', () => {
  it('returns results for matching query', () => {
    const state = indexDocuments([{ path: 'test.md', content: 'The quick brown fox jumps over the lazy dog' }]);
    const results = searchMemory(state, 'fox');
    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe('test.md');
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('returns empty array for non-matching query', () => {
    const state = indexDocuments([{ path: 'test.md', content: 'The quick brown fox jumps over the lazy dog' }]);
    expect(searchMemory(state, 'nonexistent')).toHaveLength(0);
  });

  it('returns empty array for empty index', () => {
    expect(searchMemory(indexDocuments([]), 'anything')).toHaveLength(0);
  });
});

describe('indexDocuments (pure building block of buildSearchIndex)', () => {
  it('builds an index from memory and daily documents', () => {
    const state = indexDocuments([
      { path: 'memory/MEMORY.md', content: '# Long term memories\nArchitecture decision X' },
      { path: 'memory/daily/2026-05-21.md', content: '## Today\nWorked on feature Y' },
    ]);
    expect(state.docCount).toBe(2);
    expect(state.docs).toHaveLength(2);
    expect(state.avgDocLen).toBeGreaterThan(0);
    expect(state.docs[0]!.path).toBe('memory/MEMORY.md');
    expect(state.docs[1]!.path).toBe('memory/daily/2026-05-21.md');
  });
});

// ─── Effect-based Memory Operations ─────────────────────────────────

describe('Effect memory operations', () => {
  const runtime = ManagedRuntime.make(Layer.merge(BunFileSystem.layer, EffectLoggerLive('test', 'silent')));

  it("appendToToday appends to today's daily log", async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          const dailyDir = join(baseDir, 'daily');
          yield* fs.makeDirectory(dailyDir);

          yield* appendToToday(baseDir, 'Morning log');
          yield* appendToToday(baseDir, 'Afternoon log');

          const today = todayDate();
          const content = yield* fs.readFileString(join(dailyDir, `${today}.md`));
          return content;
        }),
      ),
    );
    expect(result).toBe('Morning log\nAfternoon log');
  });

  it("readToday reads today's content", async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          const dailyDir = join(baseDir, 'daily');
          yield* fs.makeDirectory(dailyDir);
          const today = todayDate();
          yield* fs.writeFileString(join(dailyDir, `${today}.md`), '## Today\nSome content');

          const content = yield* readToday(baseDir);
          return content;
        }),
      ),
    );
    expect(result).toBe('## Today\nSome content');
  });

  it("readYesterday reads yesterday's content", async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          const dailyDir = join(baseDir, 'daily');
          yield* fs.makeDirectory(dailyDir);
          const yesterday = yesterdayDate();
          yield* fs.writeFileString(join(dailyDir, `${yesterday}.md`), '## Yesterday\nOld content');

          const content = yield* readYesterday(baseDir);
          return content;
        }),
      ),
    );
    expect(result).toBe('## Yesterday\nOld content');
  });

  it('readMemory returns empty for non-existent memory dir', async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          const content = yield* readMemory(baseDir);
          return content;
        }),
      ),
    );
    expect(result).toBe('');
  });

  it('reading non-existent daily returns empty string', async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          const todayContent = yield* readToday(baseDir);
          const yesterdayContent = yield* readYesterday(baseDir);
          return { todayContent, yesterdayContent };
        }),
      ),
    );
    expect(result.todayContent).toBe('');
    expect(result.yesterdayContent).toBe('');
  });

  it('appending to memory when MEMORY.md does not exist yet', async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          // MEMORY.md does not exist yet
          yield* appendToMemory(baseDir, 'Fresh entry');
          const content = yield* readMemory(baseDir);
          return content;
        }),
      ),
    );
    expect(result).toBe('Fresh entry');
  });

  it('appendToMemory adds newline before appending to existing file', async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          yield* appendToMemory(baseDir, 'First line');
          yield* appendToMemory(baseDir, 'Second line');
          const content = yield* readMemory(baseDir);
          return content;
        }),
      ),
    );
    expect(result).toBe('First line\nSecond line');
  });

  it('overwriteFile overwrites existing content (via writeScratchpad)', async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();
          yield* writeScratchpad(baseDir, '- [ ] first version\n');
          yield* writeScratchpad(baseDir, '- [x] second version\n');
          const content = yield* readScratchpad(baseDir);
          return content;
        }),
      ),
    );
    expect(result).toBe('- [x] second version\n');
  });

  it('buildSearchIndex builds index from scratch', async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();

          // Write MEMORY.md
          yield* fs.writeFileString(join(baseDir, 'MEMORY.md'), '# Long-term memory\nKey decisions');

          // Write today's daily file
          const dailyDir = join(baseDir, 'daily');
          yield* fs.makeDirectory(dailyDir);
          yield* fs.writeFileString(join(dailyDir, `${todayDate()}.md`), '## Today log\nWorked on feature');

          // Build index
          const index = yield* buildSearchIndex(baseDir);
          return { docCount: index.docCount, paths: index.docs.map((d) => d.path) };
        }),
      ),
    );
    expect(result.docCount).toBe(2);
    expect(result.paths).toContain('memory/MEMORY.md');
    expect(result.paths).toContain(`memory/daily/${todayDate()}.md`);
  });

  it('searchMemory returns results after building index', async () => {
    const result = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const baseDir = yield* fs.makeTempDirectoryScoped();

          // Write searchable content
          yield* fs.writeFileString(
            join(baseDir, 'MEMORY.md'),
            '# Knowledge base\nTypeScript is a typed language.\nEffect TS provides algebraic effects.',
          );

          // Build index
          const index = yield* buildSearchIndex(baseDir);

          // Search
          const typeResults = searchMemory(index, 'typescript');
          const effectResults = searchMemory(index, 'effect');
          const emptyResults = searchMemory(index, 'rust');
          return {
            typeCount: typeResults.length,
            effectCount: effectResults.length,
            emptyCount: emptyResults.length,
            typeSnippet: typeResults.length > 0 ? typeResults[0]!.snippet : '',
          };
        }),
      ),
    );
    expect(result.typeCount).toBeGreaterThan(0);
    expect(result.effectCount).toBeGreaterThan(0);
    expect(result.emptyCount).toBe(0);
    expect(result.typeSnippet.toLowerCase()).toContain('typescript');
  });
});

// ─── createMemoryContext Tests ──────────────────────────────────────

describe('createMemoryContext', () => {
  it('creates BM25MemoryBackend in ephemeral mode', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    try {
      const memoryDir = join(tempDir, 'memory');
      mkdirSync(memoryDir, { recursive: true });
      mkdirSync(join(memoryDir, 'daily'), { recursive: true });
      writeFileSync(join(memoryDir, 'MEMORY.md'), '# Test\ncontent', 'utf-8');

      const config = getDefaultConfig();
      const ctx = await createMemoryContext(config, tempDir);

      expect(ctx.backend).toBeDefined();
      expect(ctx.configDir).toBe(tempDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('backend is available after rebuild', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    try {
      const memoryDir = join(tempDir, 'memory');
      mkdirSync(memoryDir, { recursive: true });
      mkdirSync(join(memoryDir, 'daily'), { recursive: true });
      writeFileSync(join(memoryDir, 'MEMORY.md'), '# Memory\nTest content for search', 'utf-8');

      const config = getDefaultConfig();
      const ctx = await createMemoryContext(config, tempDir);
      // createMemoryContext already called rebuildIndex internally
      expect(ctx.backend.isAvailable()).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('cached search returns results', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    try {
      const memoryDir = join(tempDir, 'memory');
      mkdirSync(memoryDir, { recursive: true });
      mkdirSync(join(memoryDir, 'daily'), { recursive: true });
      writeFileSync(
        join(memoryDir, 'MEMORY.md'),
        '# Project\nWe use Effect-TS for error handling.\nThe bot uses BM25 for search.\n',
        'utf-8',
      );

      const config = getDefaultConfig();
      const ctx = await createMemoryContext(config, tempDir);
      const results = await ctx.backend.search('bm25', 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.score).toBeGreaterThan(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('LRU cache serves repeated searches (second call returns same results)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    try {
      const memoryDir = join(tempDir, 'memory');
      mkdirSync(memoryDir, { recursive: true });
      mkdirSync(join(memoryDir, 'daily'), { recursive: true });
      writeFileSync(
        join(memoryDir, 'MEMORY.md'),
        '# Knowledge\nApples are fruit. Bananas are yellow. Cherries are sweet.\n',
        'utf-8',
      );

      const config = getDefaultConfig();
      const ctx = await createMemoryContext(config, tempDir);

      const results1 = await ctx.backend.search('apples', 5);
      const results2 = await ctx.backend.search('apples', 5);

      expect(results1).toEqual(results2);
      expect(results1.length).toBeGreaterThan(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
