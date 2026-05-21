/**
 * tele-kb-bot install — macOS launchd service management.
 *
 * Creates ~/Library/LaunchAgents/com.tele-kb-bot.plist
 * Offers to load the service via launchctl bootstrap.
 *
 * @module
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureConfigDirs, resolveConfigDir } from "../config/paths";
import { BINARY_NAME } from "../constants";
import { createCLILogger } from "../logger";
import type { CLIOptions } from "./main";

const PLIST_LABEL = "com.tele-kb-bot";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
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
  // When running as compiled binary, process.argv[0] is the binary path
  const currentExe = process.argv[0];
  if (currentExe && (currentExe.includes("tele-kb-bot") || currentExe.includes("bun"))) {
    // If it's a compiled binary, use its path directly
    if (!currentExe.includes("bun")) {
      return currentExe;
    }
  }

  // Fallback: common Homebrew install paths
  const candidates = [
    `/opt/homebrew/bin/${BINARY_NAME}`,
    `/usr/local/bin/${BINARY_NAME}`,
    join(homedir(), ".local", "bin", BINARY_NAME),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Last resort
  return `/opt/homebrew/bin/${BINARY_NAME}`;
}

/**
 * Install the launchd plist for tele-kb-bot.
 *
 * Steps:
 * 1. Generate plist XML
 * 2. Write to ~/Library/LaunchAgents/com.tele-kb-bot.plist
 * 3. Offer to load: launchctl bootstrap gui/$UID ...
 * 4. Print management commands
 */
export async function installCommand(_options: CLIOptions): Promise<void> {
  const log = createCLILogger(BINARY_NAME);
  const configDir = _options.configOverride ?? resolveConfigDir();
  const binaryPath = resolveBinaryPath();

  // Ensure config dir and logs subdir exist
  ensureConfigDirs(configDir);

  log.info({ binaryPath, plistPath: PLIST_PATH }, "Installing launchd service");

  // Generate and write plist
  const plistContent = generatePlist(configDir, binaryPath);
  writeFileSync(PLIST_PATH, plistContent, { mode: 0o644 });

  console.log(`\n  ✓ LaunchAgent plist written to:`);
  console.log(`    ${PLIST_PATH}`);
  console.log();
  console.log(`  Binary path: ${binaryPath}`);
  console.log(`  Config path: ${configDir}`);
  console.log();

  // Offer to load the service
  const loadService = await confirm("Load the service now? (launchctl bootstrap)", true);
  if (loadService) {
    try {
      const uid = process.getuid?.() ?? 0;
      const bootstrapCmd = `launchctl bootstrap gui/${uid} "${PLIST_PATH}"`;
      log.info({ cmd: bootstrapCmd }, "Loading launchd service");
      execSync(bootstrapCmd, { stdio: "inherit" });
      console.log("  ✓ Service loaded successfully.");
    } catch (_err) {
      // The service may already be loaded — try bootout first, then bootstrap
      try {
        const uid = process.getuid?.() ?? 0;
        execSync(`launchctl bootout gui/${uid}/${PLIST_LABEL} 2>/dev/null || true`, { stdio: "ignore" });
        execSync(`launchctl bootstrap gui/${uid} "${PLIST_PATH}"`, {
          stdio: "inherit",
        });
        console.log("  ✓ Service reloaded successfully.");
      } catch (err2) {
        console.error(`  ✗ Failed to load service: ${err2 instanceof Error ? err2.message : String(err2)}`);
        console.error("    You can load it manually:");
        console.error(`    launchctl bootstrap gui/$(id -u) "${PLIST_PATH}"`);
      }
    }
  }

  console.log();
  console.log("  Management commands:");
  console.log(`    Start:   launchctl bootstrap gui/$(id -u) "${PLIST_PATH}"`);
  console.log(`    Stop:    launchctl bootout gui/$(id -u)/${PLIST_LABEL}`);
  console.log(`    Status:  launchctl list | grep ${PLIST_LABEL}`);
  console.log(`    Logs:    tail -f ${configDir}/logs/out.log`);
  console.log(`    Errors:  tail -f ${configDir}/logs/err.log`);
  console.log();
}

/**
 * Simple confirm helper (duplicated from setup.ts to avoid circular deps).
 */
async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  return new Promise<boolean>((resolve) => {
    rl.question(`  ${question} ${hint} `, (answer: string) => {
      rl.close();
      if (answer.trim() === "") resolve(defaultYes);
      else resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}
