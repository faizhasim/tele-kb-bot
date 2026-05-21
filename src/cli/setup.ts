/**
 * tele-kb-bot setup wizard — interactive first-run configuration.
 *
 * Uses @clack/prompts for a polished, guided experience.
 *
 * @module
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cancel, intro, isCancel, outro, password, select, spinner, text } from '@clack/prompts';
import yaml from 'js-yaml';
import { ensureConfigDirsSync, resolveConfigDir } from '../config/paths';
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

function buildConfig(botToken: string, allowedUserIds: number[], apiKey?: string): Record<string, unknown> {
  return {
    telegram: { bot_token: botToken, allowed_user_ids: allowedUserIds },
    llm: {
      provider: 'opencode-go',
      model: 'deepseek-v4-flash',
      reasoning: 'high',
      ...(apiKey ? { api_key: apiKey } : {}),
    },
    memory: { enabled: true, auto_inject: true, search: { max_results: 5, mode: 'keyword' } },
    bot: { max_attachments_per_turn: 10, streaming_preview: true, text_chunk_size: 4096 },
  };
}

// ─── Prompt Helpers ──────────────────────────────────────────────────

const orCancel = <T>(value: T | symbol): T => {
  if (isCancel(value)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }
  return value;
};

// ─── Main Setup Command ──────────────────────────────────────────────

export async function setupCommand(options: CLIOptions): Promise<void> {
  const log = createCLILogger(BINARY_NAME);
  const configDir = options.configOverride ?? resolveConfigDir();
  const configPath = join(configDir, CONFIG_FILENAME);

  intro(`tele-kb-bot — Setup Wizard`);

  // Check if config already exists
  if (existsSync(configPath)) {
    const overwrite = orCancel(
      await select({
        message: 'Config already exists. Overwrite?',
        options: [
          { value: true, label: 'Yes' },
          { value: false, label: 'No' },
        ],
        initialValue: false,
      }),
    );
    if (!overwrite) {
      outro('Existing config preserved.');
      return;
    }
  }

  // Ensure config directory structure
  ensureConfigDirsSync(configDir);

  // ── Collect values ──────────────────────────────────────────────

  let botToken: string;
  let allowedUserIds: number[];
  let apiKey: string | undefined;

  if (options.nonInteractive) {
    botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
    if (!botToken) {
      console.error('Missing TELEGRAM_BOT_TOKEN env var. Get a token from @BotFather on Telegram.');
      process.exit(1);
    }
    const raw = process.env.TELEGRAM_ALLOWED_USER_IDS ?? '';
    if (!raw) {
      console.error('Missing TELEGRAM_ALLOWED_USER_IDS env var. Find your ID via @userinfobot.');
      process.exit(1);
    }
    allowedUserIds = raw
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !Number.isNaN(id));
    if (allowedUserIds.length === 0) {
      console.error('TELEGRAM_ALLOWED_USER_IDS must contain at least one numeric ID.');
      process.exit(1);
    }
    apiKey = process.env.OPENER_GO_API_KEY ?? undefined;
    if (apiKey && apiKey.length === 0) apiKey = undefined;
  } else {
    // ── Bot token ────────────────────────────────────────────────
    botToken = orCancel(
      await password({
        message: 'Paste your Telegram bot token',
        validate: (v) => {
          if (!v || v.length === 0) return 'Bot token is required. Get one from @BotFather on Telegram.';
        },
      }),
    );

    // ── Allowed user IDs ──────────────────────────────────────────
    const raw = orCancel(
      await text({
        message: 'Allowed Telegram user IDs (only these users can talk to your bot)',
        placeholder: '123456,789012',
        validate: (v) => {
          if (!v) return 'Required. Enter one or more numeric user IDs.';
          const ids = v
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !Number.isNaN(n));
          if (ids.length === 0) return 'Enter at least one numeric user ID. Find yours by messaging @userinfobot.';
        },
      }),
    );
    allowedUserIds = raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n));

    // ── LLM API key ──────────────────────────────────────────────
    const addKey = orCancel(
      await select({
        message: 'Configure an LLM API key? You can also set OPENER_GO_API_KEY later.',
        options: [
          { value: true, label: 'Yes' },
          { value: false, label: 'No' },
        ],
        initialValue: true,
      }),
    );
    if (addKey) {
      apiKey = orCancel(await password({ message: 'LLM API key' }));
      if (apiKey && apiKey.length === 0) apiKey = undefined;
    }
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

  // ── Write files ─────────────────────────────────────────────────

  log.info('Writing configuration...');
  writeConfigYaml(configDir, buildConfig(botToken, allowedUserIds, apiKey));
  if (apiKey) writeAuthJson(configDir, apiKey);

  // ── Success summary ─────────────────────────────────────────────

  const lines = [
    `Config written to: ${configPath}`,
    `Telegram bot: ${bot.first_name}${bot.username ? ` (@${bot.username})` : ''}`,
  ];
  if (apiKey) lines.push('LLM API key configured');
  else lines.push('LLM API key not configured — set OPENER_GO_API_KEY env var');

  outro(lines.join('\n'));

  // ── Launchd install ─────────────────────────────────────────────

  const doInstall = orCancel(
    await select({
      message: 'Install launchd background service? (auto-start on login, restart on crash)',
      options: [
        { value: true, label: 'Yes' },
        { value: false, label: 'No' },
      ],
      initialValue: true,
    }),
  );
  if (doInstall) {
    const { installCommand } = await import('./install');
    await installCommand(options);
  }

  console.log(`Open Telegram, find @${bot.username ?? bot.first_name} and send a message.`);
  console.log(`\nCommands:\n  ${BINARY_NAME} start     Run the bot now\n  ${BINARY_NAME} status    Check health`);
}
