/**
 * Tests for the daemon main module.
 *
 * Covers startDaemon() wiring: config loading, bot token verification,
 * controller/session registry creation, and signal handler setup.
 *
 * @module
 */

import { Context, Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mock references ──────────────────────────────────────

const {
  mockCreateCLILogger,
  mockLoadConfig,
  mockResolveConfigDir,
  mockEnsureConfigDirs,
  mockCreateBotController,
  mockCreateSessionRegistry,
  mockCreateMemoryContext,
  TEST_CONFIG_RESULT,
} = vi.hoisted(() => {
  const config = {
    telegram: { bot_token: 'test:token', allowed_user_ids: [12345] },
    llm: { provider: 'test-provider', model: 'test-model', reasoning: 'off' },
    memory: {
      enabled: false,
      mode: 'ephemeral',
      auto_inject: false,
      search: { max_results: 5, mode: 'keyword' },
      cache: { max_entries: 100, max_size_bytes: 1_000_000 },
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

  return {
    mockCreateCLILogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    }),
    mockLoadConfig: vi.fn().mockImplementation(() => {
      // We'll set the actual return value below via mockReturnValue
      return Effect.succeed({
        config,
        configDir: '/tmp/test',
        source: 'env-only',
      });
    }),
    mockResolveConfigDir: vi.fn().mockReturnValue('/tmp/test'),
    mockEnsureConfigDirs: vi.fn().mockImplementation(() => Effect.void),
    mockCreateBotController: vi.fn().mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }),
    mockCreateSessionRegistry: vi.fn().mockReturnValue({
      disposeAll: vi.fn().mockResolvedValue(undefined),
      activeCount: vi.fn().mockReturnValue(0),
      getOrCreate: vi.fn().mockResolvedValue({}),
    }),
    mockCreateMemoryContext: vi.fn().mockResolvedValue({
      backend: { isAvailable: vi.fn().mockReturnValue(true) },
      configDir: '/tmp/test/memory',
    }),
    TEST_CONFIG_RESULT: {
      config,
      configDir: '/tmp/test',
      source: 'env-only',
    },
  };
});

// ─── Module mocks ──────────────────────────────────────────────────

vi.mock('../config/loader', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('../config/paths', () => ({
  resolveConfigDir: mockResolveConfigDir,
  ensureConfigDirs: mockEnsureConfigDirs,
}));

vi.mock('../logger', () => {
  const MockLoggerTag = Context.GenericTag('@tele-kb-bot/logger');
  const mockLayer = vi.fn(() =>
    Layer.effect(
      MockLoggerTag,
      Effect.sync(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      })),
    ),
  );
  return {
    createCLILogger: mockCreateCLILogger,
    EffectLoggerLive: mockLayer,
    EffectLoggerLiveWithFile: mockLayer,
    createRollingLogWriter: vi.fn(),
    resolveLogFile: vi.fn(),
    createDaemonPinoLogger: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      level: 30,
    }),
  };
});

vi.mock('../memory/manager', () => ({
  createMemoryContext: mockCreateMemoryContext,
}));

vi.mock('./bot', () => ({
  createBotController: mockCreateBotController,
}));

vi.mock('./session-registry', () => ({
  createSessionRegistry: mockCreateSessionRegistry,
}));

// ─── Imports after vi.mock ────────────────────────────────────────

import { startDaemon } from './main';

// ─── Tests ────────────────────────────────────────────────────────

describe('startDaemon', () => {
  let onSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────
  // Bot token verification failure
  // ──────────────────────────────────────────────────────────────────

  it('exits with code 1 when bot token verification fails', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ ok: false, description: 'Invalid token' }),
      }),
    );

    await expect(startDaemon()).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // ──────────────────────────────────────────────────────────────────
  // Successful token verification
  // ──────────────────────────────────────────────────────────────────

  it('creates bot controller and session registry when token is valid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ ok: true, result: { first_name: 'TestBot' } }),
      }),
    );

    await startDaemon();

    expect(mockLoadConfig).toHaveBeenCalled();
    expect(mockCreateSessionRegistry).toHaveBeenCalled();
    expect(mockCreateBotController).toHaveBeenCalled();
    expect(mockCreateBotController.mock.results[0]?.value.start).toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // Signal handler setup
  // ──────────────────────────────────────────────────────────────────

  it('sets up signal handlers without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ ok: true, result: { first_name: 'TestBot' } }),
      }),
    );

    await expect(startDaemon()).resolves.toBeUndefined();

    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  // ──────────────────────────────────────────────────────────────────
  // Config is passed to session registry
  // ──────────────────────────────────────────────────────────────────

  it('passes config and configDir to createSessionRegistry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ ok: true, result: { first_name: 'TestBot' } }),
      }),
    );

    await startDaemon();

    expect(mockCreateSessionRegistry).toHaveBeenCalledWith(TEST_CONFIG_RESULT.config, TEST_CONFIG_RESULT.configDir);
  });

  it('passes config, registry, and memory context to createBotController', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ ok: true, result: { first_name: 'TestBot' } }),
      }),
    );

    await startDaemon();

    // First arg: config
    expect(mockCreateBotController).toHaveBeenCalledWith(
      TEST_CONFIG_RESULT.config,
      expect.any(Object), // session registry
      expect.objectContaining({
        backend: expect.objectContaining({ isAvailable: expect.any(Function) }),
      }), // memory context
    );
  });

  // ──────────────────────────────────────────────────────────────────
  // Signal handler behaviour
  // ──────────────────────────────────────────────────────────────────

  it('SIGINT triggers controller.stop and registry.disposeAll', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => undefined as never);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ ok: true, result: { first_name: 'TestBot' } }),
      }),
    );

    await startDaemon();

    // Extract the SIGINT handler — process.on is mocked, handlers stored in spy
    const sigintHandler = onSpy.mock.calls.find((call: unknown[]) => call[0] === 'SIGINT')?.[1] as () => void;
    expect(sigintHandler).toBeInstanceOf(Function);

    // Invoke the handler (calls async shutdown internally)
    sigintHandler();

    // Flush microtasks so the async shutdown completes
    await new Promise((resolve) => setTimeout(resolve, 10));

    const controller = mockCreateBotController.mock.results[0]?.value;
    const registry = mockCreateSessionRegistry.mock.results[0]?.value;

    expect(controller.stop).toHaveBeenCalledOnce();
    expect(registry.disposeAll).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('double SIGINT is idempotent (shuttingDown flag)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => undefined as never);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ ok: true, result: { first_name: 'TestBot' } }),
      }),
    );

    await startDaemon();

    const sigintHandler = onSpy.mock.calls.find((call: unknown[]) => call[0] === 'SIGINT')?.[1] as () => void;

    // Fire SIGINT twice — second call early-returns via shuttingDown flag
    sigintHandler();
    sigintHandler();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const controller = mockCreateBotController.mock.results[0]?.value;
    const registry = mockCreateSessionRegistry.mock.results[0]?.value;

    expect(controller.stop).toHaveBeenCalledOnce();
    expect(registry.disposeAll).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledOnce();
  });

  it('unhandledRejection logs error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ ok: true, result: { first_name: 'TestBot' } }),
      }),
    );

    await startDaemon();

    const rejectionHandler = onSpy.mock.calls.find((call: unknown[]) => call[0] === 'unhandledRejection')?.[1] as (
      reason: unknown,
    ) => void;
    expect(rejectionHandler).toBeInstanceOf(Function);

    const testError = new Error('test rejection');
    rejectionHandler(testError);

    // The logger is shared across createCLILogger calls via mockReturnValue
    const logger = mockCreateCLILogger.mock.results[0]?.value;
    expect(logger.error).toHaveBeenCalledWith({ err: testError }, 'Unhandled promise rejection');
  });

  it('uncaughtException logs error, console.errors, and exits with code 1', async () => {
    vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('process.exit');
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ ok: true, result: { first_name: 'TestBot' } }),
      }),
    );

    await startDaemon();

    const exceptionHandler = onSpy.mock.calls.find((call: unknown[]) => call[0] === 'uncaughtException')?.[1] as (
      err: Error,
    ) => void;
    expect(exceptionHandler).toBeInstanceOf(Function);

    const testError = new Error('fatal');
    expect(() => exceptionHandler(testError)).toThrow('process.exit');

    const logger = mockCreateCLILogger.mock.results[0]?.value;
    expect(logger.error).toHaveBeenCalledWith({ err: testError }, 'Uncaught exception');
    expect(consoleErrorSpy).toHaveBeenCalledWith('Fatal error:', 'fatal');
  });
});
