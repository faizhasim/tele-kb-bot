/**
 * CLI help text generator.
 *
 * @module
 */

import { BINARY_NAME, VERSION } from '../constants';
import { blank, command, dim, header, info, section } from './output';

/**
 * Print the full help text to stdout.
 */
export function helpCommand(): void {
  header(`${BINARY_NAME} v${VERSION}`);
  blank();
  dim('A standalone Telegram bot backed by the pi coding agent SDK.');
  blank();
  section('USAGE');
  info(`${BINARY_NAME} <command> [options]`);
  blank();
  section('COMMANDS');
  command('setup', 'First-run configuration wizard');
  command('start', 'Run the daemon (foreground)');
  command('status', 'Show configuration and health status');
  command('index [build|clear]', 'Build or clear the search index');
  command('launchd add|remove', 'Manage macOS launchd service');
  command('systemd add|remove', 'Manage Linux systemd service');
  command('version', 'Print version');
  command('help', 'Print this help message');
  blank();
  section('OPTIONS');
  command('--config <path>', 'Override config directory');
  dim('                          Environment: TELE_KB_BOT_CONFIG');
  command('--non-interactive', 'Run setup without prompts');
  dim('                          All config sourced from environment');
  blank();
  section('ENVIRONMENT');
  command('TELE_KB_BOT_CONFIG', 'Config directory path');
  dim('                          Default: ~/.config/tele-kb-bot/');
  command('TELEGRAM_BOT_TOKEN', 'Bot token (for non-interactive setup)');
  command('TELEGRAM_ALLOWED_USER_IDS', 'Comma-separated Telegram user IDs');
  command('OPENER_GO_API_KEY', 'LLM API key (for non-interactive setup)');
  command('VAULT_DIRECTORIES', 'Colon-separated vault directory paths');
  command('QMD_BINARY_PATH', 'Path to qmd binary (default: qmd in PATH)');
  command('LOG_LEVEL', 'Log level: fatal | error | warn | info | debug | trace');
  blank();
  section('EXAMPLES');
  info(`${BINARY_NAME} setup`);
  info(`${BINARY_NAME} start --config ./dev-config/`);
  info(`${BINARY_NAME} status`);
  info(`${BINARY_NAME} index build`);
  info(`${BINARY_NAME} index clear`);
  info(`${BINARY_NAME} launchd add`);
  info(`${BINARY_NAME} launchd remove`);
  info(`TELEGRAM_BOT_TOKEN=xxx ${BINARY_NAME} setup --non-interactive`);
  blank();
}
