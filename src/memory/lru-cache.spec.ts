import { describe, expect, it } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LRUCache({ maxEntries: 10, maxSizeBytes: 1_000_000 });
    cache.set('a', { data: 1 });
    expect(cache.get('a')).toEqual({ data: 1 });
    expect(cache.get('b')).toBeUndefined();
  });

  it('evicts least recently used by count', () => {
    const cache = new LRUCache<string>({ maxEntries: 3, maxSizeBytes: 1_000_000 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    cache.set('d', '4'); // should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
    expect(cache.get('d')).toBe('4');
    expect(cache.size).toBe(3);
  });

  it('evicts by total size', () => {
    const cache = new LRUCache<string>({ maxEntries: 100, maxSizeBytes: 50 });
    cache.set('a', 'hello world', 30);
    cache.set('b', 'goodbye world', 30); // total = 60 > 50, evicts 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('goodbye world');
    expect(cache.size).toBe(1);
  });

  it('promotes accessed entries', () => {
    const cache = new LRUCache<string>({ maxEntries: 3, maxSizeBytes: 1_000_000 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    cache.get('a'); // promotes 'a' to MRU
    cache.set('d', '4'); // should evict 'b' (LRU), not 'a'
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('3');
    expect(cache.get('d')).toBe('4');
  });

  it('updates existing key without duplicating', () => {
    const cache = new LRUCache<string>({ maxEntries: 2, maxSizeBytes: 1_000_000 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('a', 'updated');
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe('updated');
  });

  it('clear removes all entries', () => {
    const cache = new LRUCache<string>({ maxEntries: 10, maxSizeBytes: 1_000_000 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.estimatedBytes).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('delete removes single entry', () => {
    const cache = new LRUCache<string>({ maxEntries: 10, maxSizeBytes: 1_000_000 });
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.delete('a')).toBe(true);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.delete('nonexistent')).toBe(false);
  });

  it('reports estimatedBytes', () => {
    const cache = new LRUCache<string>({ maxEntries: 10, maxSizeBytes: 1_000_000 });
    cache.set('a', 'hello', 10);
    cache.set('b', 'world', 10);
    expect(cache.estimatedBytes).toBe(20);
  });

  it('iterates keys in LRU order', () => {
    const cache = new LRUCache<string>({ maxEntries: 5, maxSizeBytes: 1_000_000 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    cache.get('a'); // promote
    const keys = [...cache.keys()];
    expect(keys).toEqual(['b', 'c', 'a']); // b was LRU
  });
});
