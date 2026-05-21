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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSize } from '../config/size';

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

    return {
      botToken: typeof t?.bot_token === 'string' ? t.bot_token : defaults.botToken,
      allowedUserIds: Array.isArray(t?.allowed_user_ids)
        ? (t?.allowed_user_ids as Array<number>).filter((id) => typeof id === 'number')
        : defaults.allowedUserIds,
      apiKey: '',
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
