/**
 * Tests for the CLI command router and argument parsing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BINARY_NAME, VERSION } from '../constants';
import { parseArgs, runCLI } from './main';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('./help', () => ({ helpCommand: vi.fn() }));
vi.mock('./setup', () => ({ setupCommand: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./status', () => ({ statusCommand: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./launchd', () => ({
  launchdAddCommand: vi.fn().mockResolvedValue(undefined),
  launchdRemoveCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./systemd', () => ({
  systemdAddCommand: vi.fn().mockResolvedValue(undefined),
  systemdRemoveCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./index', () => ({ indexCommand: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../daemon/main', () => ({ startDaemon: vi.fn().mockResolvedValue(undefined) }));

import { startDaemon } from '../daemon/main';
import { helpCommand } from './help';
import { indexCommand } from './index';
import { launchdAddCommand, launchdRemoveCommand } from './launchd';
import { setupCommand } from './setup';
import { statusCommand } from './status';
import { systemdAddCommand, systemdRemoveCommand } from './systemd';

describe('parseArgs', () => {
  it('parses help command from empty args', () => {
    const opts = parseArgs([]);
    expect(opts.command).toBe('help');
    expect(opts.nonInteractive).toBe(false);
    expect(opts.configOverride).toBeUndefined();
  });

  it('parses setup command', () => {
    const opts = parseArgs(['setup']);
    expect(opts.command).toBe('setup');
  });

  it('parses start command', () => {
    const opts = parseArgs(['start']);
    expect(opts.command).toBe('start');
  });

  it('parses status command', () => {
    const opts = parseArgs(['status']);
    expect(opts.command).toBe('status');
  });

  it('parses install command', () => {
    const opts = parseArgs(['install']);
    expect(opts.command).toBe('install');
  });

  it('parses version command', () => {
    const opts = parseArgs(['version']);
    expect(opts.command).toBe('version');
  });

  it('parses --config flag', () => {
    const opts = parseArgs(['start', '--config', '/custom/path']);
    expect(opts.command).toBe('start');
    expect(opts.configOverride).toBe('/custom/path');
  });

  it('parses --non-interactive flag', () => {
    const opts = parseArgs(['setup', '--non-interactive']);
    expect(opts.command).toBe('setup');
    expect(opts.nonInteractive).toBe(true);
  });

  it('parses both --config and --non-interactive', () => {
    const opts = parseArgs(['setup', '--config', './dev', '--non-interactive']);
    expect(opts.command).toBe('setup');
    expect(opts.configOverride).toBe('./dev');
    expect(opts.nonInteractive).toBe(true);
  });

  it('falls back to help for unknown commands', () => {
    const opts = parseArgs(['unknown']);
    expect(opts.command).toBe('unknown');
  });

  // ── --config flag positions ────────────────────────────────────

  it('treats first positional arg as command even when it looks like a flag', () => {
    // args[0] is '--config' so command becomes '--config'
    const opts = parseArgs(['--config', '/custom/path', 'start']);
    expect(opts.command).toBe('--config');
    expect(opts.configOverride).toBe('/custom/path');
  });

  it('parses --config at the end after options', () => {
    const opts = parseArgs(['start', '--non-interactive', '--config', '/custom/path']);
    expect(opts.command).toBe('start');
    expect(opts.nonInteractive).toBe(true);
    expect(opts.configOverride).toBe('/custom/path');
  });

  it('handles --config without a following value', () => {
    const opts = parseArgs(['start', '--config']);
    expect(opts.command).toBe('start');
    expect(opts.configOverride).toBeUndefined();
  });

  it('handles --config when it is the last argument after command', () => {
    // The flag is at the end — no value follows, so configOverride is undefined
    const opts = parseArgs(['status', '--config']);
    expect(opts.command).toBe('status');
    expect(opts.configOverride).toBeUndefined();
  });

  // ── Case insensitivity ─────────────────────────────────────────

  it('lowercases command: Setup → setup', () => {
    const opts = parseArgs(['Setup']);
    expect(opts.command).toBe('setup');
  });

  it('lowercases command: STATUS → status', () => {
    const opts = parseArgs(['STATUS']);
    expect(opts.command).toBe('status');
  });

  it('lowercases command: StArT → start', () => {
    const opts = parseArgs(['StArT']);
    expect(opts.command).toBe('start');
  });

  it('lowercases command with mixed-case flags', () => {
    const opts = parseArgs(['Setup', '--config', '/path', '--Non-Interactive']);
    expect(opts.command).toBe('setup');
    expect(opts.configOverride).toBe('/path');
    // --non-interactive is checked via args.includes (case-sensitive)
    expect(opts.nonInteractive).toBe(false);
  });

  // ── rawArgs preservation ───────────────────────────────────────

  it('preserves rawArgs as-is', () => {
    const args = ['status', '--config', './dev', '--non-interactive'];
    const opts = parseArgs(args);
    expect(opts.rawArgs).toBe(args);
    expect(opts.rawArgs).toEqual(['status', '--config', './dev', '--non-interactive']);
  });

  it('preserves rawArgs with unusual ordering', () => {
    const args = ['--config', '/a/b', '--non-interactive', 'status', 'extra'];
    const opts = parseArgs(args);
    expect(opts.rawArgs).toEqual(args);
    expect(opts.command).toBe('--config');
  });

  // ── Edge cases ─────────────────────────────────────────────────

  it('handles args with only flags and no proper command', () => {
    const opts = parseArgs(['--config', '/path']);
    expect(opts.command).toBe('--config');
    // indexOf returns 0, so args[1] = '/path'
    expect(opts.configOverride).toBe('/path');
  });

  it('handles args with empty string as command', () => {
    const opts = parseArgs(['']);
    // args[0] is '' so command is '' (not 'help' — that fallback is only for empty array)
    expect(opts.command).toBe('');
  });

  it('handles args with only whitespace strings', () => {
    const opts = parseArgs(['  ']);
    expect(opts.command).toBe('  ');
  });

  it('handles --non-interactive flag appearing multiple times', () => {
    const opts = parseArgs(['setup', '--non-interactive', '--non-interactive']);
    expect(opts.command).toBe('setup');
    expect(opts.nonInteractive).toBe(true);
  });

  it('handles --config flag appearing multiple times (indexOf returns first)', () => {
    const opts = parseArgs(['start', '--config', '/first', '--config', '/second']);
    expect(opts.command).toBe('start');
    // parseArgs uses indexOf which returns the first occurrence
    expect(opts.configOverride).toBe('/first');
  });

  it('preserves subcommand args in rawArgs', () => {
    // For 'index build', rawArgs contains both
    const opts = parseArgs(['index', 'build']);
    expect(opts.command).toBe('index');
    expect(opts.rawArgs).toEqual(['index', 'build']);
  });

  it('handles --config value that looks like another flag', () => {
    const opts = parseArgs(['start', '--config', '--non-interactive']);
    expect(opts.command).toBe('start');
    expect(opts.configOverride).toBe('--non-interactive');
  });
});

describe('constants', () => {
  it('has a valid version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[A-Za-z0-9]+)*$/);
  });

  it('has a valid binary name', () => {
    expect(BINARY_NAME).toBe('tele-kb-bot');
  });
});

// ─── runCLI ───────────────────────────────────────────────────────────

describe('runCLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls helpCommand for unknown commands', async () => {
    await runCLI(['unknown']);
    expect(helpCommand).toHaveBeenCalledTimes(1);
  });

  it('calls helpCommand when no command provided', async () => {
    await runCLI([]);
    expect(helpCommand).toHaveBeenCalledTimes(1);
  });

  it('calls setupCommand for setup', async () => {
    await runCLI(['setup']);
    expect(setupCommand).toHaveBeenCalledTimes(1);
    expect(setupCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'setup' }));
  });

  it('passes configOverride and nonInteractive to setupCommand', async () => {
    await runCLI(['setup', '--config', '/custom/path', '--non-interactive']);
    expect(setupCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'setup',
        configOverride: '/custom/path',
        nonInteractive: true,
      }),
    );
  });

  it('calls statusCommand for status', async () => {
    await runCLI(['status']);
    expect(statusCommand).toHaveBeenCalledTimes(1);
    expect(statusCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'status' }));
  });

  it('prints version to console', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runCLI(['version']);
      expect(spy).toHaveBeenCalledWith(`tele-kb-bot v${VERSION}`);
    } finally {
      spy.mockRestore();
    }
  });

  it('routes launchd add to launchdAddCommand', async () => {
    await runCLI(['launchd', 'add']);
    expect(launchdAddCommand).toHaveBeenCalledTimes(1);
    expect(launchdAddCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'launchd', subcommand: 'add' }));
  });

  it('routes launchd remove to launchdRemoveCommand', async () => {
    await runCLI(['launchd', 'remove']);
    expect(launchdRemoveCommand).toHaveBeenCalledTimes(1);
  });

  it('routes systemd add to systemdAddCommand', async () => {
    await runCLI(['systemd', 'add']);
    expect(systemdAddCommand).toHaveBeenCalledTimes(1);
    expect(systemdAddCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'systemd', subcommand: 'add' }));
  });

  it('routes systemd remove to systemdRemoveCommand', async () => {
    await runCLI(['systemd', 'remove']);
    expect(systemdRemoveCommand).toHaveBeenCalledTimes(1);
  });

  it('shows help for unknown launchd subcommand', async () => {
    await runCLI(['launchd', 'unknown']);
    expect(helpCommand).toHaveBeenCalledTimes(1);
  });

  it('shows help for unknown systemd subcommand', async () => {
    await runCLI(['systemd', 'unknown']);
    expect(helpCommand).toHaveBeenCalledTimes(1);
  });

  it('routes install-launchd to launchdAddCommand (backward compat)', async () => {
    await runCLI(['install-launchd']);
    expect(launchdAddCommand).toHaveBeenCalledTimes(1);
    expect(launchdAddCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'install-launchd' }));
  });

  it('calls indexCommand for index', async () => {
    await runCLI(['index']);
    expect(indexCommand).toHaveBeenCalledTimes(1);
    expect(indexCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'index' }));
  });

  it('calls startDaemon for start command with dynamic import', async () => {
    await runCLI(['start']);
    expect(startDaemon).toHaveBeenCalledTimes(1);
    expect(startDaemon).toHaveBeenCalledWith(undefined);
  });

  it('passes configOverride to startDaemon', async () => {
    await runCLI(['start', '--config', '/custom/path']);
    expect(startDaemon).toHaveBeenCalledWith('/custom/path');
  });

  it('handles setup command with mixed-case input', async () => {
    await runCLI(['Setup']);
    expect(setupCommand).toHaveBeenCalledTimes(1);
    expect(setupCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'setup' }));
  });
});
