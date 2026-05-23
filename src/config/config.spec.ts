/**
 * Tests for the config system.
 *
 * Pure functions tested with regular assertions.
 * Effect-based functions tested with ManagedRuntime.runPromise.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform/FileSystem';
import { BunFileSystem } from '@effect/platform-bun';
import * as S from '@effect/schema/Schema';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { EffectLoggerLive } from '../logger';
import { getDefaultConfig, mergeConfig, validateSemantic } from './defaults';
import { ConfigLoadError, ConfigValidationError, loadConfig, loadConfigFromEnv, loadConfigSync } from './loader';
import { ensureConfigDirs, ensureConfigDirsSync, getConfigSubdirs, resolveConfigDir, resolveConfigPath } from './paths';
import type { Config } from './schema';
import { ConfigSchema, redactConfig } from './schema';

// ─── Helpers ────────────────────────────────────────────────────────

const MINIMAL_VALID_CONFIG = {
  telegram: { bot_token: 'test:token', allowed_user_ids: [123] },
  llm: {
    provider: 'opencode-go',
    model: 'deepseek-v4-flash',
    reasoning: 'high' as const,
  },
  memory: {
    enabled: true,
    mode: 'ephemeral' as const,
    auto_inject: true,
    search: { max_results: 5, mode: 'keyword' as const },
    cache: { max_entries: 100, max_size_bytes: 104_857_600 },
    qmd: { enabled: false, binary_path: 'qmd' },
  },
  bot: {
    max_attachments_per_turn: 10,
    streaming_preview: true,
    text_chunk_size: 4096,
    max_sessions: 5,
  },
  vault_directories: [],
};

// ─── Schema Tests ────────────────────────────────────────────────────

describe('ConfigSchema', () => {
  it('validates a correct config', () => {
    const result = S.decodeUnknownEither(ConfigSchema)(MINIMAL_VALID_CONFIG);
    expect(result._tag).toBe('Right');
    if (result._tag === 'Right') {
      expect(result.right.telegram.bot_token).toBe('test:token');
    }
  });

  it('rejects missing bot_token', () => {
    const result = S.decodeUnknownEither(ConfigSchema)({
      ...MINIMAL_VALID_CONFIG,
      telegram: { allowed_user_ids: [1] },
    } as unknown as Record<string, unknown>);
    expect(result._tag).toBe('Left');
  });

  it('accepts vault_directories', () => {
    const result = S.decodeUnknownEither(ConfigSchema)({
      ...MINIMAL_VALID_CONFIG,
      vault_directories: ['/Users/me/vault'],
    });
    expect(result._tag).toBe('Right');
    if (result._tag === 'Right') {
      expect(result.right.vault_directories).toEqual(['/Users/me/vault']);
    }
  });

  it('accepts memory.mode ephemeral and persistent', () => {
    const eph = S.decodeUnknownEither(ConfigSchema)({
      ...MINIMAL_VALID_CONFIG,
      memory: { ...MINIMAL_VALID_CONFIG.memory, mode: 'ephemeral' },
    });
    expect(eph._tag).toBe('Right');

    const per = S.decodeUnknownEither(ConfigSchema)({
      ...MINIMAL_VALID_CONFIG,
      memory: { ...MINIMAL_VALID_CONFIG.memory, mode: 'persistent' },
    });
    expect(per._tag).toBe('Right');
  });

  it('rejects invalid memory.mode', () => {
    const result = S.decodeUnknownEither(ConfigSchema)({
      ...MINIMAL_VALID_CONFIG,
      memory: { ...MINIMAL_VALID_CONFIG.memory, mode: 'invalid' },
    } as unknown as Record<string, unknown>);
    expect(result._tag).toBe('Left');
  });
});

// ─── Redaction Tests ─────────────────────────────────────────────────

describe('redactConfig', () => {
  const makeConfig = (): Config => ({
    ...MINIMAL_VALID_CONFIG,
    telegram: { bot_token: 'supersecret', allowed_user_ids: [123] },
    llm: { ...MINIMAL_VALID_CONFIG.llm, api_key: 'sk-abc' },
  });

  it('redacts telegram.bot_token', () => {
    const redacted = redactConfig(makeConfig());
    expect(redacted.telegram.bot_token).toBe('***redacted***');
  });

  it('redacts llm.api_key', () => {
    const redacted = redactConfig(makeConfig());
    expect(redacted.llm.api_key).toBe('***redacted***');
  });

  it('does not mutate the original config', () => {
    const original = makeConfig();
    redactConfig(original);
    expect(original.telegram.bot_token).toBe('supersecret');
  });
});

// ─── Defaults Tests ──────────────────────────────────────────────────

describe('getDefaultConfig', () => {
  it('returns a valid config with all defaults', () => {
    const config = getDefaultConfig();
    expect(config.llm.provider).toBe('opencode-go');
    expect(config.llm.model).toBe('deepseek-v4-flash');
    expect(config.llm.reasoning).toBe('high');
    expect(config.memory.enabled).toBe(true);
    expect(config.memory.mode).toBe('ephemeral');
    expect(config.memory.search.max_results).toBe(5);
    expect(config.memory.cache.max_entries).toBe(100);
    expect(config.memory.cache.max_size_bytes).toBe(104_857_600);
    expect(config.bot.streaming_preview).toBe(true);
    expect(config.vault_directories).toEqual([]);
    expect(config.system_prompt).toBeUndefined();
  });

  it('has an empty bot_token by default', () => {
    expect(getDefaultConfig().telegram.bot_token).toBe('');
  });
});

describe('mergeConfig', () => {
  it('merges partial overrides into defaults', () => {
    const merged = mergeConfig({
      telegram: { bot_token: 'abc', allowed_user_ids: [1, 2] },
    } as Partial<Config>);
    expect(merged.telegram.bot_token).toBe('abc');
    expect(merged.telegram.allowed_user_ids).toEqual([1, 2]);
    expect(merged.llm.provider).toBe('opencode-go');
    expect(merged.memory.enabled).toBe(true);
    expect(merged.memory.mode).toBe('ephemeral');
    expect(merged.vault_directories).toEqual([]);
  });

  it('preserves sibling fields on nested merge', () => {
    const merged = mergeConfig({
      llm: { api_key: 'sk-test' },
    } as Partial<Config>);
    expect(merged.llm.api_key).toBe('sk-test');
    expect(merged.llm.provider).toBe('opencode-go');
  });

  it('merges vault_directories', () => {
    const merged = mergeConfig({
      vault_directories: ['/Users/me/docs'],
    } as Partial<Config>);
    expect(merged.vault_directories).toEqual(['/Users/me/docs']);
  });
});

describe('validateSemantic', () => {
  it('accepts a valid config', () => {
    const config = mergeConfig({
      telegram: { bot_token: 'valid:token', allowed_user_ids: [123456] },
    } as Partial<Config>);
    expect(validateSemantic(config)).toEqual([]);
  });

  it('rejects empty bot_token', () => {
    const errors = validateSemantic(getDefaultConfig());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.toLowerCase()).toContain('bot_token');
  });

  it('rejects invalid cache settings', () => {
    const errors = validateSemantic(
      mergeConfig({
        memory: { cache: { max_entries: 0, max_size_bytes: 100 } },
      } as unknown as Partial<Config>),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ─── Path Resolution Tests ───────────────────────────────────────────

describe('resolveConfigDir', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses TELE_KB_BOT_CONFIG env var', () => {
    process.env = { ...originalEnv, TELE_KB_BOT_CONFIG: '/custom/path' };
    expect(resolveConfigDir()).toBe('/custom/path');
  });

  it('defaults to ~/.config/tele-kb-bot/', () => {
    process.env = { ...originalEnv };
    delete process.env.TELE_KB_BOT_CONFIG;
    const dir = resolveConfigDir();
    expect(dir).toContain('.config/tele-kb-bot');
    expect(dir).not.toContain('undefined');
  });

  it('falls back to default when env var is an empty string', () => {
    process.env = { ...originalEnv, TELE_KB_BOT_CONFIG: '' };
    const dir = resolveConfigDir();
    expect(dir).toContain('.config/tele-kb-bot');
    expect(dir).not.toContain('undefined');
  });
});

// ─── Expanded Path Tests ────────────────────────────────────────────

describe('resolveConfigPath', () => {
  it('joins segments relative to config dir', () => {
    const result = resolveConfigPath('subdir', 'file.yaml');
    expect(result).toBe(join(resolveConfigDir(), 'subdir', 'file.yaml'));
  });
});

describe('getConfigSubdirs', () => {
  it('returns all expected subdirectory paths', () => {
    const configDir = '/tmp/test-config';
    const subdirs = getConfigSubdirs(configDir);
    expect(subdirs.AGENTS).toBe('/tmp/test-config/agents');
    expect(subdirs.MEMORY).toBe('/tmp/test-config/memory');
    expect(subdirs.MEMORY_DAILY).toBe('/tmp/test-config/memory/daily');
    expect(subdirs.TELEGRAM_TMP).toBe('/tmp/test-config/telegram-tmp');
    expect(subdirs.LOGS).toBe('/tmp/test-config/logs');
  });

  it('returns 5 entries', () => {
    const subdirs = getConfigSubdirs('/tmp');
    expect(Object.keys(subdirs).length).toBe(5);
  });
});

describe('ensureConfigDirsSync', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates config directory and all subdirectories', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    ensureConfigDirsSync(tmpDir);
    expect(existsSync(tmpDir)).toBe(true);
    expect(existsSync(join(tmpDir, 'agents'))).toBe(true);
    expect(existsSync(join(tmpDir, 'memory'))).toBe(true);
    expect(existsSync(join(tmpDir, 'memory', 'daily'))).toBe(true);
    expect(existsSync(join(tmpDir, 'telegram-tmp'))).toBe(true);
    expect(existsSync(join(tmpDir, 'logs'))).toBe(true);
  });

  it('handles pre-existing directories without error', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    mkdirSync(join(tmpDir, 'agents'), { recursive: true });
    expect(() => ensureConfigDirsSync(tmpDir)).not.toThrow();
    expect(existsSync(join(tmpDir, 'agents'))).toBe(true);
  });

  it('handles permission errors gracefully', () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      // Making the parent read-only causes mkdirSync for subdirs to fail
      chmodSync(parentDir, 0o444);
      const nestedConfigDir = join(parentDir, 'config');
      expect(() => ensureConfigDirsSync(nestedConfigDir)).not.toThrow();
    } finally {
      chmodSync(parentDir, 0o755);
      rmSync(parentDir, { recursive: true, force: true });
    }
  });
});

describe('ensureConfigDirs', () => {
  const dirRuntime = ManagedRuntime.make(Layer.merge(BunFileSystem.layer, EffectLoggerLive('test', 'silent')));

  it('creates all config directories using the FileSystem service', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      await dirRuntime.runPromise(ensureConfigDirs(tmpDir));
      expect(existsSync(join(tmpDir, 'agents'))).toBe(true);
      expect(existsSync(join(tmpDir, 'memory'))).toBe(true);
      expect(existsSync(join(tmpDir, 'memory', 'daily'))).toBe(true);
      expect(existsSync(join(tmpDir, 'telegram-tmp'))).toBe(true);
      expect(existsSync(join(tmpDir, 'logs'))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── Loader Tests ────────────────────────────────────────────────────

describe('loadConfigFromEnv', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads config from env vars', () => {
    process.env = {
      ...originalEnv,
      TELEGRAM_BOT_TOKEN: 'env:token',
      TELEGRAM_ALLOWED_USER_IDS: '111,222',
      OPENER_GO_API_KEY: 'env:key',
    };
    const config = loadConfigFromEnv();
    expect(config.telegram.bot_token).toBe('env:token');
    expect(config.telegram.allowed_user_ids).toEqual([111, 222]);
    expect(config.llm.api_key).toBe('env:key');
  });

  it('returns defaults when no env vars set', () => {
    process.env = { ...originalEnv };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    delete process.env.OPENER_GO_API_KEY;
    const config = loadConfigFromEnv();
    expect(config.telegram.bot_token).toBe('');
    expect(config.llm.api_key).toBeUndefined();
  });
});

describe('loadConfig (Effect + FileSystem)', () => {
  const testRuntime = ManagedRuntime.make(Layer.merge(BunFileSystem.layer, EffectLoggerLive('test', 'silent')));

  it('fails when config dir does not exist', async () => {
    const result = await testRuntime.runPromise(loadConfig('/completely-nonexistent-xyz').pipe(Effect.exit));
    expect(result._tag).toBe('Failure');
  });

  it('returns env-only source when env vars provide a valid config but no config file', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test:envtoken';
    process.env.TELEGRAM_ALLOWED_USER_IDS = '123456';
    try {
      const result = await testRuntime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem;
            const tmpDir = yield* fs.makeTempDirectoryScoped();
            return yield* loadConfig(tmpDir);
          }),
        ),
      );
      expect(result.source).toBe('env-only');
      expect(result.config.telegram.bot_token).toBe('test:envtoken');
      expect(result.config.telegram.allowed_user_ids).toEqual([123456]);
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    }
  });

  it('returns ConfigLoadError for invalid YAML content', async () => {
    const exit = await testRuntime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const tmpDir = yield* fs.makeTempDirectoryScoped();
          yield* fs.writeFileString(`${tmpDir}/config.yaml`, 'invalid: [yaml: broken');
          return yield* loadConfig(tmpDir);
        }),
      ).pipe(Effect.exit),
    );
    expect(exit._tag).toBe('Failure');
  });

  it('loads a valid config file successfully', async () => {
    const result = await testRuntime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const tmpDir = yield* fs.makeTempDirectoryScoped();
          yield* fs.writeFileString(
            `${tmpDir}/config.yaml`,
            [
              'telegram:',
              '  bot_token: "test:validtoken"',
              '  allowed_user_ids: [123456]',
              'llm:',
              '  provider: opencode-go',
              '  model: deepseek-v4-flash',
              '  reasoning: high',
              'memory:',
              '  enabled: true',
              '  mode: ephemeral',
              '  auto_inject: true',
              '  search:',
              '    max_results: 5',
              '    mode: keyword',
              '  cache:',
              '    max_entries: 100',
              '    max_size_bytes: 104857600',
              '  qmd:',
              '    enabled: false',
              '    binary_path: qmd',
              'bot:',
              '  max_attachments_per_turn: 10',
              '  streaming_preview: true',
              '  text_chunk_size: 4096',
              'vault_directories: []',
            ].join('\n'),
          );
          return yield* loadConfig(tmpDir);
        }),
      ),
    );
    expect(result.source).toBe('file');
    expect(result.config.telegram.bot_token).toBe('test:validtoken');
    expect(result.config.telegram.allowed_user_ids).toEqual([123456]);
    expect(result.config.llm.provider).toBe('opencode-go');
    expect(result.configDir).toBeDefined();
  });

  it('returns ConfigValidationError when semantic validation fails (empty bot_token)', async () => {
    const exit = await testRuntime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const tmpDir = yield* fs.makeTempDirectoryScoped();
          yield* fs.writeFileString(
            `${tmpDir}/config.yaml`,
            [
              'telegram:',
              '  bot_token: ""',
              '  allowed_user_ids: [123456]',
              'llm:',
              '  provider: opencode-go',
              '  model: deepseek-v4-flash',
              '  reasoning: high',
              'memory:',
              '  enabled: true',
              '  mode: ephemeral',
              '  auto_inject: true',
              '  search:',
              '    max_results: 5',
              '    mode: keyword',
              '  cache:',
              '    max_entries: 100',
              '    max_size_bytes: 104857600',
              '  qmd:',
              '    enabled: false',
              '    binary_path: qmd',
              'bot:',
              '  max_attachments_per_turn: 10',
              '  streaming_preview: true',
              '  text_chunk_size: 4096',
              'vault_directories: []',
            ].join('\n'),
          );
          return yield* loadConfig(tmpDir);
        }),
      ).pipe(Effect.exit),
    );
    expect(exit._tag).toBe('Failure');
  });
});

// ─── Sync Loader Tests ───────────────────────────────────────────────

describe('loadConfigSync', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads a valid config file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'config.yaml'),
        [
          'telegram:',
          '  bot_token: "sync:token"',
          '  allowed_user_ids: [987]',
          'memory:',
          '  enabled: true',
          '  mode: ephemeral',
          '  auto_inject: true',
          '  search:',
          '    max_results: 5',
          '    mode: keyword',
          '  cache:',
          '    max_entries: 100',
          '    max_size_bytes: 104857600',
          '  qmd:',
          '    enabled: false',
          '    binary_path: qmd',
          'bot:',
          '  max_attachments_per_turn: 10',
          '  streaming_preview: true',
          '  text_chunk_size: 4096',
          'vault_directories: []',
        ].join('\n'),
      );
      const result = loadConfigSync(tmpDir);
      expect(result.source).toBe('file');
      expect(result.config.telegram.bot_token).toBe('sync:token');
      expect(result.config.telegram.allowed_user_ids).toEqual([987]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws ConfigLoadError for invalid YAML', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(join(tmpDir, 'config.yaml'), 'invalid: [yaml: broken');
      expect(() => loadConfigSync(tmpDir)).toThrow(ConfigLoadError);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('applies env overrides on top of file config', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: 'env:override' };
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'config.yaml'),
        [
          'telegram:',
          '  bot_token: "file:token"',
          '  allowed_user_ids: [1]',
          'memory:',
          '  enabled: true',
          '  mode: ephemeral',
          '  auto_inject: true',
          '  search:',
          '    max_results: 5',
          '    mode: keyword',
          '  cache:',
          '    max_entries: 100',
          '    max_size_bytes: 104857600',
          '  qmd:',
          '    enabled: false',
          '    binary_path: qmd',
          'bot:',
          '  max_attachments_per_turn: 10',
          '  streaming_preview: true',
          '  text_chunk_size: 4096',
          'vault_directories: []',
        ].join('\n'),
      );
      const result = loadConfigSync(tmpDir);
      expect(result.config.telegram.bot_token).toBe('env:override');
      expect(result.source).toBe('file');
    } finally {
      process.env = originalEnv;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws ConfigValidationError when no config file and no env overrides', () => {
    process.env = { ...originalEnv };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    delete process.env.OPENER_GO_API_KEY;
    delete process.env.VAULT_DIRECTORIES;
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      mkdirSync(tmpDir, { recursive: true });
      expect(() => loadConfigSync(tmpDir)).toThrow(ConfigValidationError);
    } finally {
      process.env = originalEnv;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('applyEnvOverrides', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('overrides bot_token from TELEGRAM_BOT_TOKEN', () => {
    process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: 'env:token' };
    const config = loadConfigFromEnv();
    expect(config.telegram.bot_token).toBe('env:token');
  });

  it('overrides allowed_user_ids from TELEGRAM_ALLOWED_USER_IDS', () => {
    process.env = { ...originalEnv, TELEGRAM_ALLOWED_USER_IDS: '111,222,333' };
    const config = loadConfigFromEnv();
    expect(config.telegram.allowed_user_ids).toEqual([111, 222, 333]);
  });

  it('parses allowed_user_ids with whitespace around values', () => {
    process.env = { ...originalEnv, TELEGRAM_ALLOWED_USER_IDS: ' 111 , 222 ' };
    const config = loadConfigFromEnv();
    expect(config.telegram.allowed_user_ids).toEqual([111, 222]);
  });

  it('overrides api_key from OPENER_GO_API_KEY', () => {
    process.env = { ...originalEnv, OPENER_GO_API_KEY: 'env:apikey' };
    const config = loadConfigFromEnv();
    expect(config.llm.api_key).toBe('env:apikey');
  });

  it('overrides vault_directories from VAULT_DIRECTORIES', () => {
    process.env = { ...originalEnv, VAULT_DIRECTORIES: '/path/one:/path/two' };
    const config = loadConfigFromEnv();
    expect(config.vault_directories).toEqual(['/path/one', '/path/two']);
  });

  it('handles empty env vars by preserving defaults', () => {
    process.env = { ...originalEnv };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    delete process.env.OPENER_GO_API_KEY;
    delete process.env.VAULT_DIRECTORIES;
    const config = loadConfigFromEnv();
    expect(config.telegram.bot_token).toBe('');
    expect(config.telegram.allowed_user_ids).toEqual([]);
    expect(config.llm.api_key).toBeUndefined();
    expect(config.vault_directories).toEqual([]);
  });

  it('preserves original allowed_user_ids when env var is empty string (falsy)', () => {
    process.env = { ...originalEnv, TELEGRAM_ALLOWED_USER_IDS: '' };
    const config = loadConfigFromEnv();
    // Empty string is falsy, so the original default (empty array) is preserved
    expect(config.telegram.allowed_user_ids).toEqual([]);
  });

  it('handles negative number inputs in TELEGRAM_ALLOWED_USER_IDS', () => {
    process.env = {
      ...originalEnv,
      TELEGRAM_ALLOWED_USER_IDS: '-123,-456',
    };
    const config = loadConfigFromEnv();
    expect(config.telegram.allowed_user_ids).toEqual([-123, -456]);
  });
});

describe('hasEnvOverrides', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('sets source to env-only when env vars provide a valid config but no config file', () => {
    process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: 'test:token', TELEGRAM_ALLOWED_USER_IDS: '123456' };
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      mkdirSync(tmpDir, { recursive: true });
      const result = loadConfigSync(tmpDir);
      expect(result.source).toBe('env-only');
    } finally {
      process.env = originalEnv;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws ConfigValidationError when no config file and no env vars', () => {
    process.env = { ...originalEnv };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    delete process.env.OPENER_GO_API_KEY;
    delete process.env.VAULT_DIRECTORIES;
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      mkdirSync(tmpDir, { recursive: true });
      expect(() => loadConfigSync(tmpDir)).toThrow(ConfigValidationError);
    } finally {
      process.env = originalEnv;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('sets source to file when config file exists regardless of env vars', () => {
    process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: 'env:token' };
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'config.yaml'),
        [
          'telegram:',
          '  bot_token: "file:token"',
          '  allowed_user_ids: [1]',
          'memory:',
          '  enabled: true',
          '  mode: ephemeral',
          '  auto_inject: true',
          '  search:',
          '    max_results: 5',
          '    mode: keyword',
          '  cache:',
          '    max_entries: 100',
          '    max_size_bytes: 104857600',
          '  qmd:',
          '    enabled: false',
          '    binary_path: qmd',
          'bot:',
          '  max_attachments_per_turn: 10',
          '  streaming_preview: true',
          '  text_chunk_size: 4096',
          'vault_directories: []',
        ].join('\n'),
      );
      const result = loadConfigSync(tmpDir);
      expect(result.source).toBe('file');
    } finally {
      process.env = originalEnv;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('sets source to defaults when no relevant env vars are set and no config file', () => {
    process.env = { ...originalEnv };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    delete process.env.OPENER_GO_API_KEY;
    delete process.env.VAULT_DIRECTORIES;
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      mkdirSync(tmpDir, { recursive: true });
      // No config file + no env vars → ConfigValidationError
      expect(() => loadConfigSync(tmpDir)).toThrow(ConfigValidationError);
    } finally {
      process.env = originalEnv;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('parseYamlToPartial', () => {
  it('fills missing sections with defaults when YAML has only telegram section', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'config.yaml'),
        ['telegram:', '  bot_token: "minimal:token"', '  allowed_user_ids: [42]'].join('\n'),
      );
      const result = loadConfigSync(tmpDir);
      // telegram section should come from file
      expect(result.config.telegram.bot_token).toBe('minimal:token');
      // missing sections should use defaults
      expect(result.config.llm.provider).toBe('opencode-go');
      expect(result.config.memory.enabled).toBe(true);
      expect(result.config.bot.streaming_preview).toBe(true);
      expect(result.config.vault_directories).toEqual([]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('parses all config sections from a full YAML config', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tele-kb-bot-test-'));
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'config.yaml'),
        [
          'telegram:',
          '  bot_token: "test:token"',
          '  allowed_user_ids: [1, 2, 3]',
          'llm:',
          '  provider: custom-provider',
          '  model: custom-model',
          '  reasoning: low',
          '  api_key: custom-key',
          'memory:',
          '  enabled: false',
          '  mode: persistent',
          '  auto_inject: false',
          '  search:',
          '    max_results: 10',
          '    mode: semantic',
          '  cache:',
          '    max_entries: 200',
          '    max_size_bytes: 524288000',
          '  qmd:',
          '    enabled: true',
          '    binary_path: /usr/local/bin/qmd',
          'bot:',
          '  max_attachments_per_turn: 20',
          '  streaming_preview: false',
          '  text_chunk_size: 2048',
          'vault_directories:',
          '  - /Users/test/vault1',
          '  - /Users/test/vault2',
          'system_prompt: "custom system prompt"',
        ].join('\n'),
      );
      const result = loadConfigSync(tmpDir);
      expect(result.config.telegram.bot_token).toBe('test:token');
      expect(result.config.telegram.allowed_user_ids).toEqual([1, 2, 3]);
      expect(result.config.llm.provider).toBe('custom-provider');
      expect(result.config.llm.model).toBe('custom-model');
      expect(result.config.llm.reasoning).toBe('low');
      expect(result.config.llm.api_key).toBe('custom-key');
      expect(result.config.memory.enabled).toBe(false);
      expect(result.config.memory.mode).toBe('persistent');
      expect(result.config.memory.auto_inject).toBe(false);
      expect(result.config.memory.search.max_results).toBe(10);
      expect(result.config.memory.search.mode).toBe('semantic');
      expect(result.config.memory.cache.max_entries).toBe(200);
      expect(result.config.memory.cache.max_size_bytes).toBe(524288000);
      expect(result.config.memory.qmd.enabled).toBe(true);
      expect(result.config.memory.qmd.binary_path).toBe('/usr/local/bin/qmd');
      expect(result.config.bot.max_attachments_per_turn).toBe(20);
      expect(result.config.bot.streaming_preview).toBe(false);
      expect(result.config.bot.text_chunk_size).toBe(2048);
      expect(result.config.vault_directories).toEqual(['/Users/test/vault1', '/Users/test/vault2']);
      expect(result.config.system_prompt).toBe('custom system prompt');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('ConfigLoadError', () => {
  it('is tagged with ConfigLoadError and carries a message', () => {
    const error = new ConfigLoadError({ message: 'test error message' });
    expect(error._tag).toBe('ConfigLoadError');
    expect(error.message).toBe('test error message');
  });
});

describe('ConfigValidationError', () => {
  it('is tagged with ConfigValidationError and carries errors and configPath', () => {
    const error = new ConfigValidationError({
      errors: ['validation failed', 'missing field'],
      configPath: '/path/to/config.yaml',
    });
    expect(error._tag).toBe('ConfigValidationError');
    expect(error.errors).toEqual(['validation failed', 'missing field']);
    expect(error.configPath).toBe('/path/to/config.yaml');
  });
});
