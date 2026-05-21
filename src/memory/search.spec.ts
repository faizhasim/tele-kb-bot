import { describe, expect, it } from 'vitest';
import { indexDocuments, search, tokenize } from './search';

const docs = [
  {
    path: 'memory/MEMORY.md',
    content: '#decisions [[model-choice]] Using Opencode Go + deepseek-v4-flash for reasoning.',
  },
  {
    path: 'memory/daily/2026-05-21.md',
    content: 'Implemented the memory system today. Discussed architecture decisions with the team.',
  },
  {
    path: 'memory/daily/2026-05-20.md',
    content: 'Set up the pi SDK integration. Configured telegram bot token and allowed users.',
  },
];

describe('tokenize', () => {
  it('splits on whitespace and punctuation', () => {
    const tokens = tokenize('hello world, this-is a test!');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('this-is');
  });

  it('lowercases all tokens', () => {
    expect(tokenize('HELLO World')).toEqual(['hello', 'world']);
  });

  it('filters empty tokens', () => {
    expect(tokenize('  a   b  ')).toEqual(['a', 'b']);
  });
});

describe('indexDocuments + search', () => {
  const state = indexDocuments(docs);

  it('returns empty for empty index', () => {
    const empty = indexDocuments([]);
    expect(search(empty, 'anything')).toEqual([]);
  });

  it('returns empty for empty query', () => {
    expect(search(state, '   ')).toEqual([]);
  });

  it('ranks memory system query highest in today', () => {
    const results = search(state, 'memory system');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.filePath).toContain('2026-05-21');
  });

  it('finds pi SDK in the correct file', () => {
    const results = search(state, 'pi SDK');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.filePath.includes('2026-05-20'))).toBe(true);
  });

  it('respects maxResults', () => {
    const results = search(state, 'telegram', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
