/**
 * Tests for the config system.
 *
 * Pure functions tested with regular assertions.
 * Effect-based functions tested with ManagedRuntime.runPromise.
 */

import { BunFileSystem } from '@effect/platform-bun';
import * as S from '@effect/schema/Schema';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { EffectLoggerLive } from '../logger';
import { getDefaultConfig, mergeConfig, validateSemantic } from './defaults';
import { loadConfig, loadConfigFromEnv } from './loader';
import { resolveConfigDir } from './paths';
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
});
