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
    expect(READ_ONLY_SYSTEM_PROMPT_BASE).toContain('read-only');
    expect(READ_ONLY_SYSTEM_PROMPT_BASE).toContain('Telegram HTML');
    expect(READ_ONLY_SYSTEM_PROMPT_BASE).toContain('memory_search');
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

  it('includes vault mappings in Obsidian section', () => {
    const result = buildSystemPrompt(['/Users/me/Obsidian/Main', '/Users/me/Obsidian/Work']);
    expect(result).toContain('Main');
    expect(result).toContain('Work');
    expect(result).toContain('/Users/me/Obsidian/Main');
    expect(result).toContain('/Users/me/Obsidian/Work');
  });

  it('handles vault path with trailing slash', () => {
    const result = buildSystemPrompt(['/Users/me/Obsidian/Main/']);
    expect(result).toContain('obsidian://open?vault=Main');
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
