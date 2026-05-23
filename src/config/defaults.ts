/**
 * Default config values and deep merge utilities.
 *
 * All functions are pure — no side effects, no IO.
 *
 * @module
 */

import type { Config } from './schema';

/**
 * Return a complete Config object with all defaults applied.
 */
const getDefaultConfig = (): Config => ({
  telegram: {
    bot_token: '',
    allowed_user_ids: [],
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
    search: {
      max_results: 5,
      mode: 'keyword',
    },
    cache: {
      max_entries: 100,
      max_size_bytes: 104_857_600, // 100 MB
    },
    qmd: {
      enabled: false,
      binary_path: 'qmd',
    },
  },
  bot: {
    max_attachments_per_turn: 10,
    streaming_preview: true,
    text_chunk_size: 4096,
    max_sessions: 5,
  },
  vault_directories: [],
  system_prompt: undefined,
});

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Record<string, unknown> ? DeepPartial<T[P]> : T[P];
};

/**
 * Deep-merge partial overrides into the default config.
 * Missing fields are filled from defaults.
 */
const mergeConfig = (overrides: DeepPartial<Config>): Config =>
  deepMerge(getDefaultConfig(), overrides as Record<string, unknown>) as Config;

const deepMerge = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    if (srcVal === undefined) continue;
    const tgtVal = target[key];
    if (
      typeof srcVal === 'object' &&
      srcVal !== null &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === 'object' &&
      tgtVal !== null &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
};

/**
 * Semantic validation errors beyond schema checks.
 * Returns human-readable messages, empty array = valid.
 */
const validateSemantic = (config: Config): ReadonlyArray<string> => {
  const errors: Array<string> = [];
  if (!config.telegram.bot_token) {
    errors.push("telegram.bot_token: Required. Run 'tele-kb-bot setup' first.");
  }
  if (config.telegram.allowed_user_ids.length === 0 && config.telegram.bot_token) {
    errors.push('telegram.allowed_user_ids: At least one user ID is required.');
  }
  if (config.memory.cache.max_entries < 1) {
    errors.push('memory.cache.max_entries: Must be at least 1.');
  }
  if (config.memory.cache.max_size_bytes < 1024) {
    errors.push('memory.cache.max_size_bytes: Must be at least 1 KB.');
  }
  return errors;
};

export type { DeepPartial };
export { getDefaultConfig, mergeConfig, validateSemantic };
