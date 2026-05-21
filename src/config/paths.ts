/**
 * Config directory resolution for tele-kb-bot.
 *
 * Resolution priority:
 * 1. `TELE_KB_BOT_CONFIG` environment variable
 * 2. `~/.config/tele-kb-bot/` (XDG-compatible default)
 *
 * @module
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform/FileSystem';
import { Effect } from 'effect';

const CONFIG_DIR_NAME = 'tele-kb-bot';
const CONFIG_ENV_VAR = 'TELE_KB_BOT_CONFIG';

/**
 * Resolve the config directory path.
 * Priority: TELE_KB_BOT_CONFIG env var > ~/.config/tele-kb-bot/
 */
const resolveConfigDir = (): string => {
  const envOverride = process.env[CONFIG_ENV_VAR];
  if (envOverride && envOverride.length > 0) return envOverride;
  return join(homedir(), '.config', CONFIG_DIR_NAME);
};

/**
 * Resolve a path relative to the config directory.
 */
const resolveConfigPath = (...segments: Array<string>): string => join(resolveConfigDir(), ...segments);

const SUBDIRS = {
  AGENTS: 'agents',
  MEMORY: 'memory',
  MEMORY_DAILY: 'memory/daily',
  TELEGRAM_TMP: 'telegram-tmp',
  LOGS: 'logs',
} as const;

type SubdirMap = { readonly [K in keyof typeof SUBDIRS]: string };

/**
 * Return all config subdirectory paths relative to a config directory.
 */
const getConfigSubdirs = (configDir: string): SubdirMap => ({
  AGENTS: join(configDir, SUBDIRS.AGENTS),
  MEMORY: join(configDir, SUBDIRS.MEMORY),
  MEMORY_DAILY: join(configDir, SUBDIRS.MEMORY_DAILY),
  TELEGRAM_TMP: join(configDir, SUBDIRS.TELEGRAM_TMP),
  LOGS: join(configDir, SUBDIRS.LOGS),
});

/**
 * Ensure the config directory and all subdirectories exist.
 * Synchronous version for CLI setup (no Effect dependency).
 * Permissions: 0o700 for all dirs.
 */
const ensureConfigDirsSync = (configDir: string): void => {
  const dirs = [configDir, ...Object.values(getConfigSubdirs(configDir))];
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
      // Best-effort — directory may already exist
    }
  }
};

/**
 * Ensure the config directory and all subdirectories exist.
 * Uses the FileSystem service for async directory creation.
 * Permissions: 0o700 for all dirs.
 */
const ensureConfigDirs = (configDir: string): Effect.Effect<void, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const dirs = [configDir, ...Object.values(getConfigSubdirs(configDir))];
    for (const dir of dirs) {
      yield* fs.makeDirectory(dir, { recursive: true, mode: 0o700 }).pipe(Effect.catchAll(() => Effect.void));
    }
  });

export type { SubdirMap };
export {
  CONFIG_DIR_NAME,
  CONFIG_ENV_VAR,
  ensureConfigDirs,
  ensureConfigDirsSync,
  getConfigSubdirs,
  resolveConfigDir,
  resolveConfigPath,
  SUBDIRS,
};
