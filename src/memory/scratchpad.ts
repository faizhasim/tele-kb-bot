/**
 * Scratchpad parser for tele-kb-bot.
 *
 * Parses markdown checklist items: `- [ ] item` (open) and `- [x] item` (done).
 * Pure functions — no IO.
 *
 * @module
 */

import type { ScratchpadItem } from './types';

/** Regex for `- [ ] text` (open) or `- [x] text` (done) */
const ITEM_RE = /^[\s]*[-*+]\s+\[([ xX])\]\s+(.+)$/;

/**
 * Parse a scratchpad markdown string into checklist items.
 */
const parseScratchpad = (content: string): ReadonlyArray<ScratchpadItem> =>
  content
    .split('\n')
    .map((line) => {
      const match = ITEM_RE.exec(line);
      if (!match) return null;
      return { done: match[1]?.toLowerCase() === 'x', text: match[2]?.trim() };
    })
    .filter(Boolean) as Array<ScratchpadItem>;

/**
 * Render checklist items back to markdown.
 */
const renderScratchpad = (items: ReadonlyArray<ScratchpadItem>): string => {
  const lines = items.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`);
  return `${lines.join('\n')}\n`;
};

/**
 * Add a new open item to the scratchpad.
 */
const addItem = (items: ReadonlyArray<ScratchpadItem>, text: string, front = true): Array<ScratchpadItem> => {
  const newItem: ScratchpadItem = { text, done: false };
  return front ? [newItem, ...items] : [...items, newItem];
};

/**
 * Toggle an item's done state by index.
 * Returns new array (immutable).
 */
const markDone = (items: ReadonlyArray<ScratchpadItem>, index: number): Array<ScratchpadItem> => {
  if (index < 0 || index >= items.length) return [...items];
  return items.map((item, i) => (i === index ? { ...item, done: true } : item));
};

const markUndone = (items: ReadonlyArray<ScratchpadItem>, index: number): Array<ScratchpadItem> => {
  if (index < 0 || index >= items.length) return [...items];
  return items.map((item, i) => (i === index ? { ...item, done: false } : item));
};

/**
 * Remove all completed items.
 */
const clearDone = (items: ReadonlyArray<ScratchpadItem>): Array<ScratchpadItem> => items.filter((item) => !item.done);

/**
 * Get only open (not done) items.
 */
const openItems = (items: ReadonlyArray<ScratchpadItem>): ReadonlyArray<ScratchpadItem> =>
  items.filter((item) => !item.done);

export type { ScratchpadItem };
export { addItem, clearDone, markDone, markUndone, openItems, parseScratchpad, renderScratchpad };
