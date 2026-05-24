/**
 * tele-kb-bot systemd — Linux systemd user service management.
 *
 * systemd add      Create ~/.config/systemd/user/tele-kb-bot.service
 *                  and enable/start via systemctl --user (idempotent).
 * systemd remove   Stop, disable, and remove the service file.
 *
 * Only available on Linux. Prints a message on other platforms.
 *
 * @module
 */

import { execSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { ensureConfigDirsSync, resolveConfigDir } from '../config/paths';
import { BINARY_NAME } from '../constants';
import { createCLILogger } from '../logger';
import type { CLIOptions } from './main';
import { blank, error, info, success } from './output';

const SERVICE_NAME = BINARY_NAME;
const SYSTEMD_USER_DIR = join(homedir(), '.config', 'systemd', 'user');
const SERVICE_PATH = join(SYSTEMD_USER_DIR, `${SERVICE_NAME}.service`);

function isLinux(): boolean {
  return platform() === 'linux';
}

/**
 * Generate the systemd service unit content.
 */
function generateService(configDir: string, binaryPath: string): string {
  return `[Unit]
Description=tele-kb-bot — Telegram Knowledge Base Bot
Documentation=https://faizhasim.github.io/tele-kb-bot
After=network.target

[Service]
Type=simple
ExecStart=${binaryPath} start
Restart=on-failure
RestartSec=5
Environment=TELE_KB_BOT_CONFIG=${configDir}
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;
}

/**
 * Resolve the binary path for systemd.
 */
function resolveSystemdBinaryPath(): string {
  const currentExe = process.argv[0];
  if (currentExe && (currentExe.includes('tele-kb-bot') || currentExe.includes('bun'))) {
    if (!currentExe.includes('bun')) {
      return currentExe;
    }
  }

  const candidates = [
    `/usr/local/bin/${BINARY_NAME}`,
    `/usr/bin/${BINARY_NAME}`,
    join(homedir(), '.local', 'bin', BINARY_NAME),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return `/usr/local/bin/${BINARY_NAME}`;
}

/**
 * Create, enable, and start the systemd user service (idempotent).
 */
export async function systemdAddCommand(_options: CLIOptions): Promise<void> {
  const log = createCLILogger(BINARY_NAME);

  if (!isLinux()) {
    error('systemd services are only available on Linux.');
    info('On macOS, use: tele-kb-bot launchd add');
    blank();
    return;
  }

  const configDir = _options.configOverride ?? resolveConfigDir();
  const binaryPath = resolveSystemdBinaryPath();

  ensureConfigDirsSync(configDir);
  log.info({ servicePath: SERVICE_PATH }, 'Installing systemd service');

  // Ensure systemd user config dir exists
  if (!existsSync(SYSTEMD_USER_DIR)) {
    writeFileSync(join(SYSTEMD_USER_DIR, '.keep'), '', { mode: 0o644 });
  }

  // Write service unit
  const serviceContent = generateService(configDir, binaryPath);
  writeFileSync(SERVICE_PATH, serviceContent, { mode: 0o644 });

  blank();
  success('Systemd service unit written to:');
  info(`  ${SERVICE_PATH}`);
  blank();
  info(`Binary path: ${binaryPath}`);
  info(`Config path: ${configDir}`);
  blank();

  // Reload daemon, enable, start
  try {
    log.info('Reloading systemd daemon...');
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    success('Daemon reloaded.');
  } catch (e) {
    error(`Failed to reload systemd daemon: ${e instanceof Error ? e.message : String(e)}`);
    info('You may need to run manually:');
    info('  systemctl --user daemon-reload');
    blank();
    return;
  }

  try {
    log.info('Enabling systemd service...');
    execSync(`systemctl --user enable ${SERVICE_NAME}`, { stdio: 'pipe' });
    success('Service enabled (starts on login).');
  } catch (e) {
    error(`Failed to enable service: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    log.info('Starting systemd service...');
    execSync(`systemctl --user start ${SERVICE_NAME}`, { stdio: 'pipe' });
    success('Service started.');
  } catch (e) {
    error(`Failed to start service: ${e instanceof Error ? e.message : String(e)}`);
    info('You can start it manually:');
    info(`  systemctl --user start ${SERVICE_NAME}`);
  }

  blank();
  info('Management commands:');
  info(`  Status:  systemctl --user status ${SERVICE_NAME}`);
  info(`  Start:   systemctl --user start ${SERVICE_NAME}`);
  info(`  Stop:    systemctl --user stop ${SERVICE_NAME}`);
  info(`  Restart: systemctl --user restart ${SERVICE_NAME}`);
  info(`  Logs:    journalctl --user -u ${SERVICE_NAME} -f`);
  blank();
}

/**
 * Stop, disable, and remove the systemd user service.
 */
export async function systemdRemoveCommand(): Promise<void> {
  const log = createCLILogger(BINARY_NAME);

  if (!isLinux()) {
    error('systemd services are only available on Linux.');
    blank();
    return;
  }

  if (!existsSync(SERVICE_PATH)) {
    info('No systemd service found — nothing to remove.');
    blank();
    return;
  }

  log.info({ servicePath: SERVICE_PATH }, 'Removing systemd service');

  // Stop the service
  try {
    execSync(`systemctl --user stop ${SERVICE_NAME}`, { stdio: 'pipe' });
    success('Service stopped.');
  } catch {
    log.debug('Service was not running.');
  }

  // Disable the service
  try {
    execSync(`systemctl --user disable ${SERVICE_NAME}`, { stdio: 'pipe' });
    success('Service disabled.');
  } catch {
    log.debug('Service was not enabled.');
  }

  // Remove the service file
  unlinkSync(SERVICE_PATH);
  success(`Service file removed: ${SERVICE_PATH}`);

  // Reload daemon
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    success('Daemon reloaded.');
  } catch {
    log.debug('Could not reload daemon.');
  }

  blank();
}
