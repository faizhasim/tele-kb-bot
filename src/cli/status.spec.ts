/**
 * Tests for the status command.
 */

import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CLIOptions } from './main';

// ─── Hoisted mocks (available in vi.mock factories) ─────────────────

const { mockExistsSync, mockGetConfigSubdirs, mockLoadConfigSync, MockConfigValidationError, mockCreateCLILogger } =
  vi.hoisted(() => {
    const Cev = class extends Error {
      errors: string[];
      constructor({ errors }: { errors: string[] }) {
        super(errors.join(', '));
        this.errors = errors;
      }
    };

    return {
      mockExistsSync: vi.fn(),
      mockGetConfigSubdirs: vi.fn(),
      mockLoadConfigSync: vi.fn(),
      MockConfigValidationError: Cev,
      mockCreateCLILogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        level: 'silent',
      }),
    };
  });

// ─── Module mocks ───────────────────────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
}));

vi.mock('../config/loader', () => ({
  loadConfigSync: mockLoadConfigSync,
  ConfigValidationError: MockConfigValidationError,
}));

vi.mock('../config/paths', async () => {
  const actual = await vi.importActual<typeof import('../config/paths')>('../config/paths');
  return { ...actual, getConfigSubdirs: mockGetConfigSubdirs };
});

vi.mock('../logger', () => ({
  createCLILogger: mockCreateCLILogger,
}));

// ─── Module imports (after vi.mock) ─────────────────────────────────

import type { Config } from '../config/schema';
import { BINARY_NAME, VERSION } from '../constants';
import { statusCommand } from './status';

// ─── Helpers ────────────────────────────────────────────────────────

const TEST_CONFIG_DIR = '/tmp/test-tele-kb-bot-status';

const defaultOptions: CLIOptions = {
  command: 'status',
  configOverride: TEST_CONFIG_DIR,
  nonInteractive: false,
  rawArgs: ['status'],
};

const testSubdirs = {
  AGENTS: join(TEST_CONFIG_DIR, 'agents'),
  MEMORY: join(TEST_CONFIG_DIR, 'memory'),
  MEMORY_DAILY: join(TEST_CONFIG_DIR, 'memory', 'daily'),
  TELEGRAM_TMP: join(TEST_CONFIG_DIR, 'telegram-tmp'),
  LOGS: join(TEST_CONFIG_DIR, 'logs'),
};

function buildValidConfig(overrides?: Partial<Config>): Config {
  const defaults: Config = {
    telegram: {
      bot_token: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      allowed_user_ids: [42_311_999],
    },
    llm: {
      provider: 'opencode-go',
      model: 'deepseek-v4-flash',
      reasoning: 'high',
    },
    memory: {
      enabled: true,
      mode: 'ephemeral',
      auto_inject: true,
      search: { max_results: 5, mode: 'keyword' },
      cache: { max_entries: 100, max_size_bytes: 104_857_600 },
      qmd: { enabled: false, binary_path: 'qmd' },
    },
    bot: {
      max_attachments_per_turn: 10,
      streaming_preview: true,
      text_chunk_size: 4096,
    },
    vault_directories: [],
    system_prompt: undefined,
  };
  return overrides ? { ...defaults, ...overrides } : defaults;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('statusCommand', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.clearAllMocks();

    vi.spyOn(console, 'log').mockImplementation((...args) => {
      output += `${args.join(' ')}\n`;
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { first_name: 'TestBot', username: 'testbot' } })),
    );

    // Default mock implementations (overridable per test)
    mockGetConfigSubdirs.mockReturnValue(testSubdirs);
    mockLoadConfigSync.mockReturnValue({ config: buildValidConfig(), configDir: TEST_CONFIG_DIR, source: 'file' });
    mockExistsSync.mockImplementation((path: string) => {
      if (path === TEST_CONFIG_DIR) return true;
      if (path === join(TEST_CONFIG_DIR, 'config.yaml')) return true;
      if ((Object.values(testSubdirs) as string[]).includes(path)) return true;
      return false;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────
  // Basic output shape
  // ──────────────────────────────────────────────────────────────────

  it('shows binary name and version', async () => {
    await statusCommand(defaultOptions);
    expect(output).toContain(BINARY_NAME);
    expect(output).toContain(VERSION);
  });

  it('prints a separator line after the header', async () => {
    await statusCommand(defaultOptions);
    const lines = output.split('\n').filter(Boolean);
    const headerLine = lines.find((l) => l.trim().startsWith('='));
    expect(headerLine).toBeTruthy();
    expect(headerLine?.trim()).toHaveLength(40);
  });

  // ──────────────────────────────────────────────────────────────────
  // Config directory checks
  // ──────────────────────────────────────────────────────────────────

  it('shows message when config directory does not exist', async () => {
    // Override: always return false so config dir check fails
    mockExistsSync.mockImplementation(() => false);

    await statusCommand(defaultOptions);

    expect(output).toContain("Directory does not exist, run 'tele-kb-bot setup'");
    // Should NOT contain config file or Telegram sections
    expect(output).not.toContain('Config file:');
    expect(output).not.toContain('Telegram bot status:');
    // loadConfigSync should not have been called because function returns early
    expect(mockLoadConfigSync).not.toHaveBeenCalled();
  });

  it('shows subdirectory status when config dir exists', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === TEST_CONFIG_DIR) return true;
      if (path === join(TEST_CONFIG_DIR, 'config.yaml')) return false; // halt at config file check
      if ((Object.values(testSubdirs) as string[]).includes(path)) return true;
      return false;
    });

    await statusCommand(defaultOptions);

    // Each subdir key should appear with a ✓ (since all return true)
    for (const key of Object.keys(testSubdirs)) {
      expect(output).toContain(key);
    }
    expect(output).toContain('✓');
  });

  it('shows minus sign for missing subdirectories', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === TEST_CONFIG_DIR) return true;
      if (path === join(TEST_CONFIG_DIR, 'config.yaml')) return false;
      // Only AGENTS exists, rest don't
      if (path === testSubdirs.AGENTS) return true;
      if ((Object.values(testSubdirs) as string[]).includes(path)) return false;
      return false;
    });

    await statusCommand(defaultOptions);

    expect(output).toContain('AGENTS');
    expect(output).toContain('✓');
    expect(output).toContain('MEMORY');
    expect(output).toContain('−');
  });

  // ──────────────────────────────────────────────────────────────────
  // Config file checks
  // ──────────────────────────────────────────────────────────────────

  it('shows message when config file does not exist', async () => {
    // Override: 6 successes then 1 failure
    mockExistsSync
      .mockReturnValueOnce(true) // config dir
      .mockReturnValueOnce(true) // AGENTS
      .mockReturnValueOnce(true) // MEMORY
      .mockReturnValueOnce(true) // MEMORY_DAILY
      .mockReturnValueOnce(true) // TELEGRAM_TMP
      .mockReturnValueOnce(true) // LOGS
      .mockReturnValueOnce(false); // config.yaml

    await statusCommand(defaultOptions);

    expect(output).toContain("Not found. Run 'tele-kb-bot setup' first.");
    // Should NOT reach Telegram check
    expect(output).not.toContain('Telegram bot status:');
    // loadConfigSync should not have been called
    expect(mockLoadConfigSync).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // Full valid status
  // ──────────────────────────────────────────────────────────────────

  it('shows config file path and validation source', async () => {
    await statusCommand(defaultOptions);

    expect(output).toContain(join(TEST_CONFIG_DIR, 'config.yaml'));
    expect(output).toContain('Config valid (source: file)');
  });

  it('shows provider, model, reasoning, allowed users, and memory status', async () => {
    await statusCommand(defaultOptions);

    expect(output).toContain('opencode-go');
    expect(output).toContain('deepseek-v4-flash');
    expect(output).toContain('Reasoning: high');
    expect(output).toContain('42311999');
    expect(output).toContain('Memory: enabled');
  });

  it('shows Telegram bot connected status', async () => {
    await statusCommand(defaultOptions);

    expect(output).toContain('Connected as: TestBot');
    expect(output).toContain('@testbot');
  });

  it('produces complete valid status output', async () => {
    await statusCommand(defaultOptions);

    // Structural sections
    expect(output).toContain('Binary information:');
    expect(output).toContain('Version:');
    expect(output).toContain('Config directory:');
    expect(output).toContain('Config file:');
    expect(output).toContain('Telegram bot status:');

    // Key data points
    expect(output).toContain(BINARY_NAME);
    expect(output).toContain(VERSION);
    expect(output).toContain('✓');
    expect(output).toContain(TEST_CONFIG_DIR);

    // Should not contain error indicators
    expect(output).not.toContain('✗');
    expect(output).not.toContain('⚠');
  });

  // ──────────────────────────────────────────────────────────────────
  // Telegram API scenarios
  // ──────────────────────────────────────────────────────────────────

  it('shows API error when Telegram getMe returns error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: 'Unauthorized' })),
    );

    await statusCommand(defaultOptions);

    expect(output).toContain('API error');
    expect(output).toContain('Unauthorized');
  });

  it('handles network error during Telegram API check gracefully', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    await statusCommand(defaultOptions);

    expect(output).toContain('⚠');
    expect(output).toContain('Network error checking bot token');
  });

  it('shows not-configured message when bot token is empty', async () => {
    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig({ telegram: { bot_token: '', allowed_user_ids: [] } }),
      configDir: TEST_CONFIG_DIR,
      source: 'file',
    });

    await statusCommand(defaultOptions);

    expect(output).toContain('Not configured (no bot token)');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // Error scenarios
  // ──────────────────────────────────────────────────────────────────

  it('shows validation errors when loadConfigSync throws ConfigValidationError', async () => {
    mockLoadConfigSync.mockImplementation(() => {
      throw new MockConfigValidationError({
        errors: ['telegram.bot_token: Required', 'telegram.allowed_user_ids: At least one user ID is required.'],
      });
    });

    await statusCommand(defaultOptions);

    expect(output).toContain('Validation errors:');
    expect(output).toContain('telegram.bot_token: Required');
    expect(output).toContain('telegram.allowed_user_ids: At least one user ID is required.');
  });

  it('shows generic error message for unexpected exceptions', async () => {
    mockLoadConfigSync.mockImplementation(() => {
      throw new Error('Unexpected crash');
    });

    await statusCommand(defaultOptions);

    expect(output).toContain('Error:');
    expect(output).toContain('Unexpected crash');
  });

  it('shows correct source label for env-only config', async () => {
    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig(),
      configDir: TEST_CONFIG_DIR,
      source: 'env-only',
    });

    await statusCommand(defaultOptions);

    expect(output).toContain('Config valid (source: env-only)');
  });

  it('displays bot information when username is absent', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { first_name: 'SimpleBot' } })),
    );

    await statusCommand(defaultOptions);

    expect(output).toContain('Connected as: SimpleBot');
    // Should not try to display @username
    expect(output).not.toContain('(@)');
  });

  it('shows memory disabled status', async () => {
    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig({ memory: { ...buildValidConfig().memory, enabled: false } }),
      configDir: TEST_CONFIG_DIR,
      source: 'file',
    });

    await statusCommand(defaultOptions);

    expect(output).toContain('Memory: disabled');
  });
});
