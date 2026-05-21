import { describe, expect, it } from 'vitest';
import { MEMORY_FILES } from './types';

describe('MEMORY_FILES', () => {
  it('exposes MEMORY as MEMORY.md', () => {
    expect(MEMORY_FILES.MEMORY).toBe('MEMORY.md');
  });

  it('exposes SCRATCHPAD as SCRATCHPAD.md', () => {
    expect(MEMORY_FILES.SCRATCHPAD).toBe('SCRATCHPAD.md');
  });

  it('exposes DAILY_PREFIX as empty string', () => {
    expect(MEMORY_FILES.DAILY_PREFIX).toBe('');
  });

  it('has exactly 3 keys', () => {
    expect(Object.keys(MEMORY_FILES)).toHaveLength(3);
  });
});
