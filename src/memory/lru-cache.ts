/**
 * Generic LRU (Least Recently Used) cache for search query results.
 *
 * Evicts the least recently used entry when maxEntries or maxSizeBytes is exceeded.
 * Pure TypeScript — zero dependencies.
 *
 * @module
 */

interface LRUCacheEntry<V> {
  readonly key: string;
  readonly value: V;
  readonly sizeBytes: number;
  lastAccessed: number;
}

interface LRUCacheOptions {
  /** Maximum number of entries before eviction. */
  readonly maxEntries: number;
  /** Maximum total estimated bytes before eviction. */
  readonly maxSizeBytes: number;
}

class LRUCache<V> {
  private readonly _maxEntries: number;
  private readonly _maxSizeBytes: number;
  private _map: Map<string, LRUCacheEntry<V>> = new Map();
  private _totalBytes = 0;

  constructor(options: LRUCacheOptions) {
    this._maxEntries = options.maxEntries;
    this._maxSizeBytes = options.maxSizeBytes;
  }

  /** Get a value by key. Returns undefined on miss. Updates LRU order on hit. */
  get(key: string): V | undefined {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    entry.lastAccessed = Date.now();
    // Move to end (most recently used) by re-inserting
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  /** Check if key exists without affecting LRU order. */
  has(key: string): boolean {
    return this._map.has(key);
  }

  /**
   * Store a value. If sizeBytes is omitted, estimates from JSON.stringify length.
   * Evicts LRU entries if maxEntries or maxSizeBytes is exceeded.
   */
  set(key: string, value: V, sizeBytes?: number): void {
    const bytes = sizeBytes ?? Buffer.byteLength(JSON.stringify(value), 'utf-8');

    // If key already exists, remove old entry first
    const existing = this._map.get(key);
    if (existing) {
      this._totalBytes -= existing.sizeBytes;
      this._map.delete(key);
    }

    const entry: LRUCacheEntry<V> = {
      key,
      value,
      sizeBytes: bytes,
      lastAccessed: Date.now(),
    };

    this._map.set(key, entry);
    this._totalBytes += bytes;

    // Evict until both constraints are satisfied
    this._evict();
  }

  /** Number of entries currently in the cache. */
  get size(): number {
    return this._map.size;
  }

  /** Estimated total bytes of all cached entries. */
  get estimatedBytes(): number {
    return this._totalBytes;
  }

  /** Remove all entries. */
  clear(): void {
    this._map.clear();
    this._totalBytes = 0;
  }

  /** Remove a single entry by key. */
  delete(key: string): boolean {
    const entry = this._map.get(key);
    if (!entry) return false;
    this._totalBytes -= entry.sizeBytes;
    this._map.delete(key);
    return true;
  }

  /** Iterate keys in LRU order (least recently used first). */
  *keys(): IterableIterator<string> {
    yield* this._map.keys();
  }

  // ── Private ──────────────────────────────────────────────────────

  private _evict(): void {
    // Evict by count
    while (this._map.size > this._maxEntries) {
      const oldest = this._map.entries().next();
      if (oldest.done) break;
      this._totalBytes -= oldest.value[1].sizeBytes;
      this._map.delete(oldest.value[0]);
    }

    // Evict by size
    while (this._totalBytes > this._maxSizeBytes && this._map.size > 1) {
      const oldest = this._map.entries().next();
      if (oldest.done) break;
      this._totalBytes -= oldest.value[1].sizeBytes;
      this._map.delete(oldest.value[0]);
    }
  }
}

export type { LRUCacheOptions };
export { LRUCache };
