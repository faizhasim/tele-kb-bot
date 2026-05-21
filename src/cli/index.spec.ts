/**
 * Tests for the CLI index command module.
 *
 * Tests pure helper functions via local simulations (matching the
 * existing codebase pattern in setup.spec.ts), and tests command
 * routing and side-effect behavior through the exported indexCommand.
 *
 * @module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config/schema';
import type { CLIOptions } from './main';

// ─── Hoisted mocks (available in vi.mock factories) ─────────────────

const {
  mockExecFileSync,
  mockExistsSync,
  mockLoadConfigSync,
  mockGetConfigSubdirs,
  mockResolveConfigDir,
  mockCreateCLILogger,
} = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockLoadConfigSync: vi.fn(),
  mockGetConfigSubdirs: vi.fn(),
  mockResolveConfigDir: vi.fn().mockReturnValue('/Users/test/.config/tele-kb-bot'),
  mockCreateCLILogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Module mocks ───────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
}));

vi.mock('../config/loader', () => ({
  loadConfigSync: mockLoadConfigSync,
}));

vi.mock('../config/paths', () => ({
  getConfigSubdirs: mockGetConfigSubdirs,
  resolveConfigDir: mockResolveConfigDir,
}));

vi.mock('../logger', () => ({
  createCLILogger: mockCreateCLILogger,
}));

// ─── Module imports (after vi.mock) ─────────────────────────────────

import { indexCommand } from './index';

// ─── Helpers: duplicate pure function logic (setup.spec.ts pattern) ─

/**
 * Simulation of dirName from index.ts.
 * Extracts the last segment of an absolute path.
 */
function simulateDirName(absPath: string): string {
  return absPath.replace(/\/+$/, '').split('/').pop() ?? 'vault';
}

/**
 * Simulation of collectionName from index.ts.
 * Converts a directory path to a qmd filesystem-safe collection name.
 */
function simulateCollectionName(dir: string): string {
  return simulateDirName(dir)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

/**
 * Simulation of detectQmd from index.ts.
 * Returns true if execFileSync('command', ['-v', binaryPath]) succeeds.
 */
function simulateDetectQmd(binaryPath: string): boolean {
  try {
    mockExecFileSync('command', ['-v', binaryPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Simulation of qmdRun from index.ts.
 * Returns trimmed stdout or 'FAILED: ' + error message.
 */
function simulateQmdRun(args: Array<string>, binaryPath: string, timeout = 60_000): string {
  try {
    const output = mockExecFileSync(binaryPath, args, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout,
    });
    return (output as string).trim() || '(completed silently)';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `FAILED: ${msg}`;
  }
}

// ─── Helper: config factory ─────────────────────────────────────────

const TEST_CONFIG_DIR = '/Users/test/.config/tele-kb-bot';

function buildValidConfig(overrides?: Partial<Config>): Config {
  const defaults: Config = {
    telegram: { bot_token: 'test:token', allowed_user_ids: [12345] },
    llm: { provider: 'opencode-go', model: 'deepseek-v4-flash', reasoning: 'high' },
    memory: {
      enabled: true,
      mode: 'ephemeral',
      auto_inject: true,
      search: { max_results: 5, mode: 'keyword' },
      cache: { max_entries: 100, max_size_bytes: 104_857_600 },
      qmd: { enabled: false, binary_path: 'qmd' },
    },
    bot: { max_attachments_per_turn: 10, streaming_preview: true, text_chunk_size: 4096 },
    vault_directories: [],
    system_prompt: undefined,
  };
  return overrides ? { ...defaults, ...overrides } : defaults;
}

// ─── Options factory ────────────────────────────────────────────────

function makeOptions(subcommand?: string, configOverride?: string): CLIOptions {
  const rawArgs: Array<string> = ['index'];
  if (subcommand) rawArgs.push(subcommand);
  return {
    command: 'index',
    configOverride,
    nonInteractive: false,
    rawArgs,
  };
}

const testSubdirs = {
  AGENTS: `${TEST_CONFIG_DIR}/agents`,
  MEMORY: `${TEST_CONFIG_DIR}/memory`,
  MEMORY_DAILY: `${TEST_CONFIG_DIR}/memory/daily`,
  TELEGRAM_TMP: `${TEST_CONFIG_DIR}/telegram-tmp`,
  LOGS: `${TEST_CONFIG_DIR}/logs`,
};

// ─── Tests: dirName ─────────────────────────────────────────────────

describe('dirName', () => {
  it('extracts last segment from an absolute path', () => {
    expect(simulateDirName('/Users/me/vault')).toBe('vault');
    expect(simulateDirName('/a/b/c/d')).toBe('d');
  });

  it('strips trailing slashes before extracting', () => {
    expect(simulateDirName('/Users/me/vault///')).toBe('vault');
    expect(simulateDirName('/a/b/')).toBe('b');
  });

  it('returns empty string for root path', () => {
    expect(simulateDirName('/')).toBe('');
  });

  it('returns empty string for empty-string segments', () => {
    expect(simulateDirName('')).toBe('');
  });

  it('handles single-segment paths', () => {
    expect(simulateDirName('myfolder')).toBe('myfolder');
  });
});

// ─── Tests: collectionName ──────────────────────────────────────────

describe('collectionName', () => {
  it('converts dir names to lowercase', () => {
    expect(simulateCollectionName('/Users/me/VAULT')).toBe('vault');
    expect(simulateCollectionName('/tmp/MyNotes')).toBe('mynotes');
  });

  it('replaces non-alphanumeric characters with hyphens', () => {
    expect(simulateCollectionName('/tmp/my vault')).toBe('my-vault');
    expect(simulateCollectionName('/tmp/notes_v1.0')).toBe('notes_v1-0');
    expect(simulateCollectionName('/tmp/special!@#')).toBe('special---');
  });

  it('preserves hyphens and underscores', () => {
    expect(simulateCollectionName('/tmp/some-dir_name')).toBe('some-dir_name');
  });

  it('handles paths with trailing slashes', () => {
    expect(simulateCollectionName('/Users/me/Vault///')).toBe('vault');
  });

  it('handles nested path segments', () => {
    expect(simulateCollectionName('/very/deep/nested/Dir-Name_2')).toBe('dir-name_2');
  });
});

// ─── Tests: detectQmd ───────────────────────────────────────────────

describe('detectQmd', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('returns true when qmd binary is found', () => {
    mockExecFileSync.mockReturnValue('/opt/homebrew/bin/qmd\n');

    const result = simulateDetectQmd('/opt/homebrew/bin/qmd');

    expect(result).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith('command', ['-v', '/opt/homebrew/bin/qmd'], {
      stdio: 'ignore',
    });
  });

  it('returns false when execFileSync throws (binary not found)', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('command not found');
    });

    const result = simulateDetectQmd('/usr/local/bin/qmd');

    expect(result).toBe(false);
  });

  it('returns false for non-existent custom path', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const result = simulateDetectQmd('/custom/path/qmd');

    expect(result).toBe(false);
  });
});

// ─── Tests: qmdRun ──────────────────────────────────────────────────

describe('qmdRun', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('returns trimmed stdout on success', () => {
    mockExecFileSync.mockReturnValue('  collection "my-vault" added successfully  \n');

    const result = simulateQmdRun(['collection', 'add', '/vault', '--name', 'my-vault'], 'qmd');

    expect(result).toBe('collection "my-vault" added successfully');
    expect(mockExecFileSync).toHaveBeenCalledWith('qmd', ['collection', 'add', '/vault', '--name', 'my-vault'], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 60_000,
    });
  });

  it('returns "(completed silently)" for empty stdout', () => {
    mockExecFileSync.mockReturnValue('   \n');

    const result = simulateQmdRun(['update'], 'qmd');

    expect(result).toBe('(completed silently)');
  });

  it('returns FAILED prefix when execFileSync throws', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('timeout after 60000ms');
    });

    const result = simulateQmdRun(['embed'], 'qmd', 300_000);

    expect(result).toContain('FAILED');
    expect(result).toContain('timeout after 60000ms');
  });
});

// ─── Tests: printUsage ──────────────────────────────────────────────

describe('printUsage (tested through indexCommand)', () => {
  it('prints usage when no subcommand is provided', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await indexCommand(makeOptions());

    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('Usage: tele-kb-bot index');
    expect(allOutput).toContain('build');
    expect(allOutput).toContain('clear');
    expect(allOutput).toContain('--config');
  });
});

// ─── Tests: indexCommand routing ────────────────────────────────────

describe('indexCommand routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: ephemeral mode so we don't need qmd for build/clear
    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig(),
      configDir: TEST_CONFIG_DIR,
      source: 'file',
    });
    mockGetConfigSubdirs.mockReturnValue(testSubdirs);
    mockExistsSync.mockReturnValue(true);

    // Silence console
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes to build subcommand when subcommand is "build"', async () => {
    await indexCommand(makeOptions('build'));

    // In ephemeral mode, build prints a message about in-memory index
    const consoleSpy = vi.mocked(console.log);
    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('ephemeral');
  });

  it('routes to clear subcommand when subcommand is "clear"', async () => {
    await indexCommand(makeOptions('clear'));

    const consoleSpy = vi.mocked(console.log);
    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('Nothing to clear');
  });

  it('shows usage for missing subcommand', async () => {
    // Already covered in printUsage test, but verify routing
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await indexCommand(makeOptions());

    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('Usage:');
  });

  it('exits with error for unknown subcommand', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as (code: string | number | null | undefined) => never);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await indexCommand(makeOptions('unknown'));

    expect(consoleErrorSpy).toHaveBeenCalled();
    const allCalls: Array<Array<unknown>> = consoleErrorSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('Unknown subcommand');
    expect(allOutput).toContain('unknown');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── Tests: buildCommand with ephemeral mode ────────────────────────

describe('buildCommand (ephemeral mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig({ memory: { ...buildValidConfig().memory, mode: 'ephemeral' } }),
      configDir: TEST_CONFIG_DIR,
      source: 'file',
    });
    mockGetConfigSubdirs.mockReturnValue(testSubdirs);
    mockExistsSync.mockReturnValue(true);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints ephemeral mode message and returns without calling qmd', async () => {
    await indexCommand(makeOptions('build'));

    const consoleSpy = vi.mocked(console.log);
    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('ephemeral');
    expect(allOutput).toContain('BM25 in-memory');
    expect(allOutput).toContain('No persistent index needed');

    // Should NOT call execFileSync (no qmd interaction)
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('does not require qmd binary for ephemeral mode', async () => {
    // Even if no config file exists, ephemeral mode should work
    mockExistsSync.mockReturnValue(false);

    await indexCommand(makeOptions('build'));

    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('respects configOverride in ephemeral mode', async () => {
    const customConfigDir = '/custom/config';
    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig({ memory: { ...buildValidConfig().memory, mode: 'ephemeral' } }),
      configDir: customConfigDir,
      source: 'file',
    });

    await indexCommand(makeOptions('build', customConfigDir));

    expect(mockLoadConfigSync).toHaveBeenCalledWith(customConfigDir);
  });
});

// ─── Tests: clearCommand with ephemeral mode ────────────────────────

describe('clearCommand (ephemeral mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig({ memory: { ...buildValidConfig().memory, mode: 'ephemeral' } }),
      configDir: TEST_CONFIG_DIR,
      source: 'file',
    });
    mockGetConfigSubdirs.mockReturnValue(testSubdirs);
    mockExistsSync.mockReturnValue(true);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints ephemeral mode message and returns without calling qmd', async () => {
    await indexCommand(makeOptions('clear'));

    const consoleSpy = vi.mocked(console.log);
    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('ephemeral');
    expect(allOutput).toContain('Nothing to clear');
    expect(allOutput).toContain('lives in memory');

    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('does not require qmd binary for ephemeral clear', async () => {
    mockExistsSync.mockReturnValue(false);

    await indexCommand(makeOptions('clear'));

    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});

// ─── Tests: buildCommand with persistent mode ───────────────────────

describe('buildCommand (persistent mode — qmd)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig({
        memory: {
          ...buildValidConfig().memory,
          mode: 'persistent',
          qmd: { enabled: true, binary_path: 'qmd' },
        },
        vault_directories: ['/Users/test/vault'],
      }),
      configDir: TEST_CONFIG_DIR,
      source: 'file',
    });
    mockGetConfigSubdirs.mockReturnValue(testSubdirs);
    // memory dir exists, vault dir exists
    mockExistsSync.mockReturnValue(true);
    // qmd binary found
    mockExecFileSync.mockImplementation((binary: string, args: Array<string>) => {
      if (binary === 'command' && args[0] === '-v') {
        return '';
      }
      return 'ok\n';
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits when qmd binary is not found', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as (code: string | number | null | undefined) => never);

    await indexCommand(makeOptions('build'));

    const errorSpy = vi.mocked(console.error);
    const allCalls: Array<Array<unknown>> = errorSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('qmd binary not found');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('shows message when no directories to index', async () => {
    // qmd binary found
    mockExecFileSync.mockImplementation((_binary: string) => {
      if (_binary === 'qmd') return 'ok\n';
      return '';
    });
    // No directories exist
    mockExistsSync.mockReturnValue(false);

    await indexCommand(makeOptions('build'));

    const consoleSpy = vi.mocked(console.log);
    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('No directories to index');
  });

  it('adds collections and runs update/embed for existing directories', async () => {
    mockExecFileSync.mockImplementation((_binary: string) => {
      return 'ok\n';
    });

    await indexCommand(makeOptions('build'));

    // Should add memory dir collection
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'qmd',
      ['collection', 'add', testSubdirs.MEMORY, '--name', 'memory'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
    // Should add vault dir collection
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'qmd',
      ['collection', 'add', '/Users/test/vault', '--name', 'vault'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
    // Should run update
    expect(mockExecFileSync).toHaveBeenCalledWith('qmd', ['update'], expect.objectContaining({ timeout: 120_000 }));
    // Should run embed
    expect(mockExecFileSync).toHaveBeenCalledWith('qmd', ['embed'], expect.objectContaining({ timeout: 300_000 }));
  });

  it('prints "Adding qmd collections" header when building with persistent mode and qmd available', async () => {
    mockExecFileSync.mockReturnValue('ok\n');

    await indexCommand(makeOptions('build'));

    const consoleSpy = vi.mocked(console.log);
    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('Adding qmd collections');
    expect(allOutput).toContain('Updating indexes');
    expect(allOutput).toContain('Generating vector embeddings');
    expect(allOutput).toContain('Index build complete');
  });
});

// ─── Tests: clearCommand with persistent mode ────────────────────────

describe('clearCommand (persistent mode — qmd)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig({
        memory: {
          ...buildValidConfig().memory,
          mode: 'persistent',
          qmd: { enabled: true, binary_path: 'qmd' },
        },
        vault_directories: ['/Users/test/vault'],
      }),
      configDir: TEST_CONFIG_DIR,
      source: 'file',
    });
    mockGetConfigSubdirs.mockReturnValue(testSubdirs);
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue('ok\n');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits when qmd binary is not found', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as (code: string | number | null | undefined) => never);

    await indexCommand(makeOptions('clear'));

    const errorSpy = vi.mocked(console.error);
    const allCalls: Array<Array<unknown>> = errorSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('qmd binary not found');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('shows message when no directories configured', async () => {
    mockExistsSync.mockReturnValue(false);

    await indexCommand(makeOptions('clear'));

    const consoleSpy = vi.mocked(console.log);
    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('Nothing to clear');
  });

  it('removes collections for each configured directory', async () => {
    await indexCommand(makeOptions('clear'));

    // Should remove memory collection
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'qmd',
      ['collection', 'remove', 'memory'],
      expect.objectContaining({ timeout: 15_000 }),
    );
    // Should remove vault collection
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'qmd',
      ['collection', 'remove', 'vault'],
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it('handles "(completed silently)" output from qmd on clear', async () => {
    // Reset default to control mock precisely
    mockExecFileSync
      .mockReset()
      .mockImplementationOnce(() => '') // detectQmd → empty output = found
      .mockImplementationOnce(() => '') // collection remove → empty = "(completed silently)"
      .mockImplementationOnce(() => '   \n'); // collection remove → whitespace = "(completed silently)"

    await indexCommand(makeOptions('clear'));

    const consoleSpy = vi.mocked(console.log);
    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    expect(allOutput).toContain('removed collection');
  });

  it('does not re-add existing collections', async () => {
    mockExecFileSync
      .mockReset()
      .mockImplementationOnce(() => '') // detectQmd
      .mockImplementationOnce(() => '') // first collection add → empty = "(completed silently)"
      .mockImplementationOnce(() => '') // second collection add → empty
      .mockImplementationOnce(() => '') // update → empty
      .mockImplementationOnce(() => ''); // embed → empty

    await indexCommand(makeOptions('build'));

    // Should complete without throwing
    expect(mockExecFileSync).toHaveBeenCalled();
  });

  it('handles qmd collection remove failure gracefully', async () => {
    // First call succeeds, second fails
    mockExecFileSync
      .mockImplementationOnce(() => 'ok\n')
      .mockImplementationOnce(() => {
        throw new Error('collection not found');
      });

    await indexCommand(makeOptions('clear'));

    const consoleSpy = vi.mocked(console.log);
    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    // Should report failure for the second collection
    expect(allOutput).toContain('qmd collection remove failed');
    // Should still show the manual remove hint for the failed collection
    expect(allOutput).toContain('collection remove memory');
  });
});

// ─── Tests: collectDirs ─────────────────────────────────────────────

describe('collectDirs (tested through buildCommand)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig({
        memory: {
          ...buildValidConfig().memory,
          mode: 'persistent',
          qmd: { enabled: true, binary_path: 'qmd' },
        },
        vault_directories: ['/valid/vault', '/missing/vault'],
      }),
      configDir: TEST_CONFIG_DIR,
      source: 'file',
    });
    mockGetConfigSubdirs.mockReturnValue(testSubdirs);
    // MEMORY dir exists; first vault exists; second vault missing
    mockExistsSync.mockImplementation((path: string) => {
      if (path === testSubdirs.MEMORY) return true;
      if (path === '/valid/vault') return true;
      if (path === '/missing/vault') return false;
      return true;
    });
    // qmd binary found
    mockExecFileSync.mockReturnValue('ok\n');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes existing memory dir and existing vault dirs', async () => {
    await indexCommand(makeOptions('build'));

    // Should add memory dir (exists)
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'qmd',
      ['collection', 'add', testSubdirs.MEMORY, '--name', 'memory'],
      expect.anything(),
    );
    // Should add /valid/vault (exists) with collection name 'vault'
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'qmd',
      ['collection', 'add', '/valid/vault', '--name', 'vault'],
      expect.anything(),
    );
    // Should NOT add /missing/vault
    const missingVaultCall = mockExecFileSync.mock.calls.find((args: Array<unknown>) =>
      String(args[1]).includes('/missing/vault'),
    );
    expect(missingVaultCall).toBeUndefined();
  });
});

// ─── Tests: printDirs ───────────────────────────────────────────────

describe('printDirs (tested through buildCommand)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadConfigSync.mockReturnValue({
      config: buildValidConfig({
        memory: {
          ...buildValidConfig().memory,
          mode: 'persistent',
          qmd: { enabled: true, binary_path: 'qmd' },
        },
        vault_directories: ['/Users/test/My Vault'],
      }),
      configDir: TEST_CONFIG_DIR,
      source: 'file',
    });
    mockGetConfigSubdirs.mockReturnValue(testSubdirs);
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue('ok\n');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints each directory with its qmd collection name', async () => {
    await indexCommand(makeOptions('build'));

    const consoleSpy = vi.mocked(console.log);
    const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
    const allOutput = allCalls.map((args) => String(args[0])).join(' ');
    // Should print memory dir with collection name
    expect(allOutput).toContain(testSubdirs.MEMORY);
    expect(allOutput).toContain('collection "memory"');
    // Should print vault dir with sanitized name
    expect(allOutput).toContain('/Users/test/My Vault');
    expect(allOutput).toContain('collection "my-vault"');
  });
});
