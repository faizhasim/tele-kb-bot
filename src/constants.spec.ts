import { describe, expect, it } from 'vitest';
import { BINARY_NAME, VERSION } from './constants';

describe('constants', () => {
  it('VERSION is semver', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[A-Za-z0-9]+)*$/);
  });

  it('BINARY_NAME is tele-kb-bot', () => {
    expect(BINARY_NAME).toBe('tele-kb-bot');
  });
});
