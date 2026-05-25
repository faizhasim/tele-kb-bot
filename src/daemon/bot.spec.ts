/**
 * Tests for the daemon bot module.
 *
 * Bot controller is a factory function (createBotController) that wraps
 * a grammy Bot instance with pi session integration, message routing,
 * typing indicators, and chunked response sending.
 *
 * @module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config/schema';
import type { SessionRegistry } from './session-registry';

// ─── Hoisted helpers (available in vi.mock factories) ────────────────

const {
  botConstructorArgs,
  mockBot,
  mockCreateCLILogger,
  mockBuildMemoryContext,
  mockReadMemorySync,
  mockReadScratchpadSync,
  mockSplitIntoChunks,
} = vi.hoisted(() => {
  const botConstructorArgs: Array<string> = [];
  const mockBot = {
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    catch: vi.fn().mockReturnThis(),
    api: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
    },
  };

  return {
    botConstructorArgs,
    mockBot,
    mockCreateCLILogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    }),
    mockBuildMemoryContext: vi.fn().mockReturnValue(''),
    mockReadMemorySync: vi.fn().mockReturnValue(''),
    mockReadScratchpadSync: vi.fn().mockReturnValue(''),
    mockSplitIntoChunks: vi.fn().mockImplementation((text: string) => [text]),
  };
});

// ─── Module mocks ───────────────────────────────────────────────────

vi.mock('grammy', () => {
  // Regular function so `new Bot()` works (returns the shared mockBot object)
  function Bot(token: string) {
    botConstructorArgs.push(token);
    return mockBot;
  }
  return { Bot };
});

vi.mock('../logger', () => ({
  createCLILogger: mockCreateCLILogger,
}));

vi.mock('../memory/context', () => ({
  buildMemoryContext: mockBuildMemoryContext,
}));

vi.mock('../memory/manager', () => ({
  readMemorySync: mockReadMemorySync,
  readScratchpadSync: mockReadScratchpadSync,
}));

vi.mock('../telegram/chunking', () => ({
  splitIntoChunks: mockSplitIntoChunks,
}));

// ─── Module imports (after all vi.mock calls) ─────────────────────

import { createBotController } from './bot';

// ─── Test helpers ───────────────────────────────────────────────────

function buildTestConfig(overrides?: { unauthorized?: boolean }): Config {
  return {
    telegram: {
      bot_token: 'test:token',
      allowed_user_ids: overrides?.unauthorized ? [99_999] : [12_345],
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
    },
    vault_directories: [],
    system_prompt: undefined,
  };
}

/**
 * Build a mock session whose `prompt` fires the agent_end subscription
 * callback so the internal responsePromise resolves.
 */
function buildMockSession() {
  let subscribeCallback: ((event: Record<string, unknown>) => void) | null = null;

  const session = {
    prompt: vi.fn().mockImplementation(async () => {
      if (subscribeCallback) {
        subscribeCallback({
          type: 'agent_end',
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Hello from AI' }],
            },
          ],
        });
      }
    }),
    abort: vi.fn(),
    subscribe: vi.fn().mockImplementation((cb: (event: Record<string, unknown>) => void) => {
      subscribeCallback = cb;
      return vi.fn();
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue({}),
  };

  return session;
}

function createMockRegistry(session = buildMockSession()): SessionRegistry {
  return {
    getOrCreate: vi.fn().mockResolvedValue(session),
    get: vi.fn(),
    abort: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    disposeAll: vi.fn().mockResolvedValue(undefined),
    activeCount: vi.fn().mockReturnValue(0),
    activeChatIds: vi.fn().mockReturnValue([]),
  };
}

function createMockContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    from: { id: 12_345, is_bot: false, first_name: 'Test' },
    chat: { id: 67_890, type: 'private' },
    message: {
      message_id: 1,
      date: Date.now(),
      text: 'Hello',
      chat: { id: 67_890 },
      from: { id: 12_345 },
    },
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('createBotController', () => {
  let config: Config;
  let registry: SessionRegistry;

  beforeEach(() => {
    config = buildTestConfig();
    registry = createMockRegistry();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────
  // Factory / construction
  // ──────────────────────────────────────────────────────────────────

  describe('factory', () => {
    it('creates a grammy Bot with the correct token', () => {
      createBotController(config, registry);

      expect(botConstructorArgs).toEqual(['test:token']);
    });

    it('registers message handlers for text, photo, document, and voice', () => {
      createBotController(config, registry);

      expect(mockBot.on).toHaveBeenCalledWith(':text', expect.any(Function));
      expect(mockBot.on).toHaveBeenCalledWith(':photo', expect.any(Function));
      expect(mockBot.on).toHaveBeenCalledWith(':document', expect.any(Function));
      expect(mockBot.on).toHaveBeenCalledWith(':voice', expect.any(Function));
      expect(mockBot.on).toHaveBeenCalledTimes(4);
    });

    it('registers an error handler via bot.catch', () => {
      createBotController(config, registry);

      expect(mockBot.catch).toHaveBeenCalledTimes(1);
      expect(mockBot.catch).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() calls bot.start with drop_pending_updates', async () => {
      const controller = createBotController(config, registry);

      await controller.start();

      expect(mockBot.start).toHaveBeenCalledTimes(1);
      expect(mockBot.start).toHaveBeenCalledWith({
        onStart: expect.any(Function),
        drop_pending_updates: true,
      });
    });

    it('stop() calls bot.stop', async () => {
      const controller = createBotController(config, registry);

      await controller.stop();

      expect(mockBot.stop).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // :text handler routing
  // ──────────────────────────────────────────────────────────────────

  describe(':text handler', () => {
    function getTextHandler(): (ctx: Record<string, unknown>) => Promise<void> {
      const call = mockBot.on.mock.calls.find((c) => c[0] === ':text');
      expect(call).toBeDefined();
      return call?.[1] as (ctx: Record<string, unknown>) => Promise<void>;
    }

    it('replies to /start command for allowed users', async () => {
      createBotController(config, registry);
      const handler = getTextHandler();
      const ctx = createMockContext({ message: { text: '/start' } });

      await handler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Hello'));
      // Should not create a session for a simple /start reply
      expect(registry.getOrCreate).not.toHaveBeenCalled();
    });

    it('does not reply to /start for unauthorized users', async () => {
      const unauthConfig = buildTestConfig({ unauthorized: true });
      createBotController(unauthConfig, registry);
      const handler = getTextHandler();
      const ctx = createMockContext({
        from: { id: 12_345, is_bot: false, first_name: 'Test' },
        message: { text: '/start' },
      });

      await handler(ctx);

      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it('calls registry.abort and replies for /stop command', async () => {
      createBotController(config, registry);
      const handler = getTextHandler();
      const ctx = createMockContext({ message: { text: '/stop' } });

      await handler(ctx);

      expect(registry.abort).toHaveBeenCalledWith(67_890);
      expect(ctx.reply).toHaveBeenCalledWith('Stopped.');
    });

    it('processes a regular text message through the session', async () => {
      const session = buildMockSession();
      const reg = createMockRegistry(session);
      createBotController(config, reg);
      const handler = getTextHandler();
      const ctx = createMockContext({ message: { text: 'Hello bot!' } });

      await handler(ctx);

      // Typing indicator was started
      expect(mockBot.api.sendChatAction).toHaveBeenCalledWith(67_890, 'typing');

      // Session was created and prompted
      expect(reg.getOrCreate).toHaveBeenCalledWith(67_890);
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('[telegram-kb] Hello bot!'));

      // Response was sent via Telegram API
      expect(mockSplitIntoChunks).toHaveBeenCalledWith('Hello from AI');
      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(67_890, 'Hello from AI', {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    });

    it('sends "Done — no text response." when assistant content is empty', async () => {
      let cb: ((event: Record<string, unknown>) => void) | null = null;
      const session = {
        prompt: vi.fn().mockImplementation(async () => {
          if (cb) {
            cb({
              type: 'agent_end',
              messages: [{ role: 'assistant', content: [] }],
            });
          }
        }),
        abort: vi.fn(),
        subscribe: vi.fn().mockImplementation((fn: (event: Record<string, unknown>) => void) => {
          cb = fn;
          return vi.fn();
        }),
        dispose: vi.fn().mockResolvedValue(undefined),
        getState: vi.fn().mockReturnValue({}),
      };
      const reg = createMockRegistry(session as ReturnType<typeof buildMockSession>);
      createBotController(config, reg);
      const handler = getTextHandler();
      const ctx = createMockContext({ message: { text: 'empty please' } });

      await handler(ctx);

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
        67_890,
        'Done — no text response. Check the bot logs for details.',
      );
    });

    it('recovers when session.prompt throws', async () => {
      const session = {
        prompt: vi.fn().mockRejectedValue(new Error('session crashed')),
        abort: vi.fn(),
        subscribe: vi.fn().mockReturnValue(vi.fn()),
        dispose: vi.fn().mockResolvedValue(undefined),
        getState: vi.fn().mockReturnValue({}),
      };
      const reg = createMockRegistry(session as unknown as ReturnType<typeof buildMockSession>);
      createBotController(config, reg);
      const handler = getTextHandler();
      const ctx = createMockContext({ message: { text: 'crash test' } });

      await handler(ctx);

      // Should send an error message to the user
      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(67_890, 'Sorry, an error occurred.');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Photo / Document / Voice handler routing
  // ──────────────────────────────────────────────────────────────────

  describe('media handlers', () => {
    function getHandler(filter: string): (ctx: Record<string, unknown>) => Promise<void> {
      const call = mockBot.on.mock.calls.find((c) => c[0] === filter);
      expect(call, `Handler for ${filter} not registered`).toBeDefined();
      return call?.[1] as (ctx: Record<string, unknown>) => Promise<void>;
    }

    it.each([
      ':photo',
      ':document',
      ':voice',
    ] as const)('%s handler processes messages for allowed users', async (filter) => {
      const session = buildMockSession();
      const reg = createMockRegistry(session);
      createBotController(config, reg);
      const handler = getHandler(filter);
      const ctx = createMockContext({
        message: {
          message_id: 2,
          date: Date.now(),
          caption: 'Media caption',
          chat: { id: 67_890 },
          from: { id: 12_345 },
        },
      });

      await handler(ctx);

      // Typing indicator was started
      expect(mockBot.api.sendChatAction).toHaveBeenCalledWith(67_890, 'typing');
      // Session was prompted with the caption text
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('[telegram-kb] Media caption'));
    });

    it.each([':photo', ':document', ':voice'] as const)('%s handler skips unauthorized users', async (filter) => {
      const unauthConfig = buildTestConfig({ unauthorized: true });
      createBotController(unauthConfig, registry);
      const handler = getHandler(filter);
      const ctx = createMockContext({
        from: { id: 12_345, is_bot: false, first_name: 'Test' },
        message: {
          caption: 'Should be ignored',
          chat: { id: 67_890 },
          from: { id: 12_345 },
        },
      });

      await handler(ctx);

      // No typing indicator, no session lookup
      expect(mockBot.api.sendChatAction).not.toHaveBeenCalled();
      expect(registry.getOrCreate).not.toHaveBeenCalled();
    });
  });
});
