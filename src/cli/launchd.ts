/**
 * tele-kb-bot launchd — macOS launchd service management.
 *
 * launchd add      Create ~/Library/LaunchAgents/com.tele-kb-bot.plist
 *                  and load via launchctl bootstrap (idempotent).
 * launchd remove   Unload and remove the plist.
 *
 * @module
 */

import { execSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureConfigDirsSync, resolveConfigDir } from '../config/paths';
import { BINARY_NAME } from '../constants';
import { createCLILogger } from '../logger';
import type { CLIOptions } from './main';
import { blank, error, info, success } from './output';

const PLIST_LABEL = 'com.tele-kb-bot';
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, `${PLIST_LABEL}.plist`);

/**
 * Generate the launchd plist XML content.
 */
function generatePlist(configDir: string, binaryPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${binaryPath}</string>
        <string>start</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>TELE_KB_BOT_CONFIG</key>
        <string>${configDir}</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>StandardOutPath</key>
    <string>${configDir}/logs/out.log</string>
    <key>StandardErrorPath</key>
    <string>${configDir}/logs/err.log</string>
</dict>
</plist>
`;
}

/**
 * Resolve the binary path.
 * Tries the current executable path first, then common brew install locations.
 */
function resolveBinaryPath(): string {
  const currentExe = process.argv[0];
  if (currentExe && (currentExe.includes('tele-kb-bot') || currentExe.includes('bun'))) {
    if (!currentExe.includes('bun')) {
      return currentExe;
    }
  }

  const candidates = [
    `/opt/homebrew/bin/${BINARY_NAME}`,
    `/usr/local/bin/${BINARY_NAME}`,
    join(homedir(), '.local', 'bin', BINARY_NAME),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return `/opt/homebrew/bin/${BINARY_NAME}`;
}

/**
 * Create and load the launchd plist (idempotent).
 */
export async function launchdAddCommand(_options: CLIOptions): Promise<void> {
  const log = createCLILogger(BINARY_NAME);
  const configDir = _options.configOverride ?? resolveConfigDir();
  const binaryPath = resolveBinaryPath();

  ensureConfigDirsSync(configDir);
  log.info({ binaryPath, plistPath: PLIST_PATH }, 'Installing launchd service');

  const plistContent = generatePlist(configDir, binaryPath);
  writeFileSync(PLIST_PATH, plistContent, { mode: 0o644 });

  blank();
  success('LaunchAgent plist written to:');
  info(`  ${PLIST_PATH}`);
  blank();
  info(`Binary path: ${binaryPath}`);
  info(`Config path: ${configDir}`);
  blank();

  const loadService = await confirm('Load the service now?', true);
  if (loadService) {
    try {
      const uid = process.getuid?.() ?? 0;
      const bootstrapCmd = `launchctl bootstrap gui/${uid} "${PLIST_PATH}"`;
      log.info({ cmd: bootstrapCmd }, 'Loading launchd service');
      execSync(bootstrapCmd, { stdio: 'inherit' });
      success('Service loaded successfully.');
    } catch {
      try {
        const uid = process.getuid?.() ?? 0;
        execSync(`launchctl bootout gui/${uid}/${PLIST_LABEL} 2>/dev/null || true`, { stdio: 'ignore' });
        execSync(`launchctl bootstrap gui/${uid} "${PLIST_PATH}"`, { stdio: 'inherit' });
        success('Service reloaded successfully.');
      } catch (err2) {
        error(`Failed to load service: ${err2 instanceof Error ? err2.message : String(err2)}`);
        info('You can load it manually:');
        info(`  launchctl bootstrap gui/$(id -u) "${PLIST_PATH}"`);
      }
    }
  }

  blank();
  info('Management commands:');
  info(`  Start:   launchctl bootstrap gui/$(id -u) "${PLIST_PATH}"`);
  info(`  Stop:    launchctl bootout gui/$(id -u)/${PLIST_LABEL}`);
  info(`  Status:  launchctl list | grep ${PLIST_LABEL}`);
  info(`  Logs:    tail -f ${configDir}/logs/out.log`);
  info(`  Errors:  tail -f ${configDir}/logs/err.log`);
  blank();
}

/**
 * Unload and remove the launchd plist.
 */
export async function launchdRemoveCommand(): Promise<void> {
  const log = createCLILogger(BINARY_NAME);

  if (!existsSync(PLIST_PATH)) {
    info('No launchd plist found — nothing to remove.');
    blank();
    return;
  }

  log.info({ plistPath: PLIST_PATH }, 'Removing launchd service');

  try {
    const uid = process.getuid?.() ?? 0;
    execSync(`launchctl bootout gui/${uid}/${PLIST_LABEL}`, { stdio: 'ignore' });
    success('Service unloaded.');
  } catch {
    log.debug('Service was not loaded.');
    info('Service was not running, skipping unload.');
  }

  unlinkSync(PLIST_PATH);
  success(`Plist removed: ${PLIST_PATH}`);
  blank();
}

/**
 * Simple confirm helper (duplicated from setup.ts to avoid circular deps).
 */
async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  return new Promise<boolean>((resolve) => {
    rl.question(`  ${question} ${hint} `, (answer: string) => {
      rl.close();
      if (answer.trim() === '') resolve(defaultYes);
      else resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}
