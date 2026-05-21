/**
 * tele-kb-bot status — show configuration and health status.
 *
 * Reports:
 * - Config file existence and validity
 * - Config directory structure
 * - Telegram bot info (if configured)
 * - Binary version
 *
 * @module
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigValidationError, loadConfigSync } from '../config/loader';
import { getConfigSubdirs, resolveConfigDir } from '../config/paths';
import { BINARY_NAME, VERSION } from '../constants';
import { createCLILogger } from '../logger';
import type { CLIOptions } from './main';

/**
 * Run the status command — print a health report to stdout.
 */
export async function statusCommand(options: CLIOptions): Promise<void> {
  const log = createCLILogger(BINARY_NAME);
  const configDir = options.configOverride ?? resolveConfigDir();
  const configPath = join(configDir, 'config.yaml');

  console.log(`\n  ${BINARY_NAME} v${VERSION}`);
  console.log(`  ${'='.repeat(40)}\n`);

  // ── Binary info ──────────────────────────────────
  console.log('  Binary information:');
  console.log(`    Path:    ${process.argv[0] ?? 'unknown'}`);
  console.log(`    Version: ${VERSION}`);
  console.log();

  // ── Config directory ──────────────────────────────
  console.log('  Config directory:');
  console.log(`    Path: ${configDir}`);

  if (existsSync(configDir)) {
    const subdirs = getConfigSubdirs(configDir);
    for (const [key, dir] of Object.entries(subdirs)) {
      const exists = existsSync(dir);
      const status = exists ? '✓' : '−';
      console.log(`    ${key.padEnd(18)} ${status}`);
    }
    console.log();
  } else {
    console.log("    ✗ Directory does not exist, run 'tele-kb-bot setup'\n");
    return;
  }

  // ── Config file ───────────────────────────────────
  console.log('  Config file:');

  if (!existsSync(configPath)) {
    console.log("    ✗ Not found. Run 'tele-kb-bot setup' first.\n");
    return;
  }

  console.log(`    ✓ ${configPath}`);

  try {
    const result = loadConfigSync(configDir);
    console.log(`    ✓ Config valid (source: ${result.source})`);
    console.log(`      Provider: ${result.config.llm.provider}/${result.config.llm.model}`);
    console.log(`      Reasoning: ${result.config.llm.reasoning}`);
    console.log(`      Allowed users: ${result.config.telegram.allowed_user_ids.join(', ') || 'none'}`);
    console.log(`      Memory: ${result.config.memory.enabled ? 'enabled' : 'disabled'}`);

    // ── Telegram bot check ──────────────────────────
    console.log();
    console.log('  Telegram bot status:');

    const token = result.config.telegram.bot_token;
    if (token && token.length > 0) {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = (await resp.json()) as {
          ok: boolean;
          result?: { first_name: string; username?: string };
          description?: string;
        };

        if (data.ok && data.result) {
          console.log(
            `    ✓ Connected as: ${data.result.first_name}${data.result.username ? ` (@${data.result.username})` : ''}`,
          );
        } else {
          console.log(`    ✗ API error: ${data.description ?? 'unknown'}`);
        }
      } catch (fetchErr) {
        log.warn({ err: fetchErr }, 'Telegram API check failed');
        console.log(`    ⚠ Network error checking bot token`);
      }
    } else {
      console.log('    ⚠ Not configured (no bot token)');
    }
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.log(`    ✗ Validation errors:`);
      for (const e of err.errors) {
        console.log(`       - ${e}`);
      }
    } else {
      console.log(`    ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log();
}
