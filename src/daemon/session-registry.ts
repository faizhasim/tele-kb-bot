/**
 * Session registry for tele-kb-bot.
 *
 * Factory function that creates a per-chat session manager.
 * Each chat gets its own isolated pi AgentSession with lazy creation,
 * idle eviction (30 min default), and a hard pool cap.
 *
 * Pool limit (config.bot.max_sessions, default 5):
 * When getOrCreate is called at capacity, the least-recently-used session
 * is evicted (disposed) before the new one is created.
 *
 * @module
 */

import type { AgentSession } from '@mariozechner/pi-coding-agent';
import type { Config } from '../config/schema';
import { createCLILogger } from '../logger';
import { createPiSession } from '../pi/session-factory';

/** Default idle timeout in milliseconds (30 minutes). */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Eviction check interval in milliseconds (5 minutes). */
const EVICTION_INTERVAL_MS = 5 * 60 * 1000;

interface SessionEntry {
  readonly session: AgentSession;
  readonly chatId: number;
  lastUsed: number;
  readonly createdAt: number;
}

interface SessionRegistry {
  readonly getOrCreate: (chatId: number) => Promise<AgentSession>;
  readonly get: (chatId: number) => AgentSession | undefined;
  readonly abort: (chatId: number) => void;
  readonly remove: (chatId: number) => Promise<void>;
  readonly disposeAll: () => Promise<void>;
  readonly activeCount: () => number;
  readonly activeChatIds: () => Array<number>;
}

/**
 * Create a new session registry.
 * Closes over its state — no class needed.
 */
const createSessionRegistry = (
  config: Config,
  configDir: string,
  idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
): SessionRegistry => {
  const log = createCLILogger('tele-kb-bot');
  const sessions = new Map<number, SessionEntry>();
  let disposed = false;
  let evictionTimer: ReturnType<typeof setInterval> | null = null;

  const startEvictionLoop = (): void => {
    if (idleTimeoutMs <= 0) return;
    evictionTimer = setInterval(
      () => {
        evictIdle().catch((err: unknown) => {
          log.warn({ err }, 'Error during session idle eviction');
        });
      },
      Math.min(EVICTION_INTERVAL_MS, idleTimeoutMs / 2),
    );
  };

  const stopEvictionLoop = (): void => {
    if (evictionTimer) {
      clearInterval(evictionTimer);
      evictionTimer = null;
    }
  };

  const evictIdle = async (): Promise<void> => {
    if (disposed) return;
    const now = Date.now();
    const evictChatIds: Array<number> = [];
    for (const [chatId, entry] of sessions) {
      if (now - entry.lastUsed >= idleTimeoutMs) {
        evictChatIds.push(chatId);
      }
    }
    if (evictChatIds.length === 0) return;
    log.debug({ chatIds: evictChatIds, count: evictChatIds.length }, 'Evicting idle sessions');
    // Use remove (via the outer scope)
    for (const chatId of evictChatIds) {
      sessions.delete(chatId);
    }
  };

  const getOrCreate = async (chatId: number): Promise<AgentSession> => {
    const existing = sessions.get(chatId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.session;
    }

    // Pool limit: evict the LRU session when at capacity
    const maxSessions = config.bot.max_sessions ?? 5;
    if (sessions.size >= maxSessions) {
      let lruChatId: number | null = null;
      let lruTime = Infinity;
      for (const [id, entry] of sessions) {
        if (entry.lastUsed < lruTime) {
          lruTime = entry.lastUsed;
          lruChatId = id;
        }
      }
      if (lruChatId !== null) {
        log.info({ chatId: lruChatId, reason: 'pool_limit' }, 'Evicting LRU session to stay within pool limit');
        sessions.delete(lruChatId);
      }
    }

    log.info({ chatId }, 'Creating new pi session for chat');
    const session = await createPiSession(config, configDir);
    sessions.set(chatId, {
      session,
      chatId,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    });
    return session;
  };

  const get = (chatId: number): AgentSession | undefined => {
    const entry = sessions.get(chatId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.session;
    }
    return undefined;
  };

  const abort = (chatId: number): void => {
    const entry = sessions.get(chatId);
    if (entry) {
      try {
        entry.session.abort();
        log.debug({ chatId }, 'Aborted session turn');
      } catch (err) {
        log.warn({ err, chatId }, 'Failed to abort session turn');
      }
    }
  };

  const remove = async (chatId: number): Promise<void> => {
    const entry = sessions.get(chatId);
    if (entry) {
      sessions.delete(chatId);
      try {
        await entry.session.dispose();
      } catch (err) {
        log.warn({ err, chatId }, 'Error disposing session');
      }
    }
  };

  const disposeAll = async (): Promise<void> => {
    disposed = true;
    stopEvictionLoop();
    const disposals: Array<Promise<void>> = [];
    for (const chatId of sessions.keys()) {
      disposals.push(remove(chatId));
    }
    await Promise.all(disposals);
    sessions.clear();
    log.info('All sessions disposed');
  };

  const activeCount = (): number => sessions.size;
  const activeChatIds = (): Array<number> => [...sessions.keys()];

  // Start eviction
  startEvictionLoop();

  return {
    getOrCreate,
    get,
    abort,
    remove,
    disposeAll,
    activeCount,
    activeChatIds,
  };
};

export type { SessionRegistry };
export { createSessionRegistry };
