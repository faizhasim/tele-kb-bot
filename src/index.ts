#!/usr/bin/env bun
/**
 * tele-kb-bot — Telegram Knowledge Base Bot powered by pi SDK
 *
 * CLI entry point. Routes subcommands: setup, start, status, install, version.
 *
 * @module
 */

import { runCLI } from './cli/main';

process.title = 'tele-kb-bot';

runCLI(process.argv.slice(2)).catch((err: unknown) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
