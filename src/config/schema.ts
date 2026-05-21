/**
 * tele-kb-bot config schema — defined with Effect Schema for runtime validation.
 *
 * Single source of truth for all config options. Defaults are managed by
 * the `defaults` module (merged after validation).
 *
 * @module
 */

import * as S from '@effect/schema/Schema';

// ─── LLM Provider ───────────────────────────────────────────────────

const ReasoningLevel = S.Union(S.Literal('off'), S.Literal('low'), S.Literal('medium'), S.Literal('high'));

const LlmConfig = S.Struct({
  provider: S.String,
  model: S.String,
  reasoning: ReasoningLevel,
  api_key: S.optional(S.String),
});

// ─── Telegram ────────────────────────────────────────────────────────

const TelegramConfig = S.Struct({
  bot_token: S.String,
  allowed_user_ids: S.Array(S.Number),
});

// ─── Memory / Knowledge Base ─────────────────────────────────────────

const SearchConfig = S.Struct({
  max_results: S.Number,
  mode: S.Union(S.Literal('keyword'), S.Literal('semantic')),
});

/** LRU cache configuration for search query results */
const CacheConfig = S.Struct({
  max_entries: S.Number,
  max_size_bytes: S.Number,
});

/** qmd is a local markdown search engine (https://github.com/tobi/qmd) */
const QmdConfig = S.Struct({
  enabled: S.Boolean,
  binary_path: S.String,
});

const MemoryConfig = S.Struct({
  enabled: S.Boolean,
  /** 'ephemeral' = BM25 in-memory (lost on restart), 'persistent' = qmd on-disk index */
  mode: S.Union(S.Literal('ephemeral'), S.Literal('persistent')),
  auto_inject: S.Boolean,
  search: SearchConfig,
  cache: CacheConfig,
  qmd: QmdConfig,
});

// ─── Bot ─────────────────────────────────────────────────────────────

const BotConfig = S.Struct({
  max_attachments_per_turn: S.Number,
  streaming_preview: S.Boolean,
  text_chunk_size: S.Number,
});

// ─── Root Config ─────────────────────────────────────────────────────

const ConfigSchema = S.Struct({
  telegram: TelegramConfig,
  llm: LlmConfig,
  memory: MemoryConfig,
  bot: BotConfig,
  /** Directories to scan for markdown/PDF knowledge files */
  vault_directories: S.Array(S.String),
  /** Override the default read-only system prompt. Omit or empty to use built-in default. */
  system_prompt: S.optional(S.String),
});

type Config = S.Schema.Type<typeof ConfigSchema>;

export type { Config };
export { ConfigSchema };

// ─── Redaction ───────────────────────────────────────────────────────

/** Paths within a config to redact for safe logging. */
const SECRET_PATHS: ReadonlyArray<[keyof Config, string]> = [
  ['telegram', 'bot_token'],
  ['llm', 'api_key'],
];

/**
 * Deep-clone and redact secret values from a config object.
 * Returns a new object with secrets replaced by `***redacted***`.
 */
const redactConfig = (config: Config): Config => {
  const clone = structuredClone(config) as unknown as Record<string, Record<string, unknown>>;
  for (const [section, field] of SECRET_PATHS) {
    if (clone[section]?.[field] !== undefined) {
      clone[section][field] = '***redacted***';
    }
  }
  return clone as unknown as Config;
};

export { redactConfig };
