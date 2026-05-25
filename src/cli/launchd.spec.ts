/**
 * Tests for the CLI launchd service management commands.
 *
 * Tests launchdAddCommand and launchdRemoveCommand behavior through their
 * public interfaces, controlling mocks to verify internal function behavior
 * indirectly.
 *
 * @module
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CLIOptions } from './main';

// ─── Hoisted mocks (available in vi.mock factories) ─────────────────

const {
  mockExecSync,
  mockExecFileSync,
  mockExistsSync,
  mockWriteFileSync,
  mockUnlinkSync,
  mockMkdirSync,
  mockResolveConfigDir,
  mockEnsureConfigDirsSync,
  mockCreateCLILogger,
  mockQuestion,
  mockText,
  mockIsCancel,
  mockCancel,
} = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockResolveConfigDir: vi.fn().mockReturnValue('/Users/test/.config/tele-kb-bot'),
  mockEnsureConfigDirsSync: vi.fn(),
  mockCreateCLILogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  mockQuestion: vi.fn((_q: string, cb: (a: string) => void) => cb('y')),
  mockText: vi.fn(),
  mockIsCancel: vi.fn(),
  mockCancel: vi.fn(),
}));

// ─── Module mocks ───────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  execSync: mockExecSync,
}));

vi.mock('@clack/prompts', () => ({
  text: mockText,
  isCancel: mockIsCancel,
  cancel: mockCancel,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock('../config/paths', () => ({
  ensureConfigDirsSync: mockEnsureConfigDirsSync,
  resolveConfigDir: mockResolveConfigDir,
}));

vi.mock('../logger', () => ({
  createCLILogger: mockCreateCLILogger,
}));

vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: mockQuestion,
    close: vi.fn(),
  }),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/Users/test'),
}));

// ─── Module imports (after vi.mock) ─────────────────────────────────

import { launchdAddCommand, launchdRemoveCommand } from './launchd';

// ─── Constants ──────────────────────────────────────────────────────

const PLIST_FILENAME = 'com.tele-kb-bot.plist';
const DEFAULT_CONFIG_DIR = '/Users/test/.config/tele-kb-bot';
const LAUNCH_AGENTS_PATH = join(homedir(), 'Library', 'LaunchAgents', PLIST_FILENAME);

const defaultOptions: CLIOptions = {
  command: 'launchd',
  configOverride: undefined,
  nonInteractive: false,
  rawArgs: ['launchd'],
};

// ─── Helpers ────────────────────────────────────────────────────────

/** Extract the plist XML content captured by writeFileSync mock. */
function getCapturedPlist(): string {
  const call0 = mockWriteFileSync.mock.calls[0];
  if (!call0) return '';
  return String(call0[1]);
}

/** Parse binary path from program arguments in plist XML. */
function getBinaryFromPlist(plist: string): string {
  const lines = plist.split('\n');
  const programArgsIdx = lines.findIndex((l) => l.trim() === '<key>ProgramArguments</key>');
  if (programArgsIdx === -1) return '';
  for (let i = programArgsIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.trim().match(/<string>(.*?)<\/string>/);
    if (match?.[1]) return match[1];
  }
  return '';
}

/** Parse config dir from plist XML. Looks for TELE_KB_BOT_CONFIG key. */
function getConfigDirFromPlist(plist: string): string {
  const lines = plist.split('\n');
  const configKeyIdx = lines.findIndex((l) => l.trim() === '<key>TELE_KB_BOT_CONFIG</key>');
  if (configKeyIdx === -1) return '';
  const nextLine = lines[configKeyIdx + 1]?.trim();
  if (!nextLine) return '';
  const match = nextLine.match(/<string>(.*?)<\/string>/);
  return match?.[1] ?? '';
}

// ─── Tests: launchdAddCommand ───────────────────────────────────────

describe('launchdAddCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockExistsSync.mockReturnValue(true);
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb('y'));
    mockWriteFileSync.mockImplementation(() => {});

    // execFileSync defaults: resolve node and qmd paths
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'command' && args[0] === '-v' && args[1] === 'node') {
        return '/Users/test/.local/share/mise/shims/node\n';
      }
      if (cmd === 'command' && args[0] === '-v' && args[1] === 'qmd') {
        return '/opt/homebrew/bin/qmd\n';
      }
      return '';
    });

    // @clack/prompts defaults: user accepts each prompt's placeholder value
    mockText.mockImplementation((opts: { placeholder?: string }) => opts?.placeholder ?? '');
    mockIsCancel.mockReturnValue(false);
    mockCancel.mockImplementation(() => {});

    // Default: binary running as bun (triggers Homebrew fallback)
    process.argv[0] = '/opt/homebrew/bin/bun';

    // Silence console output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────
  // generatePlist output correctness
  // ──────────────────────────────────────────────────────────────────

  describe('generatePlist (tested through launchdAddCommand)', () => {
    it('produces XML plist with correct config dir and binary path', async () => {
      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(plist).toContain('<!DOCTYPE plist');
      expect(plist).toContain('<plist version="1.0">');
      expect(plist).toContain('<string>com.tele-kb-bot</string>');
    });

    it('includes TELE_KB_BOT_CONFIG environment variable with config dir', async () => {
      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(plist).toContain('TELE_KB_BOT_CONFIG');
      expect(getConfigDirFromPlist(plist)).toBe(DEFAULT_CONFIG_DIR);
    });

    it('includes PATH environment variable with detected node and qmd bin dirs', async () => {
      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      // Both node and qmd bin dirs are prepended
      expect(plist).toContain('/Users/test/.local/share/mise/shims:/opt/homebrew/bin:/opt/homebrew/bin');
    });

    it('includes KeepAlive, RunAtLoad, and ThrottleInterval keys', async () => {
      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(plist).toContain('<key>KeepAlive</key>');
      expect(plist).toContain('<key>RunAtLoad</key>');
      expect(plist).toContain('<key>ThrottleInterval</key>');
      expect(plist).toContain('<integer>5</integer>');
    });

    it('includes StandardOutPath and StandardErrorPath pointing to configDir/logs/', async () => {
      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(plist).toContain(`${DEFAULT_CONFIG_DIR}/logs/out.log`);
      expect(plist).toContain(`${DEFAULT_CONFIG_DIR}/logs/err.log`);
    });

    it('includes binary path and start argument in ProgramArguments', async () => {
      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      const binary = getBinaryFromPlist(plist);
      expect(binary).toContain('tele-kb-bot');
      expect(plist).toContain('<string>start</string>');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // resolveBinaryPath behavior (tested through launchdAddCommand)
  // ──────────────────────────────────────────────────────────────────

  describe('resolveBinaryPath (tested through launchdAddCommand)', () => {
    it('returns process.argv[0] when it is a non-bun path containing tele-kb-bot', async () => {
      const customBinaryPath = '/usr/local/bin/tele-kb-bot';
      process.argv[0] = customBinaryPath;

      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(getBinaryFromPlist(plist)).toBe(customBinaryPath);
      // Should not check existsSync for Homebrew candidates
      expect(mockExistsSync).not.toHaveBeenCalledWith('/opt/homebrew/bin/tele-kb-bot');
    });

    it('returns Homebrew binary path when argv[0] contains bun and path exists', async () => {
      process.argv[0] = '/usr/local/bin/bun';
      mockExistsSync.mockImplementation((path: string) => {
        if (path === '/opt/homebrew/bin/tele-kb-bot') return true;
        if (path === '/usr/local/bin/tele-kb-bot') return false;
        return true;
      });

      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(getBinaryFromPlist(plist)).toBe('/opt/homebrew/bin/tele-kb-bot');
    });

    it('returns first existing Homebrew candidate in priority order', async () => {
      process.argv[0] = '/usr/local/bin/bun';
      mockExistsSync.mockImplementation((path: string) => {
        if (path === '/opt/homebrew/bin/tele-kb-bot') return false;
        if (path === '/usr/local/bin/tele-kb-bot') return true;
        return true;
      });

      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(getBinaryFromPlist(plist)).toBe('/usr/local/bin/tele-kb-bot');
    });

    it('falls back to ~/.local/bin path when it exists', async () => {
      process.argv[0] = '/usr/local/bin/bun';
      mockExistsSync.mockImplementation((path: string) => {
        if (path === '/opt/homebrew/bin/tele-kb-bot') return false;
        if (path === '/usr/local/bin/tele-kb-bot') return false;
        if (path === '/Users/test/.local/bin/tele-kb-bot') return true;
        return true;
      });

      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(getBinaryFromPlist(plist)).toBe('/Users/test/.local/bin/tele-kb-bot');
    });

    it('returns default /opt/homebrew/bin/tele-kb-bot when no candidate exists', async () => {
      process.argv[0] = '/usr/local/bin/bun';
      mockExistsSync.mockReturnValue(false);

      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(getBinaryFromPlist(plist)).toBe('/opt/homebrew/bin/tele-kb-bot');
    });
  });
  // ──────────────────────────────────────────────────────────────────
  // resolveNodePath behavior (tested through launchdAddCommand)
  // ──────────────────────────────────────────────────────────────────

  describe('resolveNodePath (tested through launchdAddCommand)', () => {
    it('prepends detected node bin dir to PATH when user accepts default', async () => {
      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(plist).toContain('/Users/test/.local/share/mise/shims:/opt/homebrew/bin');
    });

    it('prepends custom node bin dir to PATH when user overrides', async () => {
      const customNodePath = '/custom/node/bin/node';
      mockText.mockResolvedValueOnce(customNodePath);

      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      // Should include the override's parent dir
      expect(plist).toContain('/custom/node/bin:/opt/homebrew/bin');
    });

    it('logs and shows warning when user-entered path does not exist', async () => {
      const nonexistentPath = '/nonexistent/node/bin/node';
      mockText.mockResolvedValueOnce(nonexistentPath);
      mockExistsSync.mockImplementation((path: string) => {
        if (path === nonexistentPath) return false;
        return true;
      });
      await launchdAddCommand(defaultOptions);

      // User was prompted for both node (which returned nonexistent) and qmd
      expect(mockText).toHaveBeenCalledTimes(2);

      // PATH should not have the custom node prefix - qmd dir is still added
      const plist = getCapturedPlist();
      expect(plist).not.toContain('nonexistent');
      expect(plist).toContain('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
    });

    it('does not prompt and auto-uses detected path in non-interactive mode', async () => {
      await launchdAddCommand({ ...defaultOptions, nonInteractive: true });

      // @clack/prompts should NOT be called
      expect(mockText).not.toHaveBeenCalled();

      // PATH should still include the detected node bin dir
      const plist = getCapturedPlist();
      expect(plist).toContain('/Users/test/.local/share/mise/shims:/opt/homebrew/bin');
    });

    it('does not add custom PATH prefix when node not found', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('command not found');
      });

      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      // PATH should be the default base path without any extra prefix
      const expectedPath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
      expect(plist).toContain(expectedPath);
    });
  });
  // ──────────────────────────────────────────────────────────────────
  // resolveQmdPath behavior (tested through launchdAddCommand)
  // ──────────────────────────────────────────────────────────────────

  describe('resolveQmdPath (tested through launchdAddCommand)', () => {
    it('includes qmd bin dir in PATH when user accepts default', async () => {
      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      // Both node and qmd dirs are prepended
      expect(plist).toContain('/Users/test/.local/share/mise/shims:/opt/homebrew/bin');
    });

    it('prepends custom qmd bin dir when user overrides qmd path', async () => {
      const customQmdPath = '/custom/qmd/bin/qmd';
      // Node prompt uses default (placeholder), qmd prompt uses override
      mockText
        .mockResolvedValueOnce('/Users/test/.local/share/mise/shims/node') // node
        .mockResolvedValueOnce(customQmdPath); // qmd

      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      expect(plist).toContain('/Users/test/.local/share/mise/shims:/custom/qmd/bin');
    });

    it('skips qmd path when qmd binary not found', async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'command' && args[0] === '-v' && args[1] === 'node') {
          return '/Users/test/.local/share/mise/shims/node\n';
        }
        throw new Error('qmd not found');
      });

      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      // Only node dir is prepended
      expect(plist).toContain('/Users/test/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin');
    });

    it('does not add qmd dir to PATH when user-entered qmd path does not exist', async () => {
      const nonexistentQmd = '/nonexistent/qmd/bin/qmd';
      // Node prompt accepts default, qmd prompt returns nonexistent
      mockText
        .mockResolvedValueOnce('/Users/test/.local/share/mise/shims/node') // node
        .mockResolvedValueOnce(nonexistentQmd); // qmd
      mockExistsSync.mockImplementation((path: string) => {
        if (path === nonexistentQmd) return false;
        return true;
      });

      await launchdAddCommand(defaultOptions);

      const plist = getCapturedPlist();
      // Node dir is still added, but not the nonexistent qmd dir
      expect(plist).not.toContain('nonexistent');
      expect(plist).toContain('/Users/test/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin');
    });

    it('auto-uses detected qmd path in non-interactive mode', async () => {
      await launchdAddCommand({ ...defaultOptions, nonInteractive: true });

      // Both paths auto-used without prompts
      expect(mockText).not.toHaveBeenCalled();

      const plist = getCapturedPlist();
      // Both node and qmd dirs should be in PATH
      expect(plist).toContain('/Users/test/.local/share/mise/shims:/opt/homebrew/bin');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // launchdAddCommand integration behavior
  // ──────────────────────────────────────────────────────────────────

  describe('launchdAddCommand behavior', () => {
    it('writes plist to ~/Library/LaunchAgents/com.tele-kb-bot.plist', async () => {
      await launchdAddCommand(defaultOptions);

      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      const call0 = mockWriteFileSync.mock.calls[0];
      expect(call0?.[0]).toBe(LAUNCH_AGENTS_PATH);
      expect(call0?.[2]).toEqual({ mode: 0o644 });
    });

    it('ensures config directories before writing', async () => {
      await launchdAddCommand(defaultOptions);

      expect(mockEnsureConfigDirsSync).toHaveBeenCalledWith(DEFAULT_CONFIG_DIR);
      expect(mockEnsureConfigDirsSync).toHaveBeenCalledBefore(mockWriteFileSync);
    });

    it('loads service via launchctl bootstrap when confirm returns true', async () => {
      await launchdAddCommand(defaultOptions);

      expect(mockExecSync).toHaveBeenCalled();
      const allCalls: Array<Array<unknown>> = mockExecSync.mock.calls;
      const bootstrapCall = allCalls.find((args) => String(args[0]).includes('launchctl bootstrap'));
      expect(bootstrapCall).toBeDefined();
    });

    it('skips service loading when confirm returns false (skip confirm)', async () => {
      mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb('n'));

      await launchdAddCommand(defaultOptions);

      // Plist is still written
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      // Bootstrap is NOT called
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('retries with bootout when first bootstrap fails', async () => {
      mockExecSync
        .mockImplementationOnce(() => {
          throw new Error('already loaded');
        })
        .mockImplementationOnce(() => {}) // bootout (ignored)
        .mockImplementationOnce(() => {}); // retry bootstrap

      await launchdAddCommand(defaultOptions);

      expect(mockExecSync).toHaveBeenCalledTimes(3);
      const allCalls: Array<Array<unknown>> = mockExecSync.mock.calls;
      expect(allCalls[0]?.[0] != null ? String(allCalls[0][0]) : '').toContain('launchctl bootstrap');
      expect(allCalls[1]?.[0] != null ? String(allCalls[1][0]) : '').toContain('launchctl bootout');
      expect(allCalls[2]?.[0] != null ? String(allCalls[2][0]) : '').toContain('launchctl bootstrap');
    });

    it('shows error message when retry bootstrap also fails', async () => {
      mockExecSync
        .mockImplementationOnce(() => {
          throw new Error('first bootstrap failed');
        })
        .mockImplementationOnce(() => {}) // bootout succeeds
        .mockImplementationOnce(() => {
          throw new Error('second bootstrap also failed');
        });

      const consoleErrorSpy = vi.spyOn(console, 'log');

      await launchdAddCommand(defaultOptions);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const allCalls: Array<Array<unknown>> = consoleErrorSpy.mock.calls;
      const allErrOutput = allCalls.map((args) => String(args[0])).join(' ');
      expect(allErrOutput).toContain('Failed to load service');
      expect(allErrOutput).toContain('second bootstrap also failed');
    });

    it('handles non-Error rejection in retry bootstrap (e.g., string error)', async () => {
      mockExecSync
        .mockImplementationOnce(() => {
          throw new Error('first bootstrap failed');
        })
        .mockImplementationOnce(() => {}) // bootout succeeds
        .mockImplementationOnce(() => {
          throw 'string error from launchctl'; // non-Error throw
        });

      const consoleErrorSpy = vi.spyOn(console, 'log');

      await launchdAddCommand(defaultOptions);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const allCalls: Array<Array<unknown>> = consoleErrorSpy.mock.calls;
      const allErrOutput = allCalls.map((args) => String(args[0])).join(' ');
      expect(allErrOutput).toContain('Failed to load service');
      expect(allErrOutput).toContain('string error from launchctl');
    });

    it('loads service when user presses Enter (default yes)', async () => {
      mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb(''));

      await launchdAddCommand(defaultOptions);

      // Default is yes, so bootstrap should be attempted
      expect(mockExecSync).toHaveBeenCalled();
      const allCalls: Array<Array<unknown>> = mockExecSync.mock.calls;
      const bootstrapCall = allCalls.find((args) => String(args[0]).includes('launchctl bootstrap'));
      expect(bootstrapCall).toBeDefined();
    });

    it('passes configOverride as rawArgs in CLIOptions', async () => {
      const options: CLIOptions = {
        ...defaultOptions,
        configOverride: '/custom/dir',
        rawArgs: ['launchd', '--config', '/custom/dir'],
      };

      await launchdAddCommand(options);

      const plist = getCapturedPlist();
      expect(getConfigDirFromPlist(plist)).toBe('/custom/dir');
    });

    it('uses configOverride instead of default config dir', async () => {
      const customConfigDir = '/custom/config/dir';
      const options: CLIOptions = {
        ...defaultOptions,
        configOverride: customConfigDir,
      };

      await launchdAddCommand(options);

      const plist = getCapturedPlist();
      expect(getConfigDirFromPlist(plist)).toBe(customConfigDir);
      // Should NOT use mockResolveConfigDir's return value
      expect(mockResolveConfigDir).not.toHaveBeenCalled();
      // Should ensure the custom config dir
      expect(mockEnsureConfigDirsSync).toHaveBeenCalledWith(customConfigDir);
    });

    it('uses configOverride in plist log paths', async () => {
      const customConfigDir = '/custom/config';
      const options: CLIOptions = {
        ...defaultOptions,
        configOverride: customConfigDir,
      };

      await launchdAddCommand(options);

      const plist = getCapturedPlist();
      expect(plist).toContain(`${customConfigDir}/logs/out.log`);
      expect(plist).toContain(`${customConfigDir}/logs/err.log`);
    });

    it('logs binary path and plist path before writing', async () => {
      await launchdAddCommand(defaultOptions);

      expect(mockCreateCLILogger).toHaveBeenCalled();
      const logger = mockCreateCLILogger.mock.results[0]?.value;
      expect(logger.info).toHaveBeenCalled();
      const infoCalls: Array<Array<unknown>> = logger.info.mock.calls;
      const combined = Object.assign({}, ...infoCalls.map((args: Array<unknown>) => args[0]));
      expect(combined.binaryPath).toBeDefined();
      expect(combined.plistPath).toBe(LAUNCH_AGENTS_PATH);
    });

    it('prints management commands after installation', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb('n'));

      await launchdAddCommand(defaultOptions);

      const allCalls: Array<Array<unknown>> = consoleSpy.mock.calls;
      const allOutput = allCalls.map((args) => String(args[0])).join(' ');
      expect(allOutput).toContain('Management commands');
      expect(allOutput).toContain('launchctl bootstrap');
      expect(allOutput).toContain('launchctl bootout');
      expect(allOutput).toContain('launchctl list');
      expect(allOutput).toContain('logs/out.log');
      expect(allOutput).toContain('logs/err.log');
    });
  });
});

// ─── Tests: launchdRemoveCommand ────────────────────────────────────

describe('launchdRemoveCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);

    // Silence console output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when plist does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await launchdRemoveCommand();

    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('unloads service and removes plist', async () => {
    await launchdRemoveCommand();

    expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('launchctl bootout'), expect.any(Object));
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('handles service not running gracefully', async () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('service not loaded');
    });

    await launchdRemoveCommand();

    // Plist is still deleted even when unload fails
    expect(mockUnlinkSync).toHaveBeenCalled();
  });
});
