/**
 * Tests for the CLI systemd add/remove commands.
 *
 * Tests systemdAddCommand and systemdRemoveCommand through their
 * public interface, controlling mocks to verify behavior.
 *
 * @module
 */

import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CLIOptions } from './main';

// ─── Hoisted mocks (available in vi.mock factories) ─────────────────

const {
  mockExecSync,
  mockExistsSync,
  mockWriteFileSync,
  mockUnlinkSync,
  mockResolveConfigDir,
  mockEnsureConfigDirsSync,
  mockCreateCLILogger,
  mockHomedir,
  mockPlatform,
} = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockResolveConfigDir: vi.fn().mockReturnValue('/home/test/.config/tele-kb-bot'),
  mockEnsureConfigDirsSync: vi.fn(),
  mockCreateCLILogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  mockHomedir: vi.fn().mockReturnValue('/home/test'),
  mockPlatform: vi.fn(),
}));

// ─── Module mocks ───────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
}));

vi.mock('../config/paths', () => ({
  ensureConfigDirsSync: mockEnsureConfigDirsSync,
  resolveConfigDir: mockResolveConfigDir,
}));

vi.mock('../logger', () => ({
  createCLILogger: mockCreateCLILogger,
}));

vi.mock('node:os', () => ({
  homedir: mockHomedir,
  platform: mockPlatform,
}));

// ─── Module imports (after vi.mock) ─────────────────────────────────

import { systemdAddCommand, systemdRemoveCommand } from './systemd';

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_HOME = '/home/test';
const SERVICE_PATH = join(DEFAULT_HOME, '.config', 'systemd', 'user', 'tele-kb-bot.service');
const DEFAULT_CONFIG_DIR = '/home/test/.config/tele-kb-bot';

const defaultOptions: CLIOptions = {
  command: 'systemd-add',
  configOverride: undefined,
  nonInteractive: true,
  rawArgs: ['systemd', 'add'],
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('systemdAddCommand', () => {
  let output: string;

  beforeEach(() => {
    vi.clearAllMocks();

    output = '';
    mockPlatform.mockReturnValue('linux');
    mockExistsSync.mockReturnValue(true);
    process.argv[0] = '/usr/local/bin/bun';

    vi.spyOn(console, 'log').mockImplementation((...args) => {
      output += `${args.join(' ')}\n`;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints error when not on Linux', async () => {
    mockPlatform.mockReturnValue('darwin');

    await systemdAddCommand(defaultOptions);

    expect(output).toContain('only available on Linux');
  });

  it('does nothing on non-Linux', async () => {
    mockPlatform.mockReturnValue('darwin');

    await systemdAddCommand(defaultOptions);

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockEnsureConfigDirsSync).not.toHaveBeenCalled();
  });

  it('writes service unit to ~/.config/systemd/user/tele-kb-bot.service on Linux', async () => {
    await systemdAddCommand(defaultOptions);

    expect(mockEnsureConfigDirsSync).toHaveBeenCalledWith(DEFAULT_CONFIG_DIR);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      SERVICE_PATH,
      expect.stringContaining('[Unit]'),
      expect.objectContaining({ mode: 0o644 }),
    );
    expect(mockWriteFileSync).toHaveBeenCalledBefore(mockExecSync);
  });

  it('includes binary path and config dir in service unit', async () => {
    await systemdAddCommand(defaultOptions);

    const serviceContent = String(mockWriteFileSync.mock.calls[0]?.[1]);
    expect(serviceContent).toContain('ExecStart=');
    expect(serviceContent).toContain('tele-kb-bot start');
    expect(serviceContent).toContain('TELE_KB_BOT_CONFIG');
    expect(serviceContent).toContain(DEFAULT_CONFIG_DIR);
    expect(serviceContent).toContain('[Install]');
    expect(serviceContent).toContain('WantedBy=default.target');
  });

  it('runs systemctl --user daemon-reload, enable, start', async () => {
    await systemdAddCommand(defaultOptions);

    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(mockExecSync).toHaveBeenNthCalledWith(1, 'systemctl --user daemon-reload', { stdio: 'pipe' });
    expect(mockExecSync).toHaveBeenNthCalledWith(2, 'systemctl --user enable tele-kb-bot', { stdio: 'pipe' });
    expect(mockExecSync).toHaveBeenNthCalledWith(3, 'systemctl --user start tele-kb-bot', { stdio: 'pipe' });
  });

  it('handles daemon-reload failure gracefully', async () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('reload failed');
    });

    await systemdAddCommand(defaultOptions);

    // Only daemon-reload was attempted; enable/start skipped
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(output).toContain('Failed to reload systemd daemon');
  });
});

describe('systemdRemoveCommand', () => {
  let output: string;

  beforeEach(() => {
    vi.clearAllMocks();

    output = '';
    mockPlatform.mockReturnValue('linux');
    mockExistsSync.mockReturnValue(true);

    vi.spyOn(console, 'log').mockImplementation((...args) => {
      output += `${args.join(' ')}\n`;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints error when not on Linux', async () => {
    mockPlatform.mockReturnValue('darwin');

    await systemdRemoveCommand();

    expect(output).toContain('only available on Linux');
  });

  it('does nothing when service file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await systemdRemoveCommand();

    expect(output).toContain('No systemd service found');
    expect(mockExecSync).not.toHaveBeenCalled();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('stops, disables, removes service, reloads daemon', async () => {
    await systemdRemoveCommand();

    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(mockExecSync).toHaveBeenNthCalledWith(1, 'systemctl --user stop tele-kb-bot', { stdio: 'pipe' });
    expect(mockExecSync).toHaveBeenNthCalledWith(2, 'systemctl --user disable tele-kb-bot', { stdio: 'pipe' });
    expect(mockExecSync).toHaveBeenNthCalledWith(3, 'systemctl --user daemon-reload', { stdio: 'pipe' });
    expect(mockUnlinkSync).toHaveBeenCalledWith(SERVICE_PATH);
  });

  it('handles service not running gracefully', async () => {
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error('not running');
      })
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {});

    await systemdRemoveCommand();

    // stop threw, but disable, unlink, and daemon-reload still proceed
    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(mockUnlinkSync).toHaveBeenCalledWith(SERVICE_PATH);

    const logger = mockCreateCLILogger.mock.results[0]?.value;
    expect(logger.debug).toHaveBeenCalledWith('Service was not running.');
  });
});
