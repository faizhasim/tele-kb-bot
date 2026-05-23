import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBM25MemoryBackend } from './bm25-backend';

describe('BM25MemoryBackend', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('isAvailable returns false before rebuildIndex', () => {
    const backend = createBM25MemoryBackend('/tmp/nonexistent');
    expect(backend.isAvailable()).toBe(false);
  });

  describe('rebuildIndex', () => {
    it('makes backend available when MEMORY.md exists', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'bm25-test-'));
      writeFileSync(join(tempDir, 'MEMORY.md'), 'Root memory content.');

      const backend = createBM25MemoryBackend(tempDir);
      await backend.rebuildIndex();

      expect(backend.isAvailable()).toBe(true);
    });

    it('leaves backend unavailable when directory is empty', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'bm25-test-'));

      const backend = createBM25MemoryBackend(tempDir);
      await backend.rebuildIndex();

      expect(backend.isAvailable()).toBe(false);
    });

    it('handles missing daily directory gracefully', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'bm25-test-'));
      writeFileSync(join(tempDir, 'MEMORY.md'), 'Content.');

      const backend = createBM25MemoryBackend(tempDir);

      await expect(backend.rebuildIndex()).resolves.toBeUndefined();
      expect(backend.isAvailable()).toBe(true);
    });

    it('indexes daily files alongside MEMORY.md', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'bm25-test-'));
      writeFileSync(join(tempDir, 'MEMORY.md'), 'Root memory about the project.');
      mkdirSync(join(tempDir, 'daily'));

      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      writeFileSync(join(tempDir, 'daily', `${dateStr}.md`), 'Daily log entry about implementation.');

      const backend = createBM25MemoryBackend(tempDir);
      await backend.rebuildIndex();

      expect(backend.isAvailable()).toBe(true);

      const results = await backend.search('implementation');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.filePath.includes(dateStr))).toBe(true);
    });

    it('does not index files with dates older than yesterday', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'bm25-test-'));
      writeFileSync(join(tempDir, 'MEMORY.md'), 'Root memory.');
      mkdirSync(join(tempDir, 'daily'));

      const oldDate = new Date(Date.now() - 5 * 86_400_000);
      const oldDateStr = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}-${String(oldDate.getDate()).padStart(2, '0')}`;
      writeFileSync(join(tempDir, 'daily', `${oldDateStr}.md`), 'Stale entry about old feature.');

      const backend = createBM25MemoryBackend(tempDir);
      await backend.rebuildIndex();

      const results = await backend.search('stale');
      expect(results.every((r) => r.filePath !== `daily/${oldDateStr}.md`)).toBe(true);
    });
  });

  describe('search', () => {
    it('returns empty array before rebuildIndex', async () => {
      const backend = createBM25MemoryBackend('/tmp/nonexistent');
      const results = await backend.search('anything');
      expect(results).toEqual([]);
    });

    it('returns matching results after rebuildIndex', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'bm25-test-'));
      writeFileSync(join(tempDir, 'MEMORY.md'), 'The memory system stores project information.');

      const backend = createBM25MemoryBackend(tempDir);
      await backend.rebuildIndex();

      const results = await backend.search('memory system');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.filePath).toBe('MEMORY.md');
    });

    it('returns empty array for unmatched query', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'bm25-test-'));
      writeFileSync(join(tempDir, 'MEMORY.md'), 'Only information about the project.');

      const backend = createBM25MemoryBackend(tempDir);
      await backend.rebuildIndex();

      const results = await backend.search('nonexistentwordxyz');
      expect(results).toEqual([]);
    });

    it('respects maxResults parameter', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'bm25-test-'));
      writeFileSync(join(tempDir, 'MEMORY.md'), 'Project Alpha. Project Beta. Project Gamma.');
      mkdirSync(join(tempDir, 'daily'));

      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      writeFileSync(join(tempDir, 'daily', `${dateStr}.md`), 'Daily project update.');

      const backend = createBM25MemoryBackend(tempDir);
      await backend.rebuildIndex();

      const results = await backend.search('project', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });
});
