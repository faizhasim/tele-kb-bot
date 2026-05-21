import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configure, detect, reset, search } from './qmd';

describe('detect', () => {
  beforeEach(() => reset());
  afterEach(() => reset());

  it('returns false when configured with a non-existent binary path', () => {
    configure('/dev/null/nonexistent-qmd-binary');
    expect(detect()).toBe(false);
  });
});

describe('parseOutput', () => {
  it('handles empty string gracefully', () => {
    expect(search('', 5)).toBeNull();
  });
});
