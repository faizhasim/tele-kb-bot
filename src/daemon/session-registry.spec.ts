/**
 * Tests for the daemon session registry module.
 *
 * Session registry is a closure-based factory (createSessionRegistry) that
 * manages per-chat AgentSession instances with lazy creation and idle eviction.
 *
 * @module
 */

import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config/schema';

// ─── Hoisted mocks ──────────────────────────────────────────────────

const { mockCreatePiSession, mockCreateCLILogger } = vi.hoisted(() => {
  /** Create a fresh mock session for each factory call. */
  const createMockSession = (): AgentSession =>
    ({
      prompt: vi.fn().mockResolvedValue('response'),
      abort: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockReturnValue({}),
    }) as unknown as AgentSession;

  return {
    mockCreatePiSession: vi.fn().mockImplementation(async () => createMockSession()),
    mockCreateCLILogger: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    }),
  };
});

// ─── Module mocks ───────────────────────────────────────────────────

vi.mock('../pi/session-factory', () => ({
  createPiSession: mockCreatePiSession,
}));

vi.mock('../logger', () => ({
  createCLILogger: mockCreateCLILogger,
}));

// ─── Module imports (after vi.mock) ─────────────────────────────────

import { createSessionRegistry } from './session-registry';

// ─── Test helpers ───────────────────────────────────────────────────

const TEST_CONFIG_DIR = '/tmp/test-config-dir';

function buildTestConfig(): Config {
  return {
    telegram: {
      bot_token: 'test:token',
      allowed_user_ids: [12_345],
    },
    llm: {
      provider: 'test-provider',
      model: 'test-model',
      reasoning: 'off',
    },
    memory: {
      enabled: false,
      mode: 'ephemeral',
      auto_inject: false,
      search: { max_results: 5, mode: 'keyword' },
      cache: { max_entries: 100, max_size_bytes: 104_857_600 },
      qmd: { enabled: false, binary_path: 'qmd' },
    },
    bot: {
      max_attachments_per_turn: 10,
      streaming_preview: false,
      text_chunk_size: 4096,
      max_sessions: 5,
    },
    vault_directories: [],
    system_prompt: undefined,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('createSessionRegistry', () => {
  let config: Config;

  beforeEach(() => {
    vi.useFakeTimers();
    config = buildTestConfig();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────
  // getOrCreate
  // ──────────────────────────────────────────────────────────────────

  it('getOrCreate creates a new session on first call', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    const session = await registry.getOrCreate(1);

    expect(session).toBeDefined();
    expect(registry.activeCount()).toBe(1);
    expect(mockCreatePiSession).toHaveBeenCalledTimes(1);
    expect(mockCreatePiSession).toHaveBeenCalledWith(config, TEST_CONFIG_DIR);
  });

  it('getOrCreate returns existing session on subsequent calls', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    const session1 = await registry.getOrCreate(42);
    const session2 = await registry.getOrCreate(42);

    expect(session1).toBe(session2);
    expect(registry.activeCount()).toBe(1);
    expect(mockCreatePiSession).toHaveBeenCalledTimes(1);
  });

  it('getOrCreate creates separate sessions for different chatIds', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    const session1 = await registry.getOrCreate(1);
    const session2 = await registry.getOrCreate(2);
    const session3 = await registry.getOrCreate(3);

    expect(session1).not.toBe(session2);
    expect(session2).not.toBe(session3);
    expect(session1).not.toBe(session3);
    expect(registry.activeCount()).toBe(3);
    expect(mockCreatePiSession).toHaveBeenCalledTimes(3);
  });
  // ──────────────────────────────────────────────────────────────────
  // Pool limit
  // ──────────────────────────────────────────────────────────────────

  it('evicts LRU session when pool limit is exceeded', async () => {
    const limitedConfig = buildTestConfig();
    limitedConfig.bot.max_sessions = 2;
    const registry = createSessionRegistry(limitedConfig, TEST_CONFIG_DIR);

    // Fill the pool (fake timers mean Date.now() is constant — advance to distinguish LRU)
    vi.advanceTimersByTime(1000);
    const session1 = await registry.getOrCreate(1);
    vi.advanceTimersByTime(1000);
    const _session2 = await registry.getOrCreate(2);
    expect(registry.activeCount()).toBe(2);

    // Touch session1 (later time = not LRU)
    vi.advanceTimersByTime(1000);
    await registry.getOrCreate(1);

    // Creating session3 should evict session2 (the LRU)
    vi.advanceTimersByTime(1000);
    const session3 = await registry.getOrCreate(3);

    expect(registry.activeCount()).toBe(2);
    expect(registry.get(1)).toBe(session1); // touched, kept
    expect(registry.get(2)).toBeUndefined(); // LRU, evicted
    expect(registry.get(3)).toBe(session3); // newest, kept
    expect(mockCreatePiSession).toHaveBeenCalledTimes(3);
  });

  it('respects pool limit with no eviction when under limit', async () => {
    const limitedConfig = buildTestConfig();
    limitedConfig.bot.max_sessions = 5;
    const registry = createSessionRegistry(limitedConfig, TEST_CONFIG_DIR);

    const sessions = await Promise.all([1, 2, 3, 4].map((id) => registry.getOrCreate(id)));

    expect(registry.activeCount()).toBe(4);
    expect(mockCreatePiSession).toHaveBeenCalledTimes(4);
    for (const s of sessions) {
      expect(s).toBeDefined();
    }
  });

  it('uses default max_sessions when config value is missing', async () => {
    const limitedConfig = buildTestConfig();
    delete (limitedConfig.bot as Record<string, unknown>).max_sessions;
    const registry = createSessionRegistry(limitedConfig, TEST_CONFIG_DIR);

    await Promise.all([1, 2, 3, 4, 5].map((id) => registry.getOrCreate(id)));
    expect(registry.activeCount()).toBe(5);

    // 6th session triggers eviction of the LRU (chat 1)
    await registry.getOrCreate(6);
    expect(registry.activeCount()).toBe(5);
    expect(registry.get(1)).toBeUndefined();
    expect(registry.get(6)).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────────────
  // get
  // ──────────────────────────────────────────────────────────────────

  it('get returns session for known chatId', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    const created = await registry.getOrCreate(42);
    const retrieved = registry.get(42);

    expect(retrieved).toBe(created);
  });

  it('get returns undefined for unknown chatId', () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    expect(registry.get(999)).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────
  // abort
  // ──────────────────────────────────────────────────────────────────

  it('abort calls session.abort() for known chatId', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    const session = await registry.getOrCreate(42);

    registry.abort(42);

    expect(session.abort).toHaveBeenCalledTimes(1);
  });

  it('abort is a no-op for unknown chatId', () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);

    expect(() => registry.abort(999)).not.toThrow();
  });

  // ──────────────────────────────────────────────────────────────────
  // remove
  // ──────────────────────────────────────────────────────────────────

  it('remove deletes session and calls dispose', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    const session = await registry.getOrCreate(42);

    await registry.remove(42);

    expect(registry.activeCount()).toBe(0);
    expect(registry.get(42)).toBeUndefined();
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it('remove is a no-op for unknown chatId', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);

    await expect(registry.remove(999)).resolves.toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────
  // disposeAll
  // ──────────────────────────────────────────────────────────────────

  it('disposeAll removes all sessions and disposes each', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    const session1 = await registry.getOrCreate(1);
    const session2 = await registry.getOrCreate(2);
    const session3 = await registry.getOrCreate(3);

    await registry.disposeAll();

    expect(registry.activeCount()).toBe(0);
    expect(session1.dispose).toHaveBeenCalledTimes(1);
    expect(session2.dispose).toHaveBeenCalledTimes(1);
    expect(session3.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposeAll is a no-op for empty registry', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);

    await expect(registry.disposeAll()).resolves.toBeUndefined();
  });

  it('getOrCreate still works after disposeAll', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    const session1 = await registry.getOrCreate(1);

    await registry.disposeAll();
    expect(registry.activeCount()).toBe(0);

    // Creating a new session after disposeAll should work
    const session2 = await registry.getOrCreate(1);
    expect(session2).toBeDefined();
    expect(session2).not.toBe(session1);
    expect(registry.activeCount()).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────
  // activeCount / activeChatIds
  // ──────────────────────────────────────────────────────────────────

  it('activeCount returns 0 for empty registry', () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);

    expect(registry.activeCount()).toBe(0);
  });

  it('activeCount returns correct count after creation and removal', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    await registry.getOrCreate(1);
    await registry.getOrCreate(2);
    expect(registry.activeCount()).toBe(2);

    await registry.remove(1);
    expect(registry.activeCount()).toBe(1);

    await registry.remove(2);
    expect(registry.activeCount()).toBe(0);
  });

  it('activeChatIds returns array of chat IDs', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);
    await registry.getOrCreate(10);
    await registry.getOrCreate(20);
    await registry.getOrCreate(30);

    expect(registry.activeChatIds()).toEqual([10, 20, 30]);
  });

  it('activeChatIds returns empty array for empty registry', () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR);

    expect(registry.activeChatIds()).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────
  // Idle eviction
  // ──────────────────────────────────────────────────────────────────

  it('evicts idle sessions after idleTimeoutMs', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR, 1000);
    await registry.getOrCreate(42);

    expect(registry.activeCount()).toBe(1);

    // Advance time past idleTimeoutMs + eviction interval
    // Interval is Math.min(5min, idleTimeoutMs/2) = Math.min(300000, 500) = 500ms
    // First check at 500ms: 500 < 1000 → no eviction
    // Second check at 1000ms: 1000 >= 1000 → eviction
    vi.advanceTimersByTime(1500);

    expect(registry.activeCount()).toBe(0);
    expect(registry.get(42)).toBeUndefined();
    // dispose should NOT have been called — evictIdle deletes from map without disposing
    // (this is current implementation behaviour)
  });

  it('does not evict sessions still in use', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR, 1000);
    await registry.getOrCreate(42);

    // Advance partway (under idle timeout)
    vi.advanceTimersByTime(600);

    // Touch the session to refresh lastUsed
    registry.get(42);

    // Advance past the original deadline but not past the renewed one
    vi.advanceTimersByTime(500);
    // At t=1000ms the eviction check runs: lastUsed=600 → 1000-600=400 < 1000 → not evicted
    expect(registry.activeCount()).toBe(1);

    // Now advance past the renewed timeout
    vi.advanceTimersByTime(600);
    // At t=1500ms: 1500-600=900 < 1000 → not evicted yet
    // At t=2000ms: 2000-600=1400 >= 1000 → evicted
    vi.advanceTimersByTime(1000);
    expect(registry.activeCount()).toBe(0);
  });

  it('getOrCreate also refreshes lastUsed, preventing eviction', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR, 500);
    await registry.getOrCreate(42);

    // Advance partially
    vi.advanceTimersByTime(300);
    // Re-access via getOrCreate
    await registry.getOrCreate(42);

    // Advance past original timeout
    vi.advanceTimersByTime(400);
    // lastUsed was 300, so 300+500=800. At t=700, 700-300=400 < 500 → not evicted
    expect(registry.activeCount()).toBe(1);

    // Now wait past the renewed timeout
    vi.advanceTimersByTime(400);
    // At t=1000: 1000-300=700 >= 500 → evicted
    expect(registry.activeCount()).toBe(0);
  });

  it('evicts multiple idle sessions', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR, 500);
    await registry.getOrCreate(1);
    await registry.getOrCreate(2);
    await registry.getOrCreate(3);

    vi.advanceTimersByTime(1000);

    expect(registry.activeCount()).toBe(0);
  });

  it('respects custom idleTimeoutMs', async () => {
    // Short timeout: 100ms
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR, 100);
    await registry.getOrCreate(42);

    // Advance just past 100ms
    // Interval = Math.min(300000, 50) = 50ms
    // At t=50ms: 50 < 100 → not evicted
    // At t=100ms: 100 >= 100 → evicted
    vi.advanceTimersByTime(150);

    expect(registry.activeCount()).toBe(0);
  });

  it('zero idleTimeoutMs disables eviction entirely', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR, 0);
    await registry.getOrCreate(42);

    // Advance far past any reasonable timeout
    vi.advanceTimersByTime(10_000);

    // Session should still exist since idleTimeoutMs <= 0 skips eviction loop start
    expect(registry.activeCount()).toBe(1);
  });

  it('disposeAll stops the eviction loop', async () => {
    const registry = createSessionRegistry(config, TEST_CONFIG_DIR, 1000);
    await registry.getOrCreate(42);

    await registry.disposeAll();
    expect(registry.activeCount()).toBe(0);

    // Create a new session after disposeAll (eviction loop is stopped)
    await registry.getOrCreate(42);
    expect(registry.activeCount()).toBe(1);

    // Advance time — no eviction should occur since the loop was stopped
    vi.advanceTimersByTime(5000);
    expect(registry.activeCount()).toBe(1);
  });
});
