/**
 * Config loader — loads from YAML file and env vars using Effect.
 *
 * Strategy:
 * 1. Load YAML file from `<config_dir>/config.yaml` (if exists)
 * 2. Merge with environment variable overrides
 * 3. Validate with Effect Schema
 * 4. Return validated Config or fail with tagged errors
 *
 * @module
 */

import { FileSystem } from '@effect/platform/FileSystem';
import * as S from '@effect/schema/Schema';
import { Data, Effect, pipe } from 'effect';

import yaml from 'js-yaml';
import { EffectLogger } from '../logger';
import { mergeConfig, validateSemantic } from './defaults';
import { resolveConfigDir } from './paths';
import type { Config } from './schema';
import { ConfigSchema } from './schema';

const CONFIG_FILENAME = 'config.yaml';

// ─── Tagged Errors ──────────────────────────────────────────────────

class ConfigLoadError extends Data.TaggedError('ConfigLoadError')<{
  readonly message: string;
}> {}

class ConfigValidationError extends Data.TaggedError('ConfigValidationError')<{
  readonly errors: ReadonlyArray<string>;
  readonly configPath: string;
}> {}

type LoadError = ConfigLoadError | ConfigValidationError;

// ─── Result Type ────────────────────────────────────────────────────

interface LoadConfigResult {
  readonly config: Config;
  readonly configDir: string;
  readonly source: 'file' | 'env-only' | 'defaults';
}

// ─── Internal Helpers ───────────────────────────────────────────────

/**
 * Parse a raw YAML object into a Partial<Config>.
 */
const parseYamlToPartial = (raw: Record<string, unknown>): Partial<Config> => {
  const result: Record<string, unknown> = {};

  // ── Telegram ────────────────────────────────────────────────────
  const t = raw.telegram as Record<string, unknown> | undefined;
  if (t) {
    result.telegram = {};
    if (typeof t.bot_token === 'string') (result.telegram as Record<string, unknown>).bot_token = t.bot_token;
    if (Array.isArray(t.allowed_user_ids))
      (result.telegram as Record<string, unknown>).allowed_user_ids = t.allowed_user_ids;
  }

  // ── LLM ─────────────────────────────────────────────────────────
  const l = raw.llm as Record<string, unknown> | undefined;
  if (l) {
    result.llm = {};
    if (typeof l.provider === 'string') (result.llm as Record<string, unknown>).provider = l.provider;
    if (typeof l.model === 'string') (result.llm as Record<string, unknown>).model = l.model;
    if (typeof l.reasoning === 'string') (result.llm as Record<string, unknown>).reasoning = l.reasoning;
    if (typeof l.api_key === 'string') (result.llm as Record<string, unknown>).api_key = l.api_key;
  }

  // ── Memory ──────────────────────────────────────────────────────
  const m = raw.memory as Record<string, unknown> | undefined;
  if (m) {
    result.memory = {};
    if (typeof m.enabled === 'boolean') (result.memory as Record<string, unknown>).enabled = m.enabled;
    if (typeof m.mode === 'string') (result.memory as Record<string, unknown>).mode = m.mode;
    if (typeof m.auto_inject === 'boolean') (result.memory as Record<string, unknown>).auto_inject = m.auto_inject;

    const s = m.search as Record<string, unknown> | undefined;
    if (s) {
      const search: Record<string, unknown> = {};
      if (typeof s.max_results === 'number') search.max_results = s.max_results;
      if (typeof s.mode === 'string') search.mode = s.mode;
      (result.memory as Record<string, unknown>).search = search;
    }

    const c = m.cache as Record<string, unknown> | undefined;
    if (c) {
      const cache: Record<string, unknown> = {};
      if (typeof c.max_entries === 'number') cache.max_entries = c.max_entries;
      if (typeof c.max_size_bytes === 'number') cache.max_size_bytes = c.max_size_bytes;
      (result.memory as Record<string, unknown>).cache = cache;
    }

    const q = m.qmd as Record<string, unknown> | undefined;
    if (q) {
      const qmd: Record<string, unknown> = {};
      if (typeof q.enabled === 'boolean') qmd.enabled = q.enabled;
      if (typeof q.binary_path === 'string') qmd.binary_path = q.binary_path;
      if (typeof q.update_interval_seconds === 'number') qmd.update_interval_seconds = q.update_interval_seconds;
      if (typeof q.embed_interval_seconds === 'number') qmd.embed_interval_seconds = q.embed_interval_seconds;
      (result.memory as Record<string, unknown>).qmd = qmd;
    }
    if (typeof m.search_tools_enabled === 'boolean') {
      (result.memory as Record<string, unknown>).search_tools_enabled = m.search_tools_enabled;
    }
  }

  // ── Bot ─────────────────────────────────────────────────────────
  const b = raw.bot as Record<string, unknown> | undefined;
  if (b) {
    result.bot = {};
    if (typeof b.max_attachments_per_turn === 'number')
      (result.bot as Record<string, unknown>).max_attachments_per_turn = b.max_attachments_per_turn;
    if (typeof b.streaming_preview === 'boolean')
      (result.bot as Record<string, unknown>).streaming_preview = b.streaming_preview;
    if (typeof b.text_chunk_size === 'number')
      (result.bot as Record<string, unknown>).text_chunk_size = b.text_chunk_size;
    if (typeof b.max_sessions === 'number') (result.bot as Record<string, unknown>).max_sessions = b.max_sessions;
  }

  // ── Root-level fields ───────────────────────────────────────────
  if (Array.isArray(raw.vault_directories)) {
    result.vault_directories = raw.vault_directories.filter((v): v is string => typeof v === 'string');
  }
  if (typeof raw.system_prompt === 'string') {
    result.system_prompt = raw.system_prompt;
  }

  return result as Partial<Config>;
};

/**
 * Split a platform-appropriate path separator.
 * ':' on Unix, ';' on Windows.
 */
const PATH_SEPARATOR = process.platform === 'win32' ? ';' : ':';

/**
 * Apply environment variable overrides to a config object.
 * Returns a new object with env vars merged (does not mutate input).
 */
const applyEnvOverrides = (config: Config): Config => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const userIds = process.env.TELEGRAM_ALLOWED_USER_IDS;
  const apiKey = process.env.OPENER_GO_API_KEY;
  const qmdPath = process.env.QMD_BINARY_PATH;
  const vaultDirs = process.env.VAULT_DIRECTORIES;
  const maxSessionsStr = process.env.TELEGRAM_BOT_MAX_SESSIONS;

  return {
    telegram: {
      bot_token: botToken ?? config.telegram.bot_token,
      allowed_user_ids: userIds
        ? userIds
            .split(',')
            .map((id) => parseInt(id.trim(), 10))
            .filter((id) => !Number.isNaN(id))
        : config.telegram.allowed_user_ids,
    },
    llm: {
      ...config.llm,
      api_key: apiKey ?? config.llm.api_key,
    },
    memory: {
      ...config.memory,
      qmd: qmdPath ? { ...config.memory.qmd, binary_path: qmdPath } : config.memory.qmd,
    },
    bot: {
      ...config.bot,
      ...(maxSessionsStr !== undefined
        ? (() => {
            const parsed = Number(maxSessionsStr);
            if (Number.isFinite(parsed) && parsed >= 1) {
              return { max_sessions: parsed };
            }
            return {};
          })()
        : {}),
    },
    vault_directories: vaultDirs
      ? vaultDirs
          .split(PATH_SEPARATOR)
          .map((d) => d.trim())
          .filter((d) => d.length > 0)
      : config.vault_directories,
    system_prompt: config.system_prompt,
  };
};

/**
 * Check if any tele-kb-bot env vars are set.
 */
const hasEnvOverrides = (): boolean =>
  !!(
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_ALLOWED_USER_IDS ||
    process.env.OPENER_GO_API_KEY ||
    process.env.VAULT_DIRECTORIES ||
    process.env.TELEGRAM_BOT_MAX_SESSIONS
  );

// ─── File Reading (handles PlatformError) ────────────────────────────

/**
 * Safely read a config file, converting PlatformError to ConfigLoadError.
 */
const readConfigFile = (fs: FileSystem, configPath: string): Effect.Effect<string | null, ConfigLoadError> =>
  pipe(
    fs.exists(configPath).pipe(
      Effect.catchAll((e) =>
        Effect.fail(
          new ConfigLoadError({
            message: `Failed to check ${configPath}: ${e.message}`,
          }),
        ),
      ),
    ),
    Effect.flatMap((exists) => {
      if (!exists) return Effect.succeed(null);
      return pipe(
        fs.readFileString(configPath).pipe(
          Effect.catchAll((e) =>
            Effect.fail(
              new ConfigLoadError({
                message: `Failed to read ${configPath}: ${e.message}`,
              }),
            ),
          ),
        ),
        Effect.map((s) => s as string | null),
      );
    }),
  );

// ─── Main Load Function ─────────────────────────────────────────────

/**
 * Load configuration from a directory path.
 * Returns an Effect that may fail with ConfigLoadError or ConfigValidationError.
 */
const loadConfig = (
  configDirOverride?: string,
): Effect.Effect<LoadConfigResult, LoadError, FileSystem | EffectLogger> =>
  Effect.gen(function* () {
    const configDir = configDirOverride ?? resolveConfigDir();
    const configPath = `${configDir}/${CONFIG_FILENAME}`;
    const fs = yield* FileSystem;
    const log = yield* EffectLogger;

    let fileConfig: Partial<Config> = {};
    let source: LoadConfigResult['source'] = 'defaults';

    // Read config file safely (PlatformError → ConfigLoadError)
    const rawContent = yield* readConfigFile(fs, configPath);
    if (rawContent !== null) {
      try {
        const parsed = yaml.load(rawContent) as Record<string, unknown>;
        fileConfig = parseYamlToPartial(parsed);
        source = 'file';
        yield* log.debug('Loaded config file', { configPath });
      } catch (err) {
        const msg = `Failed to parse config file ${configPath}: ${err instanceof Error ? err.message : String(err)}`;
        yield* log.error(msg, { err });
        return yield* new ConfigLoadError({ message: msg });
      }
    } else {
      yield* log.debug('No config file found, using defaults + env overrides', {
        configDir,
      });
    }

    // Merge file config into defaults
    const mergedFromFile = mergeConfig(fileConfig);

    // Apply env var overrides (returns new object, no mutation)
    const withEnv = applyEnvOverrides(mergedFromFile);

    // Schema validation via Effect Schema
    const decodedOrError = S.decodeUnknownEither(ConfigSchema)(withEnv);
    if (decodedOrError._tag === 'Left') {
      const errors = [decodedOrError.left.message];
      yield* log.error('Config schema validation failed', { errors });
      return yield* new ConfigValidationError({ errors, configPath });
    }

    const validatedConfig = decodedOrError.right;

    // Semantic validation
    const semanticErrors = validateSemantic(validatedConfig);
    if (semanticErrors.length > 0) {
      yield* log.error('Config semantic validation failed', {
        errors: semanticErrors,
      });
      return yield* new ConfigValidationError({
        errors: semanticErrors,
        configPath,
      });
    }

    // Update source if env vars contributed meaningful overrides
    if (source === 'defaults' && hasEnvOverrides()) {
      source = 'env-only';
    }

    return { config: validatedConfig, configDir, source };
  });

/**
 * Load config from environment variables only (no file).
 * Useful for testing and Nix deployments.
 */
const loadConfigFromEnv = (): Config => {
  const base = mergeConfig({});
  return applyEnvOverrides(base);
};

/**
 * Load configuration synchronously (for CLI commands).
 * Uses readFileSync instead of Effect's FileSystem service.
 */
const loadConfigSync = (configDirOverride?: string): LoadConfigResult => {
  const { readFileSync, existsSync } = require('node:fs');
  const configDir = configDirOverride ?? resolveConfigDir();
  const configPath = `${configDir}/${CONFIG_FILENAME}`;

  let fileConfig: Partial<Config> = {};
  let source: LoadConfigResult['source'] = 'defaults';

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = yaml.load(raw) as Record<string, unknown>;
      fileConfig = parseYamlToPartial(parsed);
      source = 'file';
    } catch (err) {
      throw new ConfigLoadError({
        message: `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const mergedFromFile = mergeConfig(fileConfig);
  const withEnv = applyEnvOverrides(mergedFromFile);

  const decodedOrError = S.decodeUnknownEither(ConfigSchema)(withEnv);
  if (decodedOrError._tag === 'Left') {
    throw new ConfigValidationError({ errors: [decodedOrError.left.message], configPath });
  }

  const validatedConfig = decodedOrError.right;
  const semanticErrors = validateSemantic(validatedConfig);
  if (semanticErrors.length > 0) {
    throw new ConfigValidationError({ errors: semanticErrors, configPath });
  }

  if (source === 'defaults' && hasEnvOverrides()) {
    source = 'env-only';
  }

  return { config: validatedConfig, configDir, source };
};

export type { LoadConfigResult };
export { ConfigLoadError, ConfigValidationError, loadConfig, loadConfigFromEnv, loadConfigSync };
