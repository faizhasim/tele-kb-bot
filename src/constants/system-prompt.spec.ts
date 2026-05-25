/**
 * Tests for the system prompt module.
 */

import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, READ_ONLY_SYSTEM_PROMPT_BASE } from './system-prompt';

describe('READ_ONLY_SYSTEM_PROMPT_BASE', () => {
  it('is exported and is a string', () => {
    expect(typeof READ_ONLY_SYSTEM_PROMPT_BASE).toBe('string');
  });

  it('is non-empty', () => {
    expect(READ_ONLY_SYSTEM_PROMPT_BASE.length).toBeGreaterThan(0);
  });

  it('contains expected key phrases', () => {
    expect(READ_ONLY_SYSTEM_PROMPT_BASE).toContain('knowledge base');
    expect(READ_ONLY_SYSTEM_PROMPT_BASE).toContain('assistant');
    expect(READ_ONLY_SYSTEM_PROMPT_BASE).toContain('Telegram');
    expect(READ_ONLY_SYSTEM_PROMPT_BASE).toContain('## Important');
    expect(READ_ONLY_SYSTEM_PROMPT_BASE).toContain('Telegram HTML');
    expect(READ_ONLY_SYSTEM_PROMPT_BASE).toContain('automatically searched');
  });
});

describe('buildSystemPrompt', () => {
  it('returns base prompt when no vault directories', () => {
    const result = buildSystemPrompt([]);
    expect(result).toBe(READ_ONLY_SYSTEM_PROMPT_BASE);
  });

  it('returns base prompt when no vault directories given (undefined)', () => {
    // Using explicit empty array (the parameter is ReadonlyArray<string>)
    const result = buildSystemPrompt([]);
    expect(result).toBe(READ_ONLY_SYSTEM_PROMPT_BASE);
  });

  it('appends Obsidian section when vault directories are provided', () => {
    const result = buildSystemPrompt(['/Users/me/Obsidian/Main']);
    expect(result).toContain('Obsidian Links');
    expect(result).toContain('obsidian://open?vault=');
    expect(result).toContain(READ_ONLY_SYSTEM_PROMPT_BASE);
  });

  it('includes Obsidian Links section when vaults are configured', () => {
    const result = buildSystemPrompt(['/Users/me/Obsidian/Main', '/Users/me/Obsidian/Work']);
    expect(result).toContain('Obsidian Links');
    expect(result).toContain('Do NOT reconstruct the URI yourself');
    expect(result).toContain('copy-paste');
  });

  it('includes Obsidian Links section for single vault', () => {
    const result = buildSystemPrompt(['/Users/me/Obsidian/Main/']);
    expect(result).toContain('Obsidian Links');
    expect(result).toContain('copy it verbatim');
    expect(result).toContain('obsidian://open?vault=');
  });

  it('returns override when override string is provided and non-empty', () => {
    const result = buildSystemPrompt([], 'custom prompt content');
    expect(result).toBe('custom prompt content');
    expect(result).not.toContain(READ_ONLY_SYSTEM_PROMPT_BASE);
  });

  it('ignores override when it is empty string', () => {
    const result = buildSystemPrompt([], '');
    expect(result).toBe(READ_ONLY_SYSTEM_PROMPT_BASE);
  });

  it('ignores override when vault directories also present', () => {
    const result = buildSystemPrompt(['/vault'], 'custom override');
    expect(result).toBe('custom override');
    expect(result).not.toContain('Obsidian');
  });
});
