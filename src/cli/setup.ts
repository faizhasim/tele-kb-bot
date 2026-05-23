/**
 * tele-kb-bot setup wizard — interactive first-run configuration.
 *
 * Idempotent: re-running setup preserves existing values unless explicitly changed.
 * Each field shows its current value as default; pressing Enter keeps it.
 *
 * @module
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cancel, intro, isCancel, outro, password, select, spinner, text } from '@clack/prompts';
import yaml from 'js-yaml';
import { ensureConfigDirsSync, resolveConfigDir } from '../config/paths';
import { formatSize, parseSize } from '../config/size';
import { BINARY_NAME } from '../constants';
import { createCLILogger } from '../logger';
import type { CLIOptions } from './main';

const CONFIG_FILENAME = 'config.yaml';
const AUTH_FILENAME = 'auth.json';

// ─── Telegram API ────────────────────────────────────────────────────

interface TelegramUser {
  readonly id: number;
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly username?: string;
}

async function validateBotToken(token: string): Promise<{ ok: boolean; bot?: TelegramUser; error?: string }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = (await response.json()) as { ok: boolean; result?: TelegramUser; description?: string };
    if (data.ok && data.result) return { ok: true, bot: data.result };
    return { ok: false, error: data.description ?? 'Unknown error' };
  } catch (err) {
    return { ok: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── File Writers ────────────────────────────────────────────────────

function writeConfigYaml(configDir: string, config: Record<string, unknown>): void {
  writeFileSync(
    join(configDir, CONFIG_FILENAME),
    yaml.dump(config, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }),
    { mode: 0o600 },
  );
}

function writeAuthJson(configDir: string, apiKey: string): void {
  writeFileSync(
    join(configDir, 'agents', AUTH_FILENAME),
    `${JSON.stringify({ 'opencode-go': { type: 'api_key', key: apiKey } }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

// ─── Idempotent Prompt Helpers ──────────────────────────────────────

const KEEP_HINT = 'Press Enter to keep existing value or input a new value to update.';

export async function promptText(message: string, existing?: string, placeholder?: string): Promise<string> {
  const hint = existing !== undefined ? ` ${KEEP_HINT}` : '';
  const value = orCancel(
    await text({
      message: `${message}${hint}`,
      placeholder: placeholder ?? existing ?? '',
      defaultValue: '',
    }),
  );
  if (!value && existing !== undefined) return existing;
  return value ?? '';
}

export async function promptPassword(message: string, existing?: string): Promise<string | undefined> {
  const hint = existing ? ` (press Enter to keep current key ending in …${existing.slice(-4)})` : '';
  const value = orCancel(
    await password({
      message: `${message}${hint}`,
      validate: (v: string | undefined) => {
        if (!v && existing) return undefined; // empty + existing = keep
        if (!v) return 'Required';
      },
    }),
  );
  if (!value && existing) return existing;
  return value || undefined;
}

async function promptSelect<T>(
  message: string,
  opts: Array<{ value: T; label: string }>,
  existingIndex = 0,
): Promise<T> {
  const value = orCancel(
    await select({
      message,
      options: opts as never,
      initialValue: opts[existingIndex]?.value,
    }),
  );
  return value;
}

// ─── Config Builder ──────────────────────────────────────────────────

interface SetupState {
  botToken: string;
  allowedUserIds: Array<number>;
  apiKey: string | undefined;
  memoryMode: 'ephemeral' | 'persistent';
  cacheMaxEntries: number;
  cacheMaxSizeBytes: number;
  vaultDirectories: Array<string>;
}

export function buildConfig(state: SetupState): Record<string, unknown> {
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
    bot: { max_attachments_per_turn: 10, streaming_preview: true, text_chunk_size: 4096, max_sessions: 5 },
    vault_directories: state.vaultDirectories,
  };
}

function loadExistingConfig(configDir: string): SetupState {
  const configPath = join(configDir, CONFIG_FILENAME);
  const defaults: SetupState = {
    botToken: '',
    allowedUserIds: [],
    apiKey: undefined,
    memoryMode: 'ephemeral',
    cacheMaxEntries: 100,
    cacheMaxSizeBytes: 104_857_600,
    vaultDirectories: [],
  };

  if (!existsSync(configPath)) return defaults;

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>;
    const t = parsed.telegram as Record<string, unknown> | undefined;
    const memoryRaw = parsed.memory as Record<string, unknown> | undefined;
    const cacheRaw = memoryRaw?.cache as Record<string, unknown> | undefined;

    // Read api_key from config YAML or auth.json
    let apiKey: string | undefined = (parsed.llm as Record<string, unknown> | undefined)?.api_key as string | undefined;
    if (!apiKey) {
      try {
        const authPath = join(configDir, 'agents', AUTH_FILENAME);
        if (existsSync(authPath)) {
          const authRaw = readFileSync(authPath, 'utf-8');
          const authParsed = JSON.parse(authRaw) as Record<string, unknown>;
          const entry = authParsed['opencode-go'] as Record<string, unknown> | undefined;
          if (entry && typeof entry.key === 'string') {
            apiKey = entry.key;
          }
        }
      } catch {
        // ignore
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

// ─── Prompt Helpers ──────────────────────────────────────────────────

const orCancel = <T>(value: T | symbol): T => {
  if (isCancel(value)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }
  return value;
};

/** Validate a human-readable size string like "500MB" or "2GB". */
export function validateSizeInput(input: string | undefined): string | undefined {
  if (!input || input.length === 0) return undefined;
  if (parseSize(input) !== null) return undefined;
  return 'Invalid size. Use format like "500MB", "2GB", "1500KB", "1TB".';
}

// ─── Main Setup Command ──────────────────────────────────────────────

export async function setupCommand(options: CLIOptions): Promise<void> {
  const log = createCLILogger(BINARY_NAME);
  const configDir = options.configOverride ?? resolveConfigDir();
  const configPath = join(configDir, CONFIG_FILENAME);

  intro('tele-kb-bot \u2014 Setup Wizard');

  const existing = loadExistingConfig(configDir);
  ensureConfigDirsSync(configDir);

  // ── Collect values ──────────────────────────────────────────────

  let botToken: string;
  let allowedUserIds: Array<number>;
  let apiKey: string | undefined;
  let memoryMode: 'ephemeral' | 'persistent';
  let cacheMaxEntries: number;
  let cacheMaxSizeBytes: number;
  let vaultDirectories: Array<string>;

  if (options.nonInteractive) {
    botToken = process.env.TELEGRAM_BOT_TOKEN ?? existing.botToken;
    if (!botToken) {
      console.error('Missing TELEGRAM_BOT_TOKEN env var. Get a token from @BotFather on Telegram.');
      process.exit(1);
    }
    const raw = process.env.TELEGRAM_ALLOWED_USER_IDS ?? '';
    allowedUserIds = raw
      ? raw
          .split(',')
          .map((id) => Number.parseInt(id.trim(), 10))
          .filter((id) => !Number.isNaN(id))
      : existing.allowedUserIds;
    if (allowedUserIds.length === 0 && !raw) {
      console.error('Missing TELEGRAM_ALLOWED_USER_IDS env var. Find your ID via @userinfobot.');
      process.exit(1);
    }
    apiKey = process.env.OPENER_GO_API_KEY || undefined;
    memoryMode = existing.memoryMode;
    cacheMaxEntries = existing.cacheMaxEntries;
    cacheMaxSizeBytes = existing.cacheMaxSizeBytes;
    vaultDirectories = existing.vaultDirectories;
  } else {
    // ── Bot token ────────────────────────────────────────────────
    const botTokenMaybe = await promptPassword('Paste your Telegram bot token', existing.botToken || undefined);
    if (!botTokenMaybe) {
      cancel('Bot token is required. Get one from @BotFather on Telegram.');
      process.exit(1);
    }
    botToken = botTokenMaybe;

    // ── Allowed user IDs ──────────────────────────────────────────
    const existingIdsStr = existing.allowedUserIds.length > 0 ? existing.allowedUserIds.join(',') : undefined;
    const idsRaw = await promptText(
      'Allowed Telegram user IDs (only these users can talk to your bot)',
      existingIdsStr,
      existingIdsStr ? undefined : '123456,789012',
    );
    const ids = idsRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const n = Number.parseInt(s, 10);
        return Number.isNaN(n) ? undefined : n;
      })
      .filter((n): n is number => n !== undefined);
    allowedUserIds = ids.length > 0 ? ids : existing.allowedUserIds;

    // ── LLM API key ──────────────────────────────────────────────
    if (existing.apiKey) {
      // Key exists — ask whether to keep or replace
      const replaceKey = await promptSelect<string>(
        `Use existing LLM API key (ending in \u2026${existing.apiKey.slice(-4)})?`,
        [
          { value: 'keep', label: 'Yes, use existing key' },
          { value: 'replace', label: 'No, enter a new key' },
        ],
        0,
      );
      apiKey = replaceKey === 'replace' ? await promptPassword('New LLM API key') : existing.apiKey;
    } else {
      // No key — ask whether to configure one
      const addKey = await promptSelect<string>(
        'Configure an LLM API key? (You can also set OPENER_GO_API_KEY later)',
        [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
        1,
      );
      apiKey = addKey === 'yes' ? await promptPassword('LLM API key') : undefined;
    }

    // ── Memory mode ──────────────────────────────────────────────
    const modeIdx = existing.memoryMode === 'persistent' ? 1 : 0;
    memoryMode = await promptSelect<typeof memoryMode>(
      'Memory mode',
      [
        { value: 'ephemeral', label: 'Ephemeral (BM25 in-memory, rebuilt on restart, no external deps)' },
        { value: 'persistent', label: 'Persistent (qmd on-disk index, survives restarts, requires qmd binary)' },
      ],
      modeIdx,
    );

    // ── Cache max entries ────────────────────────────────────────
    const entriesRaw = await promptText(
      'Cache max entries (number of recent query results to remember)',
      String(existing.cacheMaxEntries),
      '100',
    );
    const entriesNum = Number.parseInt(entriesRaw, 10);
    cacheMaxEntries = !Number.isNaN(entriesNum) && entriesNum > 0 ? entriesNum : existing.cacheMaxEntries;

    // ── Cache max size ───────────────────────────────────────────
    const existingSizeStr = formatSize(existing.cacheMaxSizeBytes);
    const sizeRaw = await text({
      message: `Cache max size (max memory/disk for cached search results) ${KEEP_HINT}`,
      placeholder: existingSizeStr,
      defaultValue: '',
      validate: validateSizeInput,
    });
    const sizeVal = orCancel(sizeRaw);
    const parsedSize = sizeVal.length > 0 ? parseSize(sizeVal) : null;
    cacheMaxSizeBytes = parsedSize !== null ? parsedSize : existing.cacheMaxSizeBytes;

    // ── Vault directories ────────────────────────────────────────
    const existingVaultStr = existing.vaultDirectories.length > 0 ? existing.vaultDirectories.join(', ') : undefined;
    const vaultsRaw = await promptText(
      'Path(s) to vault directories (markdown/PDF knowledge bases). Comma-separate multiple paths.',
      existingVaultStr,
      existingVaultStr ? undefined : '/Users/me/Obsidian/Main, /Users/me/Obsidian/Work',
    );
    vaultDirectories = vaultsRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        if (s.startsWith('~')) {
          console.warn(`  Skipping "${s}" — please use absolute paths (not ~).`);
          return undefined;
        }
        return s;
      })
      .filter((s): s is string => s !== undefined);
  }

  // ── Validate bot token ──────────────────────────────────────────

  const s = spinner();
  s.start('Validating Telegram bot token...');
  const validation = await validateBotToken(botToken);
  s.stop(validation.ok ? 'Bot token verified' : 'Bot token validation failed');

  if (!validation.ok || !validation.bot) {
    cancel(`Bot token validation failed: ${validation.error}. Get a new token from @BotFather on Telegram.`);
    process.exit(1);
  }

  const bot = validation.bot;

  // Recover API key from auth.json if not set by wizard
  if (!apiKey) {
    const authPath = join(configDir, 'agents', AUTH_FILENAME);
    if (existsSync(authPath)) {
      try {
        const authRaw = readFileSync(authPath, 'utf-8');
        const authParsed = JSON.parse(authRaw) as Record<string, unknown>;
        const entry = authParsed['opencode-go'] as Record<string, unknown> | undefined;
        if (entry && typeof entry.key === 'string') {
          apiKey = entry.key;
        }
      } catch {
        // ignore
      }
    }
  }

  // ── Write files ─────────────────────────────────────────────────

  log.info('Writing configuration...');
  writeConfigYaml(
    configDir,
    buildConfig({
      botToken,
      allowedUserIds,
      apiKey,
      memoryMode,
      cacheMaxEntries,
      cacheMaxSizeBytes,
      vaultDirectories,
    }),
  );
  if (apiKey) writeAuthJson(configDir, apiKey);

  // ── Success summary ─────────────────────────────────────────────

  const changes: Array<string> = [
    `Config written to: ${configPath}`,
    `Telegram bot: ${bot.first_name}${bot.username ? ` (@${bot.username})` : ''}`,
    `Memory mode: ${memoryMode}`,
    `Cache: ${cacheMaxEntries} entries, ${formatSize(cacheMaxSizeBytes)} max`,
  ];
  if (vaultDirectories.length > 0) {
    changes.push(`Vault directories: ${vaultDirectories.join(', ')}`);
  }
  if (apiKey) changes.push('LLM API key configured');
  else changes.push('LLM API key not configured — set OPENER_GO_API_KEY env var');

  outro(changes.join('\n'));

  // ── Launchd install ─────────────────────────────────────────────

  const doInstall = orCancel(
    await select({
      message: 'Install launchd background service? (auto-start on login, restart on crash)',
      options: [
        { value: true, label: 'Yes' },
        { value: false, label: 'No' },
      ],
    }),
  );
  if (doInstall) {
    const { installCommand } = await import('./install');
    await installCommand(options);
  }

  // ── Run index? ─────────────────────────────────────────────────-

  if (vaultDirectories.length > 0 && memoryMode === 'persistent') {
    const doIndex = orCancel(
      await select({
        message: 'Build qmd search index for vault directories now?',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: "No, I'll run `tele-kb-bot index` later" },
        ],
      }),
    );
    if (doIndex === 'yes') {
      const { indexCommand } = await import('./index');
      // Reconstruct rawArgs so the subcommand is "build"
      await indexCommand({ ...options, rawArgs: ['index', 'build'] });
    } else {
      console.log(`  Run indexing later with: ${BINARY_NAME} index build`);
    }
  }

  console.log(`Open Telegram, find @${bot.username ?? bot.first_name} and send a message.`);
  console.log(
    `\nCommands:\n  ${BINARY_NAME} start     Run the bot now\n  ${BINARY_NAME} status    Check health\n  ${BINARY_NAME} index     Build search index`,
  );
}
