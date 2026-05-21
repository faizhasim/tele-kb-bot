import { FileSystem } from '@effect/platform/FileSystem';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';
import { EffectLoggerLive } from '../logger';
import {
  appendToMemory,
  dailyPath,
  memoryPath,
  readMemory,
  readScratchpad,
  scratchpadPath,
  todayDate,
  writeScratchpad,
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
