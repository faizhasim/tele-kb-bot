import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BINARY_NAME, VERSION } from '../constants';
import { helpCommand } from './help';

describe('helpCommand', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      output += `${args.join(' ')}\n`;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints binary name and version', () => {
    helpCommand();
    expect(output).toContain(BINARY_NAME);
    expect(output).toContain(VERSION);
  });

  it('lists available commands', () => {
    helpCommand();
    expect(output).toContain('setup');
    expect(output).toContain('start');
    expect(output).toContain('status');
    expect(output).toContain('launchd');
    expect(output).toContain('systemd');
    expect(output).toContain('version');
    expect(output).toContain('help');
  });

  it('documents environment variables', () => {
    helpCommand();
    expect(output).toContain('TELE_KB_BOT_CONFIG');
    expect(output).toContain('TELEGRAM_BOT_TOKEN');
    expect(output).toContain('OPENER_GO_API_KEY');
    expect(output).toContain('LOG_LEVEL');
  });

  it('shows usage examples', () => {
    helpCommand();
    expect(output).toContain('tele-kb-bot setup');
    expect(output).toContain('tele-kb-bot status');
  });
});
