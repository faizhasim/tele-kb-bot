import { describe, expect, it } from 'vitest';
import { addItem, clearDone, markDone, markUndone, openItems, parseScratchpad, renderScratchpad } from './scratchpad';

describe('parseScratchpad', () => {
  it('parses open items', () => {
    const items = parseScratchpad('- [ ] fix login bug\n- [ ] write tests\n');
    expect(items).toHaveLength(2);
    expect(items[0]?.done).toBe(false);
    expect(items[0]?.text).toBe('fix login bug');
  });

  it('parses done items', () => {
    const items = parseScratchpad('- [x] deploy\n- [X] logout\n');
    expect(items[0]?.done).toBe(true);
    expect(items[1]?.done).toBe(true);
  });

  it('ignores non-checklist lines', () => {
    const items = parseScratchpad('# Header\n- [ ] real item\nsome text\n');
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('real item');
  });

  it('returns empty array for empty content', () => {
    expect(parseScratchpad('')).toEqual([]);
  });

  it('handles lines with leading whitespace', () => {
    const items = parseScratchpad('  - [ ] indented item\n\t- [x] tabbed item\n');
    expect(items).toHaveLength(2);
    expect(items[0]?.text).toBe('indented item');
    expect(items[0]?.done).toBe(false);
    expect(items[1]?.text).toBe('tabbed item');
    expect(items[1]?.done).toBe(true);
  });

  it('handles different list markers (*, +, -)', () => {
    const items = parseScratchpad('* [ ] star item\n+ [x] plus item\n- [ ] dash item\n');
    expect(items).toHaveLength(3);
    expect(items[0]?.text).toBe('star item');
    expect(items[0]?.done).toBe(false);
    expect(items[1]?.text).toBe('plus item');
    expect(items[1]?.done).toBe(true);
    expect(items[2]?.text).toBe('dash item');
    expect(items[2]?.done).toBe(false);
  });
});

describe('renderScratchpad', () => {
  it('renders items to markdown', () => {
    const rendered = renderScratchpad([
      { text: 'a', done: false },
      { text: 'b', done: true },
    ]);
    expect(rendered).toBe('- [ ] a\n- [x] b\n');
  });
});

describe('addItem', () => {
  it('adds item at front by default', () => {
    const result = addItem([{ text: 'existing', done: false }], 'new');
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe('new');
  });

  it('adds item at back when front=false', () => {
    const items = [{ text: 'existing', done: false }];
    const result = addItem(items, 'new', false);
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe('existing');
    expect(result[1]?.text).toBe('new');
  });
});

describe('markDone', () => {
  it('marks an item done', () => {
    const result = markDone([{ text: 'x', done: false }], 0);
    expect(result[0]?.done).toBe(true);
  });

  it('no-ops on out-of-range index', () => {
    const result = markDone([{ text: 'x', done: false }], 99);
    expect(result[0]?.done).toBe(false);
  });
});

describe('markUndone', () => {
  it('marks a done item as not done', () => {
    const items = [{ text: 'task', done: true }];
    const result = markUndone(items, 0);
    expect(result[0]?.done).toBe(false);
    expect(result[0]?.text).toBe('task');
  });

  it('returns new array without mutating original', () => {
    const items = [{ text: 'task', done: true }];
    const result = markUndone(items, 0);
    expect(items[0]?.done).toBe(true);
    expect(result[0]?.done).toBe(false);
    expect(result).not.toBe(items);
  });

  it('no-ops on out-of-range index', () => {
    const items = [{ text: 'task', done: true }];
    const result = markUndone(items, 99);
    expect(result).toHaveLength(1);
    expect(result[0]?.done).toBe(true);
  });

  it('no-ops on negative index', () => {
    const items = [{ text: 'task', done: true }];
    const result = markUndone(items, -1);
    expect(result[0]?.done).toBe(true);
  });
});

describe('openItems', () => {
  it('returns only not-done items', () => {
    const items = [
      { text: 'task 1', done: false },
      { text: 'done task', done: true },
      { text: 'task 2', done: false },
    ];
    const result = openItems(items);
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe('task 1');
    expect(result[1]?.text).toBe('task 2');
  });

  it('returns empty array when all items are done', () => {
    const items = [
      { text: 'done 1', done: true },
      { text: 'done 2', done: true },
    ];
    expect(openItems(items)).toEqual([]);
  });

  it('returns all items when none are done', () => {
    const items = [
      { text: 'open 1', done: false },
      { text: 'open 2', done: false },
    ];
    const result = openItems(items);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(openItems([])).toEqual([]);
  });
});

describe('clearDone', () => {
  it('removes done items', () => {
    const result = clearDone([
      { text: 'open', done: false },
      { text: 'done', done: true },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('open');
  });
});
