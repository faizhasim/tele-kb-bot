/**
 * Tests for the pi SDK session factory.
 *
 * Covers getMemoryContext singleton caching and createPiSession wiring:
 * auth storage, model registry, settings manager, memory context,
 * extension factories, system prompt, service creation, model resolution,
 * session creation, custom cwd, and logging.
 *
 * @module
 */

import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted Mock References ──────────────────────────────────────
// These must be hoisted so they are available inside vi.mock() factories.

const {
  mockAuthStorage,
  mockModelRegistryInstance,
  mockModelRegistry,
  mockSettingsManager,
  mockSessionManager,
  mockCreateAgentSessionServices,
  mockCreateAgentSessionFromServices,
  mockCreateMemoryContext,
  mockCreateExtensionFactories,
  mockLogger,
  mockBuildSystemPrompt,
} = vi.hoisted(() => {
  const regInstance = {
    refresh: vi.fn(),
    find: vi.fn().mockReturnValue({ id: 'test-model', provider: 'test' }),
  };

  return {
    mockAuthStorage: {
      create: vi.fn().mockReturnValue({
        reload: vi.fn(),
        getAll: vi.fn().mockReturnValue({}),
        get: vi.fn(),
      }),
    },
    mockModelRegistryInstance: regInstance,
    mockModelRegistry: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: vi.fn().mockReturnValue(regInstance as any),
    },
    mockSettingsManager: { create: vi.fn().mockReturnValue({}) },
    mockSessionManager: { create: vi.fn().mockReturnValue({}) },
    mockCreateAgentSessionServices: vi.fn().mockResolvedValue({}),
    mockCreateAgentSessionFromServices: vi.fn().mockResolvedValue({
      session: { id: 'test-session' },
    }),
    mockCreateMemoryContext: vi.fn().mockImplementation(async (_config: unknown, configDir: string) => ({
      backend: {
        isAvailable: vi.fn().mockReturnValue(true),
        search: vi.fn().mockResolvedValue([] as never[]),
        rebuildIndex: vi.fn().mockResolvedValue(undefined),
      },
      configDir,
    })),
    mockCreateExtensionFactories: vi.fn().mockReturnValue([vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()]),
    mockLogger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    mockBuildSystemPrompt: vi.fn().mockReturnValue('test system prompt'),
  };
});

// ─── Module Mocks ─────────────────────────────────────────────────

vi.mock('@mariozechner/pi-coding-agent', () => ({
  AuthStorage: mockAuthStorage,
  ModelRegistry: mockModelRegistry,
  SessionManager: mockSessionManager,
  SettingsManager: mockSettingsManager,
  createAgentSessionServices: mockCreateAgentSessionServices,
  createAgentSessionFromServices: mockCreateAgentSessionFromServices,
}));

vi.mock('../memory/manager', () => ({
  createMemoryContext: mockCreateMemoryContext,
}));

vi.mock('./extensions', () => ({
  createExtensionFactories: mockCreateExtensionFactories,
}));

vi.mock('../logger', () => ({
  getLogger: () => mockLogger,
}));

vi.mock('../constants/system-prompt', () => ({
  buildSystemPrompt: mockBuildSystemPrompt,
}));

// ─── Module Imports (after vi.mock) ───────────────────────────────

import {
  AuthStorage,
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRegistry,
  SettingsManager,
} from '@mariozechner/pi-coding-agent';
import type { Config } from '../config/schema';
import { buildSystemPrompt } from '../constants/system-prompt';
import { createMemoryContext } from '../memory/manager';
import { createExtensionFactories } from './extensions';
import { createPiSession } from './session-factory';

// ─── Fixtures ─────────────────────────────────────────────────────

const baseConfig: Config = {
  telegram: { bot_token: 'test-token', allowed_user_ids: [12345] },
  llm: { provider: 'opencode-go', model: 'deepseek-v4-flash', reasoning: 'high' },
  memory: {
    enabled: true,
    mode: 'ephemeral',
    auto_inject: true,
    search: { max_results: 5, mode: 'keyword' },
    cache: { max_entries: 100, max_size_bytes: 104_857_600 },
    qmd: { enabled: false, binary_path: 'qmd' },
  },
  bot: { max_attachments_per_turn: 10, streaming_preview: true, text_chunk_size: 4096 },
  vault_directories: ['/vault1', '/vault2'],
  system_prompt: undefined,
};

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Ensure the mockModelRegistryInstance.find returns a truthy value
 * after tests that temporarily override it.
 */
function resetModelRegistryFind(): void {
  mockModelRegistryInstance.find.mockReturnValue({ id: 'test-model', provider: 'test' });
}

// ─── Tests ────────────────────────────────────────────────────────

describe('getMemoryContext (singleton)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetModelRegistryFind();
  });

  it('creates a new memory context on first call with a configDir, caches on repeat, and creates again on different configDir', async () => {
    const configDirA = '/tmp/test-cache-a';
    const configDirB = '/tmp/test-cache-b';

    // First call with configDir A → createMemoryContext is called
    await createPiSession(baseConfig, configDirA);
    expect(createMemoryContext).toHaveBeenCalledTimes(1);
    expect(createMemoryContext).toHaveBeenCalledWith(baseConfig, configDirA);

    // Second call with the same configDir A → cached, createMemoryContext NOT called again
    await createPiSession(baseConfig, configDirA);
    expect(createMemoryContext).toHaveBeenCalledTimes(1);

    // Call with a different configDir B → creates a new context
    await createPiSession(baseConfig, configDirB);
    expect(createMemoryContext).toHaveBeenCalledTimes(2);
    expect(createMemoryContext).toHaveBeenCalledWith(baseConfig, configDirB);
  });
});

describe('createPiSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetModelRegistryFind();
  });

  // ── Auth Storage ───────────────────────────────────────────────

  it('creates auth storage at the correct path and calls reload', async () => {
    const dir = '/tmp/test-auth-storage';

    await createPiSession(baseConfig, dir);

    expect(AuthStorage.create).toHaveBeenCalledWith(join(dir, 'agents', 'auth.json'));

    // The auth storage instance returned by AuthStorage.create should have reload called
    const instance = (AuthStorage.create as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(instance.reload).toHaveBeenCalledOnce();
  });

  // ── Model Registry ─────────────────────────────────────────────

  it('creates model registry with auth storage and models.json path, then calls refresh', async () => {
    const dir = '/tmp/test-model-registry';

    await createPiSession(baseConfig, dir);

    expect(ModelRegistry.create).toHaveBeenCalledWith(
      expect.objectContaining({ reload: expect.any(Function) }),
      join(dir, 'agents', 'models.json'),
    );

    const instance = (ModelRegistry.create as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(instance.refresh).toHaveBeenCalledOnce();
  });

  // ── Settings Manager ───────────────────────────────────────────

  it('creates settings manager with cwd and agentDir', async () => {
    const dir = '/tmp/test-settings';

    await createPiSession(baseConfig, dir);

    expect(SettingsManager.create).toHaveBeenCalledWith(dir, join(dir, 'agents'));
  });

  // ── Memory Context ─────────────────────────────────────────────

  it('calls getMemoryContext (via createMemoryContext) and wires extension factories', async () => {
    const dir = '/tmp/test-memory-ctx';

    await createPiSession(baseConfig, dir);

    expect(createMemoryContext).toHaveBeenCalledWith(baseConfig, dir);
    expect(createExtensionFactories).toHaveBeenCalledOnce();
  });

  // ── System Prompt ──────────────────────────────────────────────

  it('builds the system prompt from vault_directories and system_prompt config fields', async () => {
    const dir = '/tmp/test-system-prompt';

    await createPiSession(baseConfig, dir);

    expect(buildSystemPrompt).toHaveBeenCalledWith(baseConfig.vault_directories, baseConfig.system_prompt);
  });

  // ── Agent Session Services ─────────────────────────────────────

  it('calls createAgentSessionServices with all required options', async () => {
    const dir = '/tmp/test-services';

    await createPiSession(baseConfig, dir);

    expect(createAgentSessionServices).toHaveBeenCalledTimes(1);

    const args = (createAgentSessionServices as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

    expect(args).toBeDefined();
    expect(args?.cwd).toBe(dir);
    expect(args?.agentDir).toBe(join(dir, 'agents'));
    expect(args?.authStorage).toBeDefined();
    expect(args?.modelRegistry).toBeDefined();
    expect(args?.settingsManager).toBeDefined();

    // resourceLoaderOptions
    expect(args?.resourceLoaderOptions).toBeDefined();
    expect(args?.resourceLoaderOptions.extensionFactories).toHaveLength(5);
    expect(args?.resourceLoaderOptions.systemPrompt).toBe('test system prompt');
    expect(args?.resourceLoaderOptions.noExtensions).toBe(true);
    expect(args?.resourceLoaderOptions.noSkills).toBe(true);
    expect(args?.resourceLoaderOptions.noPromptTemplates).toBe(true);
    expect(args?.resourceLoaderOptions.noThemes).toBe(true);
  });

  // ── Model Resolution ───────────────────────────────────────────

  it('resolves the model by calling modelRegistry.find with provider and model from config', async () => {
    const dir = '/tmp/test-model-find';

    await createPiSession(baseConfig, dir);

    expect(mockModelRegistryInstance.find).toHaveBeenCalledWith('opencode-go', 'deepseek-v4-flash');
  });

  it('throws an error when modelRegistry.find returns null', async () => {
    const dir = '/tmp/test-model-missing';

    mockModelRegistryInstance.find.mockReturnValueOnce(null);

    await expect(createPiSession(baseConfig, dir)).rejects.toThrow(/Model/i);
  });

  // ── Session Creation ───────────────────────────────────────────

  it('calls createAgentSessionFromServices with services, sessionManager, model and thinkingLevel', async () => {
    const dir = '/tmp/test-session-create';

    await createPiSession(baseConfig, dir);

    expect(createAgentSessionFromServices).toHaveBeenCalledTimes(1);

    const args = (createAgentSessionFromServices as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

    expect(args).toBeDefined();
    expect(args?.services).toBeDefined();
    expect(args?.sessionManager).toBeDefined();
    expect(args?.model).toEqual({ id: 'test-model', provider: 'test' });
    expect(args?.thinkingLevel).toBe('high');
  });

  it('returns the AgentSession object with the expected id', async () => {
    const dir = '/tmp/test-session-return';

    const session = await createPiSession(baseConfig, dir);

    expect(session).toBeDefined();
    expect(session).toEqual({ id: 'test-session' });
  });

  // ── Custom CWD ─────────────────────────────────────────────────

  it('passes a custom cwd to SettingsManager.create without affecting other paths', async () => {
    const dir = '/tmp/test-custom-cwd';
    const customCwd = '/some/custom/path';

    await createPiSession(baseConfig, dir, customCwd);

    expect(SettingsManager.create).toHaveBeenCalledWith(customCwd, join(dir, 'agents'));

    expect(AuthStorage.create).toHaveBeenCalledWith(join(dir, 'agents', 'auth.json'));
    expect(ModelRegistry.create).toHaveBeenCalledWith(expect.any(Object), join(dir, 'agents', 'models.json'));
  });

  // ── Logging ────────────────────────────────────────────────────

  it('emits debug and info log messages during session creation', async () => {
    const dir = '/tmp/test-logging';

    await createPiSession(baseConfig, dir);

    expect(mockLogger.debug).toHaveBeenCalledWith({ agentDir: join(dir, 'agents') }, 'Creating pi SDK services');

    expect(mockLogger.info).toHaveBeenCalledWith(
      { model: 'deepseek-v4-flash', thinking: 'high' },
      'Creating pi session',
    );
  });
});
