/**
 * tele-kb-bot launchd — macOS launchd service management.
 *
 * launchd add      Create ~/Library/LaunchAgents/com.tele-kb-bot.plist
 *                  and load via launchctl bootstrap (idempotent).
 * launchd remove   Unload and remove the plist.
 *
 * @module
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { cancel, isCancel, text } from '@clack/prompts';
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
function generatePlist(configDir: string, binaryPath: string, extraPathPrefix?: string): string {
  const basePath = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  if (extraPathPrefix) {
    basePath.unshift(extraPathPrefix);
  }
  const pathValue = basePath.join(':');
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
        <string>${pathValue}</string>
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
// ─── Node.js path resolution ───────────────────────────────────

/**
 * Resolve the active `node` binary and identify how it's managed.
 * Returns the path and a human-readable source label, or null if not found.
 */
export function resolveNodePath(): { path: string; source: string } | null {
  try {
    const where = execFileSync('command', ['-v', 'node'], { encoding: 'utf-8', stdio: 'pipe' });
    const resolved = where.trim();
    if (!resolved.length) return null;
    return { path: resolved, source: detectNodeSource(resolved) };
  } catch {
    return null;
  }
}

/** Identify the version manager or installation method from the node path. */
function detectNodeSource(nodePath: string): string {
  if (nodePath.includes('/.local/share/mise/installs/node/')) return 'managed via mise';
  if (nodePath === '/opt/homebrew/bin/node') return 'installed via Homebrew';
  if (nodePath.includes('/.nvm/versions/node/')) return 'managed via nvm';
  if (nodePath.includes('/.asdf/installs/node/')) return 'managed via asdf';
  if (nodePath === '/usr/local/bin/node') return 'installed via Homebrew or manual';
  return `at ${nodePath}`;
}

/**
 * Resolve where the `qmd` binary is installed.
 * Returns the full path, or null if not found.
 */
export function resolveQmdPath(): string | null {
  try {
    const where = execFileSync('command', ['-v', 'qmd'], { encoding: 'utf-8', stdio: 'pipe' });
    const resolved = where.trim();
    if (resolved.length > 0) return resolved;
  } catch {
    // not found
  }
  return null;
}

// ─── Interactive prompt ───────────────────────────────────────

/** Prompt the user to confirm or override a detected binary path. */
async function promptPath(message: string, defaultPath: string): Promise<string> {
  const value = await text({
    message,
    placeholder: defaultPath,
    defaultValue: defaultPath,
  });
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }
  return String(value);
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

  // Collect extra PATH directories to prepend (node bin dir first, then qmd bin dir)
  const extraPathDirs: string[] = [];

  // 1. Resolve and confirm Node.js binary path
  const nodeInfo = resolveNodePath();
  if (nodeInfo) {
    if (_options.nonInteractive) {
      log.info(
        { nodePath: nodeInfo.path, nodeSource: nodeInfo.source },
        'Auto-using detected Node.js for launchd PATH',
      );
      extraPathDirs.push(dirname(nodeInfo.path));
    } else {
      blank();
      info(`Detected Node.js: ${nodeInfo.path} (${nodeInfo.source})`);

      const confirmed = await promptPath(`Node.js binary path (${nodeInfo.source})`, nodeInfo.path);
      if (!existsSync(confirmed)) {
        error(`Node.js binary not found at: ${confirmed}`);
        info('Skipping custom Node.js PATH entry.');
      } else {
        extraPathDirs.push(dirname(confirmed));
      }
    }
  }

  // 2. Resolve and confirm QMD binary path
  const qmdPath = resolveQmdPath();
  if (qmdPath) {
    if (_options.nonInteractive) {
      log.info({ qmdPath }, 'Auto-using detected QMD for launchd PATH');
      extraPathDirs.push(dirname(qmdPath));
    } else {
      info(`Detected QMD:    ${qmdPath}`);

      const confirmed = await promptPath('QMD binary path', qmdPath);
      if (!existsSync(confirmed)) {
        error(`QMD binary not found at: ${confirmed}`);
        info('Skipping custom QMD PATH entry.');
      } else {
        extraPathDirs.push(dirname(confirmed));
      }
    }
  }

  // Build the extra PATH prefix string
  const extraPathPrefix = extraPathDirs.length > 0 ? extraPathDirs.join(':') : undefined;

  ensureConfigDirsSync(configDir);
  log.info({ binaryPath, plistPath: PLIST_PATH }, 'Installing launchd service');

  const plistContent = generatePlist(configDir, binaryPath, extraPathPrefix);
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
