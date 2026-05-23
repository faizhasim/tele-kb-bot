import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQmdMemoryBackend } from './qmd-backend';

// Create mock functions before vi.mock runs (hoisted via vi.hoisted)
const { mockDetect, mockQuery } = vi.hoisted(() => ({
  mockDetect: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('./qmd', () => ({
  detect: mockDetect,
  query: mockQuery,
}));

describe('QmdMemoryBackend', () => {
  let backend: ReturnType<typeof createQmdMemoryBackend>;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = createQmdMemoryBackend();
  });

  it('isAvailable returns false initially', () => {
    expect(backend.isAvailable()).toBe(false);
  });

  describe('rebuildIndex', () => {
    it('calls detect and sets available to true when detect returns true', async () => {
      mockDetect.mockReturnValue(true);

      await backend.rebuildIndex();

      expect(mockDetect).toHaveBeenCalledOnce();
      expect(backend.isAvailable()).toBe(true);
    });

    it('calls detect and sets available to false when detect returns false', async () => {
      mockDetect.mockReturnValue(false);

      await backend.rebuildIndex();

      expect(mockDetect).toHaveBeenCalledOnce();
      expect(backend.isAvailable()).toBe(false);
    });
  });

  describe('search', () => {
    it('returns empty array when backend is not available', async () => {
      const results = await backend.search('anything');

      expect(results).toEqual([]);
    });

    it('returns empty array when qmdQuery returns null', async () => {
      mockDetect.mockReturnValue(true);
      mockQuery.mockReturnValue(null);
      await backend.rebuildIndex();

      const results = await backend.search('test');

      expect(results).toEqual([]);
      expect(mockQuery).toHaveBeenCalledWith('test', 5);
    });

    it('maps qmdQuery results to SearchResult format', async () => {
      mockDetect.mockReturnValue(true);
      mockQuery.mockReturnValue([
        { filePath: '/tmp/docs/memory.md', score: 0.95, snippet: 'relevant content here' },
        { filePath: '/tmp/docs/other.md', score: 0.42, snippet: 'less relevant' },
      ]);
      await backend.rebuildIndex();

      const results = await backend.search('relevant');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        filePath: '/tmp/docs/memory.md',
        score: 0.95,
        snippet: 'relevant content here',
      });
      expect(results[1]).toEqual({
        filePath: '/tmp/docs/other.md',
        score: 0.42,
        snippet: 'less relevant',
      });
      expect(mockQuery).toHaveBeenCalledWith('relevant', 5);
    });

    it('passes maxResults to qmdQuery', async () => {
      mockDetect.mockReturnValue(true);
      mockQuery.mockReturnValue([{ filePath: 'a.md', score: 1, snippet: 'x' }]);
      await backend.rebuildIndex();

      await backend.search('test', 3);

      expect(mockQuery).toHaveBeenCalledWith('test', 3);
    });
  });
});
