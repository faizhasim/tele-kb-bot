/**
 * CLI help text generator.
 *
 * @module
 */

import { BINARY_NAME, VERSION } from '../constants';

/**
 * Print the full help text to stdout.
 */
export function helpCommand(): void {
  console.log(`${BINARY_NAME} v${VERSION}`);
  console.log();
  console.log('A standalone Telegram bot backed by the pi coding agent SDK.');
  console.log();
  console.log('USAGE:');
  console.log(`  ${BINARY_NAME} <command> [options]`);
  console.log();
  console.log('COMMANDS:');
  console.log('  setup       First-run configuration wizard');
  console.log('  start       Run the daemon (foreground)');
  console.log('  status      Show configuration and health status');
  console.log('  install-launchd  Create and load a launchd plist for auto-start');
  console.log('  version     Print version');
  console.log('  help        Print this help message');
  console.log();
  console.log('OPTIONS:');
  console.log('  --config <path>   Override config directory (env: TELE_KB_BOT_CONFIG)');
  console.log('  --non-interactive Run setup without prompts (env-based)');
  console.log();
  console.log('ENVIRONMENT:');
  console.log('  TELE_KB_BOT_CONFIG         Config directory path (default: ~/.config/tele-kb-bot/)');
  console.log('  TELEGRAM_BOT_TOKEN         Bot token (for non-interactive setup)');
  console.log('  TELEGRAM_ALLOWED_USER_IDS  Comma-separated user IDs');
  console.log('  OPENER_GO_API_KEY          LLM API key (for non-interactive setup)');
  console.log('  LOG_LEVEL                  Log level: fatal | error | warn | info | debug | trace');
  console.log();
  console.log('EXAMPLES:');
  console.log(`  ${BINARY_NAME} setup`);
  console.log(`  ${BINARY_NAME} start --config ./dev-config/`);
  console.log(`  ${BINARY_NAME} status`);
  console.log(`  TELEGRAM_BOT_TOKEN=xxx ${BINARY_NAME} setup --non-interactive`);
  console.log();
}
