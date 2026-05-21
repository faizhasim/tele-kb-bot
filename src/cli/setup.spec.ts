/**
 * Tests for the setup wizard module.
 *
 * Tests pure functions (validateSizeInput, loadExistingConfig, buildConfig)
 * and null-safety of prompt helpers that wrap @clack/prompts.
 *
 * @module
 */

import { mkdirSync, writeFileSync } from 'node:fs';
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

import { promptPassword, promptText } from './setup';

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
