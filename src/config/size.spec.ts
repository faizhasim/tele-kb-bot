/**
 * Tests for size parsing and formatting utilities.
 */

import { describe, expect, it } from 'vitest';
import { formatSize, parseSize } from './size';

describe('parseSize', () => {
  it('parses bytes (no suffix)', () => {
    expect(parseSize('128')).toBe(128);
    expect(parseSize('0')).toBe(0);
  });

  it('parses KB', () => {
    expect(parseSize('1 KB')).toBe(1024);
    expect(parseSize('1KB')).toBe(1024);
    expect(parseSize('2 KB')).toBe(2048);
  });

  it('parses MB', () => {
    expect(parseSize('1 MB')).toBe(1_048_576);
    expect(parseSize('500MB')).toBe(524_288_000);
    expect(parseSize('1.5 MB')).toBe(1_572_864);
  });

  it('parses GB', () => {
    expect(parseSize('1 GB')).toBe(1_073_741_824);
    expect(parseSize('2GB')).toBe(2_147_483_648);
  });

  it('parses TB', () => {
    expect(parseSize('1 TB')).toBe(1_099_511_627_776);
  });

  it('rejects invalid input', () => {
    expect(parseSize('')).toBeNull();
    expect(parseSize('xyz')).toBeNull();
    expect(parseSize('-5MB')).toBeNull();
    expect(parseSize('abc MB')).toBeNull();
  });
});

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(128)).toBe('128 B');
    expect(formatSize(0)).toBe('0 B');
  });

  it('formats KB', () => {
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(2048)).toBe('2 KB');
  });

  it('formats MB', () => {
    expect(formatSize(1_048_576)).toBe('1 MB');
    expect(formatSize(524_288_000)).toBe('500 MB');
  });

  it('formats GB', () => {
    expect(formatSize(1_073_741_824)).toBe('1 GB');
    expect(formatSize(2_147_483_648)).toBe('2 GB');
  });

  it('formats with 1 decimal when < 10', () => {
    expect(formatSize(1_500_000)).toBe('1.4 MB');
  });

  it('round-trips parse/format', () => {
    const sizes = ['500 MB', '2 GB', '128 KB', '1 TB'];
    for (const s of sizes) {
      const bytes = parseSize(s);
      if (bytes === null) {
        expect(bytes).not.toBeNull();
        continue;
      }
      expect(formatSize(bytes)).toBe(s);
    }
  });
});
