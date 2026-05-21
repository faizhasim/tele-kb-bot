/**
 * Tests for the Telegram streaming manager.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StreamingManager, startStreaming, logResponseTiming } from './streaming';

// ─── Mock Logger ──────────────────────────────────────────────────

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../logger', () => ({
  getLogger: () => mockLogger,
}));

// ─── Mocks ─────────────────────────────────────────────────────────

const mockSendChatAction = vi.fn().mockResolvedValue(undefined);
const mockClient = { sendChatAction: mockSendChatAction } as any;
const chatId = 12345;

// ─── Tests ─────────────────────────────────────────────────────────

describe('StreamingManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSendChatAction.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('stores client and chatId', () => {
      const manager = new StreamingManager(mockClient, chatId);

      expect(manager).toBeInstanceOf(StreamingManager);
      expect(manager.isActive).toBe(false);
      expect(manager.elapsedMs).toBe(0);
    });
  });

  describe('start()', () => {
    it('marks isActive true, sends initial typing, sets interval', () => {
      const manager = new StreamingManager(mockClient, chatId);
      manager.start();

      expect(manager.isActive).toBe(true);

      // Initial typing sent immediately
      expect(mockSendChatAction).toHaveBeenCalledTimes(1);
      expect(mockSendChatAction).toHaveBeenCalledWith(chatId, 'typing');

      // Advance time past TYPING_INTERVAL_MS (4000ms)
      vi.advanceTimersByTime(4000);
      expect(mockSendChatAction).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(4000);
      expect(mockSendChatAction).toHaveBeenCalledTimes(3);
    });

    it('is idempotent (calling twice does not reset interval)', () => {
      const manager = new StreamingManager(mockClient, chatId);
      manager.start();
      expect(mockSendChatAction).toHaveBeenCalledTimes(1);

      // Second call — should be a no-op
      manager.start();
      expect(mockSendChatAction).toHaveBeenCalledTimes(1);

      // Advance time — should fire on the original schedule
      vi.advanceTimersByTime(4000);
      expect(mockSendChatAction).toHaveBeenCalledTimes(2);
    });
  });

  describe('stop()', () => {
    it('marks isActive false, clears interval', () => {
      const manager = new StreamingManager(mockClient, chatId);
      manager.start();
      expect(manager.isActive).toBe(true);

      manager.stop();
      expect(manager.isActive).toBe(false);
      expect(manager.elapsedMs).toBe(0);

      // Advance time — no further typing actions should fire
      vi.advanceTimersByTime(10000);
      expect(mockSendChatAction).toHaveBeenCalledTimes(1);
    });

    it('is idempotent', () => {
      const manager = new StreamingManager(mockClient, chatId);
      manager.start();
      manager.stop();
      expect(manager.isActive).toBe(false);

      // Second stop should not throw
      expect(() => manager.stop()).not.toThrow();
      expect(manager.isActive).toBe(false);
    });

    it('does not throw when called before start()', () => {
      const manager = new StreamingManager(mockClient, chatId);
      expect(() => manager.stop()).not.toThrow();
      expect(manager.isActive).toBe(false);
    });
  });

  describe('elapsedMs', () => {
    it('returns 0 when not active', () => {
      const manager = new StreamingManager(mockClient, chatId);
      expect(manager.elapsedMs).toBe(0);
    });

    it('returns elapsed time when active', () => {
      const manager = new StreamingManager(mockClient, chatId);
      manager.start();

      vi.advanceTimersByTime(1500);
      expect(manager.elapsedMs).toBe(1500);

      vi.advanceTimersByTime(2500);
      expect(manager.elapsedMs).toBe(4000);
    });

    it('returns 0 after stop', () => {
      const manager = new StreamingManager(mockClient, chatId);
      manager.start();
      vi.advanceTimersByTime(1000);
      expect(manager.elapsedMs).toBe(1000);

      manager.stop();
      expect(manager.elapsedMs).toBe(0);
    });
  });
});

describe('logResponseTiming', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSendChatAction.mockClear();
    mockLogger.info.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs elapsed time', () => {
    const manager = new StreamingManager(mockClient, chatId);
    manager.start();
    vi.advanceTimersByTime(3000);

    logResponseTiming(chatId, manager);

    expect(mockLogger.info).toHaveBeenCalledWith({ chatId, elapsedMs: 3000 }, 'Response completed in 3.0s');
  });

  it('logs 0.0s when called before start', () => {
    const manager = new StreamingManager(mockClient, chatId);

    logResponseTiming(chatId, manager);

    expect(mockLogger.info).toHaveBeenCalledWith({ chatId, elapsedMs: 0 }, 'Response completed in 0.0s');
  });
});

describe('startStreaming', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSendChatAction.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates, starts, and returns a StreamingManager', () => {
    const manager = startStreaming(mockClient, chatId);

    expect(manager).toBeInstanceOf(StreamingManager);
    expect(manager.isActive).toBe(true);
    expect(mockSendChatAction).toHaveBeenCalledTimes(1);
  });
});
