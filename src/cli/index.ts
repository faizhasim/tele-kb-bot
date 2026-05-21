/**
 * tele-kb-bot index — build and manage search index for vault directories.
 *
 * Subcommands:
 *   build — Build/rebuild the search index (default)
 *   clear — Clear the search index for configured directories
 *
 * For persistent mode (qmd): adds collections via `qmd collection add`, then
 * runs `qmd update` and `qmd embed`. Index data lives in ~/.qmd/ or ~/.local/share/qmd/.
 * For ephemeral mode (BM25): noop — index is built in-memory at runtime.
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadConfigSync } from '../config/loader';
import { getConfigSubdirs, resolveConfigDir } from '../config/paths';
import { BINARY_NAME } from '../constants';
import type { CLIOptions } from './main';

// ─── Helpers ────────────────────────────────────────────────────────

function detectQmd(binaryPath: string): boolean {
  try {
    execFileSync('command', ['-v', binaryPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function dirName(absPath: string): string {
  return absPath.replace(/\/+$/, '').split('/').pop() ?? 'vault';
}

function collectionName(dir: string): string {
  // qmd collection names must be filesystem-safe
  return dirName(dir)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

function collectDirs(configDir: string): { memoryDir: string | null; vaultDirs: Array<string> } {
  const memoryDir = getConfigSubdirs(configDir).MEMORY;
  const { config } = loadConfigSync(configDir);
  return {
    memoryDir: existsSync(memoryDir) ? memoryDir : null,
    vaultDirs: config.vault_directories.filter((d) => existsSync(d)),
  };
}

function printDirs(dirs: Array<string>): void {
  for (const d of dirs) {
    const col = collectionName(d);
    console.log(`    ${d}  → collection "${col}"`);
  }
}

/** Run a qmd subcommand, returning stdout or error message. */
function qmdRun(args: Array<string>, binaryPath: string, timeout = 60_000): string {
  try {
    const output = execFileSync(binaryPath, args, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout,
    });
    return output.trim() || '(completed silently)';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `FAILED: ${msg}`;
  }
}

// ─── Subcommand: build ──────────────────────────────────────────────

async function buildCommand(options: CLIOptions): Promise<void> {
  const configDir = options.configOverride ?? resolveConfigDir();
  const { config } = loadConfigSync(configDir);

  if (config.memory.mode === 'ephemeral') {
    console.log('\n  Memory mode: ephemeral (BM25 in-memory)');
    console.log('  No persistent index needed. Index is built at runtime from memory files.\n');
    return;
  }

  const qmdPath = config.memory.qmd.binary_path;
  if (!detectQmd(qmdPath)) {
    console.error(`\n  qmd binary not found at "${qmdPath}".`);
    console.error('  Install with: brew install faizhasim/tele-kb-bot/qmd');
    console.error('  Or set memory.qmd.binary_path in config.yaml.\n');
    process.exit(1);
  }

  const { memoryDir, vaultDirs } = collectDirs(configDir);
  const allDirs: Array<string> = [];
  if (memoryDir) allDirs.push(memoryDir);
  allDirs.push(...vaultDirs);

  if (allDirs.length === 0) {
    console.log('\n  No directories to index. Add vault_directories via setup or config.yaml.\n');
    return;
  }

  console.log('\n  Adding qmd collections:');
  printDirs(allDirs);
  console.log();

  for (const dir of allDirs) {
    const col = collectionName(dir);
    process.stdout.write(`  collection "${col}" ← ${dir} ... `);
    const result = qmdRun(['collection', 'add', dir, '--name', col], qmdPath);
    console.log(result);
  }

  console.log('\n  Updating indexes...');
  const updateResult = qmdRun(['update'], qmdPath, 120_000);
  console.log(`  ${updateResult}`);

  console.log('\n  Generating vector embeddings...');
  const embedResult = qmdRun(['embed'], qmdPath, 300_000);
  console.log(`  ${embedResult}`);

  console.log('\n  Index build complete.\n');
}

// ─── Subcommand: clear ──────────────────────────────────────────────

async function clearCommand(options: CLIOptions): Promise<void> {
  const configDir = options.configOverride ?? resolveConfigDir();
  const { config } = loadConfigSync(configDir);

  if (config.memory.mode === 'ephemeral') {
    console.log('\n  Memory mode: ephemeral (BM25 in-memory)');
    console.log('  Nothing to clear — index lives in memory.\n');
    return;
  }

  const qmdPath = config.memory.qmd.binary_path;
  if (!detectQmd(qmdPath)) {
    console.error(`\n  qmd binary not found at "${qmdPath}".`);
    console.error('  Install with: brew install faizhasim/tele-kb-bot/qmd');
    console.error('  Or set memory.qmd.binary_path in config.yaml.\n');
    process.exit(1);
  }

  const { memoryDir, vaultDirs } = collectDirs(configDir);
  const allDirs: Array<string> = [];
  if (memoryDir) allDirs.push(memoryDir);
  allDirs.push(...vaultDirs);

  if (allDirs.length === 0) {
    console.log('\n  No directories configured. Nothing to clear.\n');
    return;
  }

  console.log('\n  Clearing collections:');
  printDirs(allDirs);
  console.log();

  // Remove the collection data for each directory
  for (const dir of allDirs) {
    const col = collectionName(dir);
    process.stdout.write(`  collection "${col}" ... `);

    const removeResult = qmdRun(['collection', 'remove', col], qmdPath, 15_000);
    if (removeResult === '(completed silently)' || !removeResult.startsWith('FAILED')) {
      console.log(`removed collection "${col}"`);
    } else {
      console.log(`qmd collection remove failed.`);
      console.log(`  To manually remove the collection, run: ${qmdPath} collection remove ${col}`);
    }
  }

  console.log('\n  Index clear complete.\n');
}

// ─── Command Router ─────────────────────────────────────────────────

function printUsage(): void {
  console.log(`Usage: ${BINARY_NAME} index <subcommand> [options]`);
  console.log();
  console.log('Subcommands:');
  console.log('  build    Build/rebuild the search index (default)');
  console.log('  clear    Clear the search index');
  console.log();
  console.log('Options:');
  console.log('  --config <path>  Override config directory');
  console.log();
  console.log('Examples:');
  console.log(`  ${BINARY_NAME} index build`);
  console.log(`  ${BINARY_NAME} index clear`);
}

export async function indexCommand(options: CLIOptions): Promise<void> {
  const subcommand = options.rawArgs[1]?.toLowerCase();

  if (!subcommand) {
    printUsage();
    return;
  }

  switch (subcommand) {
    case 'build':
      await buildCommand(options);
      break;
    case 'clear':
      await clearCommand(options);
      break;
    default:
      console.error(`Unknown subcommand: "${subcommand}"`);
      printUsage();
      process.exit(1);
  }
}
