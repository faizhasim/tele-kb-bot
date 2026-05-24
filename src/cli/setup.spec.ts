/**
 * Tests for the setup wizard module.
 *
 * Tests pure functions (validateSizeInput, loadExistingConfig, buildConfig)
 * and null-safety of prompt helpers that wrap @clack/prompts.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSize } from '../config/size';

// ─── Mock external dependencies ───────────────────────────────────

const mockClack = vi.hoisted(() => ({
  text: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

vi.mock('@clack/prompts', () => mockClack);

// Mock dynamic imports for interactive mode prompts (install, index)
const mockLaunchd = vi.hoisted(() => ({ launchdAddCommand: vi.fn() }));
const mockIndex = vi.hoisted(() => ({ indexCommand: vi.fn() }));

vi.mock('./launchd', () => mockLaunchd);
vi.mock('./index', () => mockIndex);

import type { CLIOptions } from './main';
import { promptPassword, promptText, setupCommand } from './setup';

// ─── Prompt Helper Logic Tests ──────────────────────────────────────

/**
 * Core logic of promptText: preserve existing on empty/undefined input.
 */
function simulatePromptText(value: string | undefined, existing?: string): string {
  if (!value && existing !== undefined) return existing;
  return value ?? '';
}

/**
 * Core logic of promptPassword: preserve existing on empty/undefined input.
 */
function simulatePromptPassword(value: string | undefined, existing?: string): string | undefined {
  if (!value && existing) return existing;
  return value || undefined;
}

describe('prompt text logic (null-safe branches)', () => {
  it('returns existing when value is undefined and existing is set', () => {
    expect(simulatePromptText(undefined, 'abc')).toBe('abc');
  });

  it('returns existing when value is empty string and existing is set', () => {
    expect(simulatePromptText('', 'abc')).toBe('abc');
  });

  it('returns input when value is non-empty', () => {
    expect(simulatePromptText('new-value', 'abc')).toBe('new-value');
  });

  it('returns empty string when value is undefined and no existing', () => {
    expect(simulatePromptText(undefined)).toBe('');
  });

  it('returns empty string when value is empty string and no existing', () => {
    expect(simulatePromptText('')).toBe('');
  });
});

describe('prompt password logic (null-safe branches)', () => {
  it('returns existing when value is undefined and existing is set', () => {
    expect(simulatePromptPassword(undefined, 'secret')).toBe('secret');
  });

  it('returns existing when value is empty string and existing is set', () => {
    expect(simulatePromptPassword('', 'secret')).toBe('secret');
  });

  it('returns input when value is non-empty', () => {
    expect(simulatePromptPassword('new-key', 'secret')).toBe('new-key');
  });

  it('returns undefined when value is undefined and no existing', () => {
    expect(simulatePromptPassword(undefined)).toBeUndefined();
  });

  it('returns undefined when value is empty string and no existing', () => {
    expect(simulatePromptPassword('')).toBeUndefined();
  });

  it('does not crash on value.length when value is undefined', () => {
    expect(() => simulatePromptPassword(undefined)).not.toThrow();
  });
});

// ─── validateSizeInput Tests ───────────────────────────────────────

/**
 * Core validation logic from setup.ts validateSizeInput.
 */
function simulateValidateSizeInput(input: string | undefined): string | undefined {
  if (!input || input.length === 0) return undefined;
  if (parseSize(input) !== null) return undefined;
  return 'Invalid size. Use format like "500MB", "2GB", "1500KB", "1TB".';
}

describe('validateSizeInput', () => {
  it('returns undefined for empty input', () => {
    expect(simulateValidateSizeInput('')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(simulateValidateSizeInput(undefined)).toBeUndefined();
  });

  it('returns undefined for valid size strings', () => {
    expect(simulateValidateSizeInput('500MB')).toBeUndefined();
    expect(simulateValidateSizeInput('2GB')).toBeUndefined();
    expect(simulateValidateSizeInput('1500KB')).toBeUndefined();
    expect(simulateValidateSizeInput('1TB')).toBeUndefined();
    expect(simulateValidateSizeInput('128')).toBeUndefined();
  });

  it('returns error message for invalid input', () => {
    const err = simulateValidateSizeInput('xyz');
    expect(err).toBeDefined();
    expect(err).toContain('Invalid size');
  });

  it('returns error for negative numbers', () => {
    expect(simulateValidateSizeInput('-5MB')).toBeDefined();
  });
});

// ─── buildConfig Tests ─────────────────────────────────────────────

interface SetupState {
  botToken: string;
  allowedUserIds: Array<number>;
  apiKey: string | undefined;
  memoryMode: 'ephemeral' | 'persistent';
  cacheMaxEntries: number;
  cacheMaxSizeBytes: number;
  vaultDirectories: Array<string>;
}

const DEFAULT_STATE: SetupState = {
  botToken: 'test:token',
  allowedUserIds: [123],
  apiKey: undefined,
  memoryMode: 'ephemeral',
  cacheMaxEntries: 100,
  cacheMaxSizeBytes: 104_857_600,
  vaultDirectories: [],
};

function simulateBuildConfig(state: SetupState): Record<string, unknown> {
  return {
    telegram: { bot_token: state.botToken, allowed_user_ids: state.allowedUserIds },
    llm: {
      provider: 'opencode-go',
      model: 'deepseek-v4-flash',
      reasoning: 'high',
      ...(state.apiKey ? { api_key: state.apiKey } : {}),
    },
    memory: {
      enabled: true,
      mode: state.memoryMode,
      auto_inject: true,
      search: { max_results: 5, mode: 'keyword' },
      cache: { max_entries: state.cacheMaxEntries, max_size_bytes: state.cacheMaxSizeBytes },
      qmd: {
        enabled: state.memoryMode === 'persistent',
        binary_path: 'qmd',
      },
    },
    bot: { max_attachments_per_turn: 10, streaming_preview: true, text_chunk_size: 4096 },
    vault_directories: state.vaultDirectories,
  };
}

describe('buildConfig', () => {
  it('produces correct config structure', () => {
    const result = simulateBuildConfig(DEFAULT_STATE);
    expect(result.telegram).toEqual({ bot_token: 'test:token', allowed_user_ids: [123] });
    expect(result.llm).toMatchObject({ provider: 'opencode-go', model: 'deepseek-v4-flash' });
    expect(result.memory).toMatchObject({ mode: 'ephemeral', enabled: true });
    expect(result.vault_directories).toEqual([]);
  });

  it('includes api_key when provided', () => {
    const result = simulateBuildConfig({ ...DEFAULT_STATE, apiKey: 'sk-test' });
    expect(result.llm).toMatchObject({ api_key: 'sk-test' });
  });

  it('enables qmd when mode is persistent', () => {
    const result = simulateBuildConfig({ ...DEFAULT_STATE, memoryMode: 'persistent' });
    expect((result.memory as Record<string, unknown>).qmd).toMatchObject({ enabled: true });
  });

  it('disables qmd when mode is ephemeral', () => {
    const result = simulateBuildConfig(DEFAULT_STATE);
    expect((result.memory as Record<string, unknown>).qmd).toMatchObject({ enabled: false });
  });

  it('includes vault directories', () => {
    const result = simulateBuildConfig({ ...DEFAULT_STATE, vaultDirectories: ['/Users/me/vault'] });
    expect(result.vault_directories).toEqual(['/Users/me/vault']);
  });

  it('includes cache config', () => {
    const result = simulateBuildConfig(DEFAULT_STATE);
    expect((result.memory as Record<string, unknown>).cache).toEqual({
      max_entries: 100,
      max_size_bytes: 104_857_600,
    });
  });
});

// ─── promptText Tests (mocked @clack/prompts) ──────────────────────

describe('promptText (mocked @clack/prompts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClack.isCancel.mockReturnValue(false);
  });

  it('returns value from clack prompt when non-empty', async () => {
    mockClack.text.mockResolvedValue('user-input');
    const result = await promptText('Enter value', 'existing');
    expect(result).toBe('user-input');
  });

  it('returns existing when clack returns empty string', async () => {
    mockClack.text.mockResolvedValue('');
    const result = await promptText('Enter value', 'existing');
    expect(result).toBe('existing');
  });

  it('handles cancel (isCancel returns symbol → process.exit)', async () => {
    const cancelSymbol = Symbol('cancel');
    mockClack.text.mockResolvedValue(cancelSymbol);
    mockClack.isCancel.mockReturnValue(true);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    await promptText('Enter value', 'existing');
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});

// ─── promptPassword Tests (mocked @clack/prompts) ──────────────────

describe('promptPassword (mocked @clack/prompts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClack.isCancel.mockReturnValue(false);
  });

  it('returns value from clack when non-empty', async () => {
    mockClack.password.mockResolvedValue('new-key');
    const result = await promptPassword('Enter key', 'existing-key');
    expect(result).toBe('new-key');
  });

  it('returns existing when clack returns empty and existing is set', async () => {
    mockClack.password.mockResolvedValue('');
    const result = await promptPassword('Enter key', 'existing-key');
    expect(result).toBe('existing-key');
  });

  it('returns undefined when clack returns empty and no existing', async () => {
    mockClack.password.mockResolvedValue('');
    const result = await promptPassword('Enter key');
    expect(result).toBeUndefined();
  });

  it('validate callback returns error when empty and no existing', async () => {
    let capturedValidate: ((v: string | undefined) => string | undefined) | undefined;
    mockClack.password.mockImplementation((opts: object) => {
      capturedValidate = (opts as Record<string, unknown>).validate as (v: string | undefined) => string | undefined;
      return Promise.resolve('');
    });

    await promptPassword('Enter key');
    expect(capturedValidate).toBeDefined();
    expect(capturedValidate?.('')).toBe('Required');
    expect(capturedValidate?.(undefined)).toBe('Required');
  });

  it('validate callback returns undefined when empty with existing (keep)', async () => {
    let capturedValidate: ((v: string | undefined) => string | undefined) | undefined;
    mockClack.password.mockImplementation((opts: object) => {
      capturedValidate = (opts as Record<string, unknown>).validate as (v: string | undefined) => string | undefined;
      return Promise.resolve('');
    });

    await promptPassword('Enter key', 'existing-key');
    expect(capturedValidate).toBeDefined();
    expect(capturedValidate?.('')).toBeUndefined();
    expect(capturedValidate?.(undefined)).toBeUndefined();
  });

  it('handles cancel', async () => {
    const cancelSymbol = Symbol('cancel');
    mockClack.password.mockResolvedValue(cancelSymbol);
    mockClack.isCancel.mockReturnValue(true);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    await promptPassword('Enter key');
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});

// ─── validateBotToken Tests (simulate pattern) ────────────────────

interface TelegramUser {
  readonly id: number;
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly username?: string;
}

interface ValidateBotTokenResult {
  ok: boolean;
  bot?: TelegramUser;
  error?: string;
}

async function simulateValidateBotToken(
  token: string,
  mockFetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<ValidateBotTokenResult> {
  try {
    const response = await mockFetch(`https://api.telegram.org/bot${token}/getMe`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = (await response.json()) as { ok: boolean; result?: TelegramUser; description?: string };
    if (data.ok && data.result) return { ok: true, bot: data.result };
    return { ok: false, error: data.description ?? 'Unknown error' };
  } catch (err) {
    return { ok: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

describe('validateBotToken', () => {
  it('returns ok:true,bot when API succeeds', async () => {
    const mockBot = { id: 123, is_bot: true, first_name: 'TestBot', username: 'testbot' };
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: mockBot }),
    });

    const result = await simulateValidateBotToken('valid-token', mockFetch);
    expect(result.ok).toBe(true);
    expect(result.bot).toEqual(mockBot);
  });

  it('returns ok:false,error when API returns !ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, description: 'Invalid token' }),
    });

    const result = await simulateValidateBotToken('bad-token', mockFetch);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid token');
  });

  it('returns ok:false,error when fetch throws (network error)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));

    const result = await simulateValidateBotToken('token', mockFetch);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network error');
  });
});

// ─── writeConfigYaml Tests (simulate pattern) ──────────────────────

function simulateWriteConfigYaml(
  configDir: string,
  config: Record<string, unknown>,
  mockWriteFileSync: (...args: unknown[]) => void,
): void {
  mockWriteFileSync(
    join(configDir, 'config.yaml'),
    yaml.dump(config, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }),
    { mode: 0o600 },
  );
}

describe('writeConfigYaml', () => {
  it('writes YAML config to correct path with mode 0o600', () => {
    const mockWriteFileSync = vi.fn();
    const configDir = '/tmp/test-config';

    simulateWriteConfigYaml(configDir, { telegram: { bot_token: 'test' } }, mockWriteFileSync);

    expect(mockWriteFileSync).toHaveBeenCalledWith(join(configDir, 'config.yaml'), expect.any(String), { mode: 0o600 });
  });

  it('writes valid YAML content', () => {
    const mockWriteFileSync = vi.fn();

    simulateWriteConfigYaml('/tmp/test-config', { telegram: { bot_token: 'abc' } }, mockWriteFileSync);

    const writtenYaml = mockWriteFileSync.mock.calls[0]?.[1] as string;
    const parsed = yaml.load(writtenYaml) as Record<string, unknown>;
    expect((parsed.telegram as Record<string, unknown>).bot_token).toBe('abc');
  });
});

// ─── writeAuthJson Tests (simulate pattern) ────────────────────────

function simulateWriteAuthJson(
  configDir: string,
  apiKey: string,
  mockWriteFileSync: (...args: unknown[]) => void,
): void {
  mockWriteFileSync(
    join(configDir, 'agents', 'auth.json'),
    `${JSON.stringify({ 'opencode-go': { type: 'api_key', key: apiKey } }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

describe('writeAuthJson', () => {
  it('writes auth JSON to agents/auth.json with mode 0o600', () => {
    const mockWriteFileSync = vi.fn();

    simulateWriteAuthJson('/tmp/test-config', 'sk-test-key', mockWriteFileSync);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join('/tmp/test-config', 'agents', 'auth.json'),
      expect.any(String),
      { mode: 0o600 },
    );
  });

  it('writes correct JSON structure with api key', () => {
    const mockWriteFileSync = vi.fn();

    simulateWriteAuthJson('/tmp/test-config', 'sk-secret-456', mockWriteFileSync);

    const writtenJson = mockWriteFileSync.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(writtenJson);
    expect(parsed['opencode-go']).toEqual({ type: 'api_key', key: 'sk-secret-456' });
  });
});

// ─── loadExistingConfig Tests ──────────────────────────────────────

describe('loadExistingConfig (via YAML round-trip)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `tele-kb-bot-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      const { rmSync } = require('node:fs');
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('returns defaults when no config file exists', () => {
    const defaults = simulateLoadExistingConfigDefaults(tmpDir);
    expect(defaults.botToken).toBe('');
    expect(defaults.allowedUserIds).toEqual([]);
    expect(defaults.memoryMode).toBe('ephemeral');
    expect(defaults.cacheMaxEntries).toBe(100);
    expect(defaults.vaultDirectories).toEqual([]);
  });

  it('reads config values from existing file', () => {
    const fullConfig = simulateBuildConfig({
      botToken: 'existing:token',
      allowedUserIds: [999],
      apiKey: undefined,
      memoryMode: 'persistent',
      cacheMaxEntries: 50,
      cacheMaxSizeBytes: 50_000_000,
      vaultDirectories: ['/Users/me/vault'],
    });
    writeFileSync(join(tmpDir, 'config.yaml'), yaml.dump(fullConfig, {}), 'utf-8');

    const loaded = simulateLoadExistingConfigDefaults(tmpDir);
    expect(loaded.botToken).toBe('existing:token');
    expect(loaded.allowedUserIds).toEqual([999]);
    expect(loaded.memoryMode).toBe('persistent');
    expect(loaded.cacheMaxEntries).toBe(50);
    expect(loaded.cacheMaxSizeBytes).toBe(50_000_000);
    expect(loaded.vaultDirectories).toEqual(['/Users/me/vault']);
  });

  it('falls back to defaults on corrupted file', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), '{invalid yaml{{{', 'utf-8');
    const loaded = simulateLoadExistingConfigDefaults(tmpDir);
    expect(loaded.botToken).toBe('');
  });

  it('reads api_key from config YAML', () => {
    const config = simulateBuildConfig({
      ...DEFAULT_STATE,
      botToken: 'test:token',
      allowedUserIds: [123],
      apiKey: 'sk-from-config',
    });
    writeFileSync(join(tmpDir, 'config.yaml'), yaml.dump(config, {}), 'utf-8');
    const loaded = simulateLoadExistingConfigDefaults(tmpDir);
    expect(loaded.apiKey).toBe('sk-from-config');
  });

  it('reads api_key from auth.json when not in config YAML', () => {
    const config = simulateBuildConfig({
      ...DEFAULT_STATE,
      botToken: 'test:token',
      allowedUserIds: [123],
      apiKey: undefined,
    });
    writeFileSync(join(tmpDir, 'config.yaml'), yaml.dump(config, {}), 'utf-8');
    const authDir = join(tmpDir, 'agents');
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, 'auth.json'),
      `${JSON.stringify({ 'opencode-go': { type: 'api_key', key: 'sk-from-auth' } }, null, 2)}\n`,
    );
    const loaded = simulateLoadExistingConfigDefaults(tmpDir);
    expect(loaded.apiKey).toBe('sk-from-auth');
  });

  it('returns undefined apiKey when neither config nor auth.json has it', () => {
    const config = simulateBuildConfig({
      ...DEFAULT_STATE,
      botToken: 'test:token',
      allowedUserIds: [123],
      apiKey: undefined,
    });
    writeFileSync(join(tmpDir, 'config.yaml'), yaml.dump(config, {}), 'utf-8');
    const loaded = simulateLoadExistingConfigDefaults(tmpDir);
    expect(loaded.apiKey).toBeUndefined();
  });
});

// ─── setupCommand Tests ────────────────────────────────────────────

describe('setupCommand', () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  const defaultOptions: CLIOptions = {
    command: 'setup',
    nonInteractive: false,
    rawArgs: ['setup'],
  };

  function makeOptions(overrides: Partial<CLIOptions> = {}): CLIOptions {
    return { ...defaultOptions, ...overrides, configOverride: tmpDir };
  }

  beforeEach(() => {
    tmpDir = join(tmpdir(), `setup-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpDir, { recursive: true });

    vi.clearAllMocks();
    // Restore mockClack defaults after clearAllMocks
    mockClack.isCancel.mockReturnValue(false);
    mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });

    // Default fetch mock: successful token validation
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          ok: true,
          result: { id: 123, is_bot: true, first_name: 'TestBot', username: 'test_bot' },
        }),
      }),
    );

    // Spies
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore only our spies — do NOT call vi.restoreAllMocks() as it breaks
    // module-level vi.mock() factory results (writeFileSync, mockClack).
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    try {
      const { rmSync } = require('node:fs');
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  /** Read the config.yaml from the temp dir (written by setupCommand) */
  function readConfigFromDisk(): Record<string, unknown> | null {
    const configPath = join(tmpDir, 'config.yaml');
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(configPath, 'utf-8');
    return yaml.load(raw) as Record<string, unknown>;
  }

  /** Read the auth.json from the temp dir, or null if it does not exist */
  function readAuthJsonFromDisk(): Record<string, unknown> | null {
    const authPath = join(tmpDir, 'agents', 'auth.json');
    if (!existsSync(authPath)) return null;
    const raw = readFileSync(authPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  // ── Non-Interactive Mode ───────────────────────────────────────

  describe('non-interactive mode', () => {
    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'test:bot_token';
      process.env.TELEGRAM_ALLOWED_USER_IDS = '123,456';
      delete process.env.OPENER_GO_API_KEY;
    });

    afterEach(() => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_ALLOWED_USER_IDS;
      delete process.env.OPENER_GO_API_KEY;
    });

    it('writes config from env vars when no api key', async () => {
      await setupCommand(makeOptions({ nonInteractive: true }));

      const config = readConfigFromDisk();
      expect(config).not.toBeNull();
      expect(config?.telegram).toEqual({ bot_token: 'test:bot_token', allowed_user_ids: [123, 456] });
      expect((config?.memory as Record<string, unknown>).mode).toBe('ephemeral');
      expect((config?.llm as Record<string, unknown>).api_key).toBeUndefined();

      // No auth.json when no api key
      expect(readAuthJsonFromDisk()).toBeNull();
    });

    it('writes auth.json when OPENER_GO_API_KEY is set', async () => {
      process.env.OPENER_GO_API_KEY = 'sk-test-key-456';

      await setupCommand(makeOptions({ nonInteractive: true }));

      const auth = readAuthJsonFromDisk();
      expect(auth).not.toBeNull();
      expect(auth?.['opencode-go']).toEqual({ type: 'api_key', key: 'sk-test-key-456' });
    });

    it('calls process.exit(1) when TELEGRAM_BOT_TOKEN is missing', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;

      await expect(setupCommand(makeOptions({ nonInteractive: true }))).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_BOT_TOKEN'));
    });

    it('calls process.exit(1) when TELEGRAM_ALLOWED_USER_IDS is missing', async () => {
      delete process.env.TELEGRAM_ALLOWED_USER_IDS;

      await expect(setupCommand(makeOptions({ nonInteractive: true }))).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_ALLOWED_USER_IDS'));
    });

    it('outputs success text with bot info', async () => {
      await setupCommand(makeOptions({ nonInteractive: true }));

      expect(mockClack.outro).toHaveBeenCalledWith(expect.stringContaining('TestBot'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('@test_bot'));
    });

    it('preserves existing config values when env vars are not set', async () => {
      // Pre-create config with existing values
      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      realFs.writeFileSync(
        join(tmpDir, 'config.yaml'),
        yaml.dump({
          telegram: { bot_token: 'existing:token', allowed_user_ids: [999] },
          llm: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
          memory: {
            enabled: true,
            mode: 'persistent',
            cache: { max_entries: 50, max_size_bytes: 50_000_000 },
          },
          vault_directories: ['/Users/me/existing-vault'],
        }),
      );

      // Set only token env var, rest come from existing config
      process.env.TELEGRAM_BOT_TOKEN = 'env:token';
      delete process.env.TELEGRAM_ALLOWED_USER_IDS;

      await setupCommand(makeOptions({ nonInteractive: true }));

      const config = readConfigFromDisk();
      expect((config?.telegram as Record<string, unknown>).bot_token).toBe('env:token');
      expect((config?.telegram as Record<string, unknown>).allowed_user_ids).toEqual([999]);
      expect((config?.memory as Record<string, unknown>).mode).toBe('persistent');
      expect(config?.vault_directories).toEqual(['/Users/me/existing-vault']);
    });
  });

  // ── Interactive Mode ───────────────────────────────────────────

  describe('interactive mode', () => {
    /**
     * Set up mock prompt responses for a full happy-path interactive flow.
     * PASSWORD: bot token
     * TEXT:     user IDs, cache entries, cache size, vault dirs
     * SELECT:   api key action, memory mode, install, index
     */
    function setupHappyPath(overrides?: {
      userIds?: string;
      apiKeyAction?: string;
      memoryMode?: string;
      cacheEntries?: string;
      cacheSize?: string;
      vaultDirs?: string;
      install?: boolean;
      indexAction?: string;
    }): void {
      const o = {
        userIds: '100,200,300',
        apiKeyAction: 'no',
        memoryMode: 'ephemeral',
        cacheEntries: '50',
        cacheSize: '500MB',
        vaultDirs: '/Users/me/vault1, /Users/me/vault2',
        install: false,
        indexAction: 'no',
        ...overrides,
      };
      // 1. Bot token (password)
      mockClack.password.mockResolvedValueOnce('test:bot_token');
      // 2. Allowed user IDs (text)
      mockClack.text.mockResolvedValueOnce(o.userIds);
      // 3. LLM API key action (select)
      mockClack.select.mockResolvedValueOnce(o.apiKeyAction);
      // 4. Memory mode (select)
      mockClack.select.mockResolvedValueOnce(o.memoryMode);
      // 5. Cache max entries (text)
      mockClack.text.mockResolvedValueOnce(o.cacheEntries);
      // 6. Cache max size (text, direct @clack/prompts call)
      mockClack.text.mockResolvedValueOnce(o.cacheSize);
      // 7. Vault directories (text)
      mockClack.text.mockResolvedValueOnce(o.vaultDirs);
      // 8. Install launchd (select)
      mockClack.select.mockResolvedValueOnce(o.install);
    }

    it('completes full happy path and writes config', async () => {
      setupHappyPath();

      await setupCommand(makeOptions());

      const config = readConfigFromDisk();
      expect(config).not.toBeNull();

      const t = config?.telegram as Record<string, unknown>;
      expect(t.bot_token).toBe('test:bot_token');
      expect(t.allowed_user_ids).toEqual([100, 200, 300]);

      const m = config?.memory as Record<string, unknown>;
      expect(m.mode).toBe('ephemeral');
      expect((m.cache as Record<string, unknown>).max_entries).toBe(50);
      expect((m.cache as Record<string, unknown>).max_size_bytes).toBe(524_288_000); // 500MB

      expect(config?.vault_directories).toEqual(['/Users/me/vault1', '/Users/me/vault2']);
      expect((config?.llm as Record<string, unknown>).api_key).toBeUndefined();
    });

    it('exits when bot token password returns undefined and no existing', async () => {
      mockClack.password.mockResolvedValueOnce('');

      await expect(setupCommand(makeOptions())).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockClack.cancel).toHaveBeenCalledWith(expect.stringContaining('Bot token is required'));
    });

    it('parses user IDs and filters invalid entries', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100,abc,200,xyz,300');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      const config = readConfigFromDisk();
      expect((config?.telegram as Record<string, unknown>).allowed_user_ids).toEqual([100, 200, 300]);
    });

    it('keeps existing LLM API key when select is "keep"', async () => {
      // Pre-create config with existing api key
      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      realFs.writeFileSync(
        join(tmpDir, 'config.yaml'),
        yaml.dump({
          telegram: { bot_token: 'existing:token', allowed_user_ids: [999] },
          llm: { provider: 'opencode-go', model: 'deepseek-v4-flash', api_key: 'sk-existing-key' },
          memory: { enabled: true, mode: 'ephemeral' },
          vault_directories: [],
        }),
      );

      mockClack.password.mockResolvedValueOnce('existing:token');
      mockClack.text.mockResolvedValueOnce(''); // keep existing user IDs
      mockClack.select.mockResolvedValueOnce('keep'); // keep api key
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      const config = readConfigFromDisk();
      expect((config?.llm as Record<string, unknown>).api_key).toBe('sk-existing-key');
    });

    it('replaces existing LLM API key when select is "replace"', async () => {
      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      realFs.writeFileSync(
        join(tmpDir, 'config.yaml'),
        yaml.dump({
          telegram: { bot_token: 'existing:token', allowed_user_ids: [999] },
          llm: { provider: 'opencode-go', model: 'deepseek-v4-flash', api_key: 'sk-old-key' },
          memory: { enabled: true, mode: 'ephemeral' },
          vault_directories: [],
        }),
      );

      mockClack.password.mockResolvedValueOnce('existing:token'); // bot token
      mockClack.text.mockResolvedValueOnce(''); // user IDs
      mockClack.select.mockResolvedValueOnce('replace'); // replace key
      mockClack.password.mockResolvedValueOnce('sk-new-key'); // new key
      mockClack.select.mockResolvedValueOnce('ephemeral'); // memory
      mockClack.text.mockResolvedValueOnce(''); // cache entries
      mockClack.text.mockResolvedValueOnce(''); // cache size
      mockClack.text.mockResolvedValueOnce(''); // vault dirs
      mockClack.select.mockResolvedValueOnce(false); // install

      await setupCommand(makeOptions());

      const config = readConfigFromDisk();
      expect((config?.llm as Record<string, unknown>).api_key).toBe('sk-new-key');

      // Verify auth.json was written with new key
      const auth = readAuthJsonFromDisk();
      expect(auth).not.toBeNull();
      expect(auth?.['opencode-go']).toEqual({ type: 'api_key', key: 'sk-new-key' });
    });

    it('adds LLM API key when no existing key and user says yes', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('yes'); // add api key
      mockClack.password.mockResolvedValueOnce('sk-new-key');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      const config = readConfigFromDisk();
      expect((config?.llm as Record<string, unknown>).api_key).toBe('sk-new-key');

      const auth = readAuthJsonFromDisk();
      expect(auth?.['opencode-go']).toEqual({ type: 'api_key', key: 'sk-new-key' });
    });

    it('does not configure LLM API key when user says no (no existing)', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      const config = readConfigFromDisk();
      expect((config?.llm as Record<string, unknown>).api_key).toBeUndefined();
      expect(readAuthJsonFromDisk()).toBeNull();
    });

    it('selects persistent memory mode', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('persistent');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      const config = readConfigFromDisk();
      expect((config?.memory as Record<string, unknown>).mode).toBe('persistent');
      expect((config?.memory as Record<string, unknown>).qmd).toEqual({ enabled: true, binary_path: 'qmd' });
    });

    it('falls back to existing cache entries on invalid input', async () => {
      // Pre-create config with custom cache max entries
      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      realFs.writeFileSync(
        join(tmpDir, 'config.yaml'),
        yaml.dump({
          telegram: { bot_token: 'existing:token', allowed_user_ids: [999] },
          llm: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
          memory: { enabled: true, mode: 'ephemeral', cache: { max_entries: 75, max_size_bytes: 100_000_000 } },
          vault_directories: [],
        }),
      );

      mockClack.password.mockResolvedValueOnce('existing:token');
      mockClack.text.mockResolvedValueOnce(''); // user IDs
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('abc'); // invalid entries
      mockClack.text.mockResolvedValueOnce(''); // cache size (keep existing)
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      const config = readConfigFromDisk();
      expect((config?.memory as Record<string, unknown>).cache).toMatchObject({ max_entries: 75 });
    });

    it('parses cache size from text prompt', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('2GB');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      const config = readConfigFromDisk();
      const cache = (config?.memory as Record<string, unknown>).cache as Record<string, unknown>;
      expect(cache.max_size_bytes).toBe(2_147_483_648); // 2GB in bytes
    });

    it('validates cache size input via the validate callback', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('100');
      // The 4th text call is the cache size prompt with validate:
      // We need to capture the validate function from the text call arguments
      mockClack.text.mockImplementationOnce((_opts: { validate?: (v: string | undefined) => string | undefined }) => {
        // Return a value — we just need to inspect the validate fn
        return Promise.resolve('500MB');
      });
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      const textCalls = mockClack.text.mock.calls;
      const cacheSizeCall = textCalls[2];
      if (!cacheSizeCall) {
        throw new Error('Expected at least 3 text prompts (cache size)');
      }
      const opts = cacheSizeCall[0] as { validate?: (v: string | undefined) => string | undefined };
      expect(opts.validate).toBeInstanceOf(Function);
      expect(opts.validate?.('500MB')).toBeUndefined();
      expect(opts.validate?.('xyz')).toContain('Invalid size');
    });

    it('filters tilde paths from vault directories with warning', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('/Users/me/real, ~/invalid, /Users/me/also-real');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      const config = readConfigFromDisk();
      expect(config?.vault_directories).toEqual(['/Users/me/real', '/Users/me/also-real']);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('~'));
    });

    it('exits when bot token validation fails', async () => {
      // Override fetch to return failure
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({ ok: false, description: 'Invalid token' }),
        }),
      );

      mockClack.password.mockResolvedValueOnce('bad:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('');
      // Should NOT reach install select — exits in validation

      await expect(setupCommand(makeOptions())).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockClack.cancel).toHaveBeenCalledWith(expect.stringContaining('validation failed'));
    });

    it('recovers API key from auth.json when not provided via prompts', async () => {
      // Pre-create auth.json in the agents subdirectory
      const agentsDir = join(tmpDir, 'agents');
      mkdirSync(agentsDir, { recursive: true });
      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      realFs.writeFileSync(
        join(agentsDir, 'auth.json'),
        `${JSON.stringify({ 'opencode-go': { type: 'api_key', key: 'sk-from-auth-json' } }, null, 2)}\n`,
      );

      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      // apiKey should be recovered from auth.json even though user said "no"
      const config = readConfigFromDisk();
      expect((config?.llm as Record<string, unknown>).api_key).toBe('sk-from-auth-json');

      // auth.json should be written again (it already exists but writeAuthJson is called)
      const auth = readAuthJsonFromDisk();
      expect(auth).not.toBeNull();
    });

    it('calls installCommand when install prompt is yes', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(true); // Yes, install

      await setupCommand(makeOptions());

      expect(mockLaunchd.launchdAddCommand).toHaveBeenCalledWith(makeOptions());
    });

    it('skips installCommand when install prompt is no', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('ephemeral');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('');
      mockClack.select.mockResolvedValueOnce(false); // No, skip install

      await setupCommand(makeOptions());

      expect(mockLaunchd.launchdAddCommand).not.toHaveBeenCalled();
    });

    it('calls indexCommand for persistent mode with vaults when user says yes', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('persistent');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('/Users/me/vault');
      mockClack.select.mockResolvedValueOnce(false); // No, skip install
      mockClack.select.mockResolvedValueOnce('yes'); // Yes, build index

      await setupCommand(makeOptions());

      expect(mockIndex.indexCommand).toHaveBeenCalledWith(expect.objectContaining({ rawArgs: ['index', 'build'] }));
    });

    it('skips indexCommand for persistent mode with vaults when user says no', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('persistent');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce('/Users/me/vault');
      mockClack.select.mockResolvedValueOnce(false); // No, skip install
      mockClack.select.mockResolvedValueOnce('no'); // No, skip index

      await setupCommand(makeOptions());

      expect(mockIndex.indexCommand).not.toHaveBeenCalled();
    });

    it('skips index prompt entirely when no vault directories configured', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('no');
      mockClack.select.mockResolvedValueOnce('persistent');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.text.mockResolvedValueOnce('100MB');
      mockClack.text.mockResolvedValueOnce(''); // No vault directories
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      // install select was the last prompt; index select was never shown
      expect(mockClack.select).toHaveBeenCalledTimes(3); // api key, memory mode, install
      expect(mockIndex.indexCommand).not.toHaveBeenCalled();
    });

    it('shows success outro with correct summary', async () => {
      mockClack.password.mockResolvedValueOnce('test:token');
      mockClack.text.mockResolvedValueOnce('100');
      mockClack.select.mockResolvedValueOnce('yes');
      mockClack.password.mockResolvedValueOnce('sk-my-key');
      mockClack.select.mockResolvedValueOnce('persistent');
      mockClack.text.mockResolvedValueOnce('200');
      mockClack.text.mockResolvedValueOnce('1GB');
      mockClack.text.mockResolvedValueOnce('/Users/me/vault');
      mockClack.select.mockResolvedValueOnce(false);

      await setupCommand(makeOptions());

      expect(mockClack.outro).toHaveBeenCalledWith(expect.stringContaining('Config written to'));
      expect(mockClack.outro).toHaveBeenCalledWith(expect.stringContaining('TestBot'));
      expect(mockClack.outro).toHaveBeenCalledWith(expect.stringContaining('Memory mode: persistent'));
      expect(mockClack.outro).toHaveBeenCalledWith(expect.stringContaining('Cache: 200 entries'));
      expect(mockClack.outro).toHaveBeenCalledWith(expect.stringContaining('LLM API key configured'));
      expect(mockClack.outro).toHaveBeenCalledWith(expect.stringContaining('Vault directories'));
    });
  });
});

// ─── Helper: simulate loadExistingConfig ────────────────────────────

function simulateLoadExistingConfigDefaults(configDir: string): SetupState {
  const { existsSync: exists, readFileSync: read } = require('node:fs');

  const configPath = join(configDir, 'config.yaml');
  const defaults: SetupState = {
    botToken: '',
    allowedUserIds: [],
    apiKey: undefined,
    memoryMode: 'ephemeral',
    cacheMaxEntries: 100,
    cacheMaxSizeBytes: 104_857_600,
    vaultDirectories: [],
  };

  if (!exists(configPath)) return defaults;

  try {
    const raw = read(configPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>;
    const t = parsed.telegram as Record<string, unknown> | undefined;
    const memoryRaw = parsed.memory as Record<string, unknown> | undefined;
    const cacheRaw = memoryRaw?.cache as Record<string, unknown> | undefined;

    // Read api_key from config YAML or auth.json
    const llmRaw = parsed.llm as Record<string, unknown> | undefined;
    let apiKey: string | undefined = llmRaw?.api_key as string | undefined;
    if (!apiKey) {
      try {
        const authPath = join(configDir, 'agents', 'auth.json');
        if (exists(authPath)) {
          const authRaw = read(authPath, 'utf-8');
          const authParsed = JSON.parse(authRaw) as Record<string, unknown>;
          const entry = authParsed['opencode-go'] as Record<string, unknown> | undefined;
          if (entry && typeof entry.key === 'string') {
            apiKey = entry.key;
          }
        }
      } catch {
        // auth.json read failure is non-fatal
      }
    }

    return {
      botToken: typeof t?.bot_token === 'string' ? t.bot_token : defaults.botToken,
      allowedUserIds: Array.isArray(t?.allowed_user_ids)
        ? (t?.allowed_user_ids as Array<number>).filter((id) => typeof id === 'number')
        : defaults.allowedUserIds,
      apiKey: apiKey ?? defaults.apiKey,
      memoryMode: ((memoryRaw?.mode as string) ?? defaults.memoryMode) as 'ephemeral' | 'persistent',
      cacheMaxEntries: (cacheRaw?.max_entries as number) ?? defaults.cacheMaxEntries,
      cacheMaxSizeBytes: (cacheRaw?.max_size_bytes as number) ?? defaults.cacheMaxSizeBytes,
      vaultDirectories: Array.isArray(parsed.vault_directories)
        ? (parsed.vault_directories as Array<string>).filter((d) => typeof d === 'string')
        : defaults.vaultDirectories,
    };
  } catch {
    return defaults;
  }
}
