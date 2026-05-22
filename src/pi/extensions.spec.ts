/**
 * Tests for src/pi/extensions.ts
 *
 * Compiled-in extension factories for the pi SDK.
 * All imports from @mariozechner/pi-coding-agent are TYPE-ONLY at source,
 * making these very testable with simple mocks.
 *
 * ⚠️ Module-level state: `_memoryCtx` is set by `createExtensionFactories(memoryCtx)`.
 * Null-ctx tests MUST run BEFORE any ctx-set call. See ordering below.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryContext } from '../memory/interface';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('../memory/manager', () => ({
  appendMemorySync: vi.fn(),
  appendTodaySync: vi.fn(),
  readMemorySync: vi.fn().mockReturnValue(''),
  readScratchpadSync: vi.fn().mockReturnValue(''),
  writeScratchpadSync: vi.fn(),
}));

import * as manager from '../memory/manager';
// Must import AFTER vi.mock — vitest hoists the mock declarations
import { createExtensionFactories } from './extensions';

// ─── Test Helpers ───────────────────────────────────────────────────

/** Create a minimal mock ExtensionAPI.
 * Returns `any` to satisfy the full ExtensionAPI interface
 * (23+ methods) that we don't need to mock for these tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockAPI(): any {
  const tools: any[] = [];
  const registerTool = vi.fn().mockImplementation((toolDef: any) => {
    tools.push(toolDef);
  });
  return { registerTool, tools };
}

/** Create a mock MemoryContext with default fns and configDir */
function createMockMemoryContext(overrides: Partial<MemoryContext> = {}): MemoryContext {
  return {
    backend: {
      search: vi.fn().mockResolvedValue([]),
      rebuildIndex: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockReturnValue(true),
    },
    configDir: '/tmp/test-config',
    maxEntries: 100,
    maxSizeBytes: 4096,
    ...overrides,
  };
}

/** Convenient lookup in api.tools array */
function findTool(api: any, name: string): any {
  return api.tools.find((t: any) => t.name === name);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Base Tests ─────────────────────────────────────────────────────

describe('createExtensionFactories', () => {
  it('returns an array of 5 factory functions', () => {
    const factories = createExtensionFactories();
    expect(factories).toHaveLength(5);
    for (const f of factories) {
      expect(typeof f).toBe('function');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// telegram_attach — does NOT use _memoryCtx, safe to test anywhere
// ═══════════════════════════════════════════════════════════════════

describe('telegram_attach extension', () => {
  const factories = createExtensionFactories();

  it('registers tool with name, label, and description', () => {
    const api = createMockAPI();
    factories[0]?.(api);

    const tool = findTool(api, 'telegram_attach');
    expect(tool).toBeDefined();
    expect(tool.name).toBe('telegram_attach');
    expect(tool.label).toBe('Attach files to Telegram');
    expect(tool.description).toContain('Queue file paths');
  });

  it('execute returns queued file paths with caption', async () => {
    const api = createMockAPI();
    factories[0]?.(api);
    const tool = findTool(api, 'telegram_attach');

    const result = await tool.execute('call-1', {
      file_paths: ['/tmp/test.pdf'],
      caption: 'Here is the file',
    });

    expect(result.content[0].text).toContain('Queued 1 file(s)');
    expect(result.content[0].text).toContain('/tmp/test.pdf');
    expect(result.content[0].text).toContain('Caption: Here is the file');
  });

  it('execute returns queued file paths without caption', async () => {
    const api = createMockAPI();
    factories[0]?.(api);
    const tool = findTool(api, 'telegram_attach');

    const result = await tool.execute('call-2', {
      file_paths: ['/tmp/photo.jpg'],
    });

    expect(result.content[0].text).toContain('Queued 1 file(s)');
    expect(result.content[0].text).toContain('/tmp/photo.jpg');
    expect(result.content[0].text).not.toContain('Caption:');
  });

  it('handles multiple file paths', async () => {
    const api = createMockAPI();
    factories[0]?.(api);
    const tool = findTool(api, 'telegram_attach');

    const result = await tool.execute('call-3', {
      file_paths: ['/tmp/a.pdf', '/tmp/b.jpg', '/tmp/c.png'],
      caption: 'Multiple files',
    });

    expect(result.content[0].text).toContain('Queued 3 file(s)');
    expect(result.content[0].text).toContain('/tmp/a.pdf');
    expect(result.content[0].text).toContain('/tmp/b.jpg');
    expect(result.content[0].text).toContain('/tmp/c.png');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Null-ctx tests — MUST run before any createExtensionFactories(ctx)
// _memoryCtx is initially null; calling without args does NOT change it
// ═══════════════════════════════════════════════════════════════════

describe('memory tools — null context', () => {
  // Grab factories before any ctx is set; _memoryCtx remains null
  const factories = createExtensionFactories();

  describe('memory_write', () => {
    it('returns not-initialised message', async () => {
      const api = createMockAPI();
      factories[1]?.(api);
      const tool = findTool(api, 'memory_write');

      const result = await tool.execute('id', { content: 'test' });

      expect(result.content[0].text).toBe('[Memory] Not initialised yet.');
      expect(manager.appendMemorySync).not.toHaveBeenCalled();
      expect(manager.appendTodaySync).not.toHaveBeenCalled();
    });
  });

  describe('memory_read', () => {
    it('returns not-initialised message', async () => {
      const api = createMockAPI();
      factories[2]?.(api);
      const tool = findTool(api, 'memory_read');

      const result = await tool.execute('id', { query: 'test' });

      expect(result.content[0].text).toBe('[Memory] Not initialised yet.');
    });
  });

  describe('scratchpad', () => {
    it('returns not-initialised message', async () => {
      const api = createMockAPI();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'list' });

      expect(result.content[0].text).toBe('[Scratchpad] Not initialised yet.');
    });
  });

  describe('memory_search', () => {
    it('returns not-initialised message', async () => {
      const api = createMockAPI();
      factories[4]?.(api);
      const tool = findTool(api, 'memory_search');

      const result = await tool.execute('id', { query: 'test' });

      expect(result.content[0].text).toBe('[Memory Search] Not initialised yet.');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Ctx-set tests — each describe creates its own context via beforeEach
// ═══════════════════════════════════════════════════════════════════

describe('memory_write extension', () => {
  let mockCtx: MemoryContext;

  beforeEach(() => {
    mockCtx = createMockMemoryContext();
    createExtensionFactories(mockCtx);
  });

  it('registers tool with correct name, label, and description', () => {
    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[1]?.(api);

    const tool = findTool(api, 'memory_write');
    expect(tool.name).toBe('memory_write');
    expect(tool.label).toContain('Write to memory');
    expect(tool.description).toContain('knowledge base');
  });

  it('appends to memory and daily log, then rebuilds index', async () => {
    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[1]?.(api);
    const tool = findTool(api, 'memory_write');

    await tool.execute('id', { content: 'Important decision: use TypeScript' });

    // Appended to MEMORY.md
    expect(manager.appendMemorySync).toHaveBeenCalledWith(mockCtx.configDir, expect.stringContaining('### general'));
    expect(manager.appendMemorySync).toHaveBeenCalledWith(
      mockCtx.configDir,
      expect.stringContaining('Important decision: use TypeScript'),
    );

    // Appended to daily log
    expect(manager.appendTodaySync).toHaveBeenCalledWith(
      mockCtx.configDir,
      expect.stringContaining('Important decision: use TypeScript'),
    );

    // Index rebuilt
    expect(mockCtx.backend.rebuildIndex).toHaveBeenCalled();
  });

  it('truncates preview to 100 chars for long content', async () => {
    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[1]?.(api);
    const tool = findTool(api, 'memory_write');

    const longContent = 'A'.repeat(250);
    const result = await tool.execute('id', { content: longContent });

    // Response text should contain 100-char preview
    expect(result.content[0].text).toContain('A'.repeat(100));
    expect(result.content[0].text).toContain('...');
    // Should NOT contain the full content or characters beyond 100
    expect(result.content[0].text).not.toContain('A'.repeat(101));
  });

  it('uses default section when none provided', async () => {
    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[1]?.(api);
    const tool = findTool(api, 'memory_write');

    await tool.execute('id', { content: 'default section content' });

    expect(manager.appendMemorySync).toHaveBeenCalledWith(mockCtx.configDir, expect.stringContaining('### general'));
  });

  it('handles optional section parameter', async () => {
    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[1]?.(api);
    const tool = findTool(api, 'memory_write');

    await tool.execute('id', { content: 'sectioned content', section: 'decisions' });

    expect(manager.appendMemorySync).toHaveBeenCalledWith(mockCtx.configDir, expect.stringContaining('### decisions'));
    expect(manager.appendTodaySync).toHaveBeenCalledWith(
      mockCtx.configDir,
      expect.stringContaining('decisions: sectioned content'),
    );
  });
});

describe('memory_read extension', () => {
  let mockCtx: MemoryContext;

  beforeEach(() => {
    mockCtx = createMockMemoryContext();
    createExtensionFactories(mockCtx);
  });

  it('registers tool with correct name, label, and description', () => {
    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[2]?.(api);

    const tool = findTool(api, 'memory_read');
    expect(tool.name).toBe('memory_read');
    expect(tool.label).toContain('Read from memory');
    expect(tool.description).toContain('knowledge base');
  });

  it('returns search results when backend.search returns matches', async () => {
    mockCtx.backend.search = vi
      .fn()
      .mockResolvedValue([{ filePath: 'memory/MEMORY.md', score: 0.85, snippet: 'TypeScript decision' }]);

    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[2]?.(api);
    const tool = findTool(api, 'memory_read');

    const result = await tool.execute('id', { query: 'TypeScript' });

    expect(result.content[0].text).toContain('Memory search results');
    expect(result.content[0].text).toContain('TypeScript decision');
    expect(result.content[0].text).toContain('score: 0.85');
    // Should NOT fall through to full-memory path
    expect(result.content[0].text).not.toContain('Full memory');
  });

  it('formats multiple search results', async () => {
    mockCtx.backend.search = vi.fn().mockResolvedValue([
      { filePath: 'memory/MEMORY.md', score: 0.9, snippet: 'First result' },
      { filePath: 'memory/daily/2026-05-22.md', score: 0.6, snippet: 'Second result' },
    ]);

    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[2]?.(api);
    const tool = findTool(api, 'memory_read');

    const result = await tool.execute('id', { query: 'test' });

    expect(result.content[0].text).toContain('First result');
    expect(result.content[0].text).toContain('Second result');
  });

  it('falls back to full MEMORY.md when search is empty', async () => {
    mockCtx.backend.search = vi.fn().mockResolvedValue([]);
    const fullContent = 'Full memory content from MEMORY.md';
    vi.mocked(manager.readMemorySync).mockReturnValue(fullContent);

    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[2]?.(api);
    const tool = findTool(api, 'memory_read');

    const result = await tool.execute('id', { query: 'something' });

    expect(result.content[0].text).toContain('Full memory');
    expect(result.content[0].text).toContain(fullContent);
  });

  it('truncates full memory when longer than 2000 chars', async () => {
    mockCtx.backend.search = vi.fn().mockResolvedValue([]);
    const longContent = 'X'.repeat(2500);
    vi.mocked(manager.readMemorySync).mockReturnValue(longContent);

    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[2]?.(api);
    const tool = findTool(api, 'memory_read');

    const result = await tool.execute('id', { query: 'long' });

    expect(result.content[0].text).toContain('(truncated)');
    expect(result.content[0].text).toContain('…');
    expect(result.content[0].text).toContain('X'.repeat(2000));
    // Should NOT contain character 2001+
    expect(result.content[0].text).not.toContain('X'.repeat(2001));
  });

  it('returns no-entries message when both search and full memory are empty', async () => {
    mockCtx.backend.search = vi.fn().mockResolvedValue([]);
    vi.mocked(manager.readMemorySync).mockReturnValue('');

    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[2]?.(api);
    const tool = findTool(api, 'memory_read');

    const result = await tool.execute('id', { query: 'nothing' });

    expect(result.content[0].text).toContain('No entries found');
    expect(result.content[0].text).toContain('nothing');
  });
});

describe('scratchpad extension', () => {
  let mockCtx: MemoryContext;

  beforeEach(() => {
    mockCtx = createMockMemoryContext();
    createExtensionFactories(mockCtx);
  });

  it('registers tool with correct name, label, and description', () => {
    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[3]?.(api);

    const tool = findTool(api, 'scratchpad');
    expect(tool.name).toBe('scratchpad');
    expect(tool.label).toContain('Scratchpad');
    expect(tool.description).toContain('checklist');
  });

  describe('list action', () => {
    it('shows open items when some exist', async () => {
      vi.mocked(manager.readScratchpadSync).mockReturnValue('- [ ] task 1\n- [x] done task\n- [ ] task 2\n');

      const api = createMockAPI();
      const factories = createExtensionFactories();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'list' });

      expect(result.content[0].text).toContain('Open scratchpad items');
      expect(result.content[0].text).toContain('task 1');
      expect(result.content[0].text).toContain('task 2');
      // Done items should NOT appear
      expect(result.content[0].text).not.toContain('done task');
    });

    it('shows empty message when all items are done', async () => {
      vi.mocked(manager.readScratchpadSync).mockReturnValue('- [x] done task\n');

      const api = createMockAPI();
      const factories = createExtensionFactories();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'list' });

      expect(result.content[0].text).toContain('Scratchpad is empty');
    });

    it('shows empty message when scratchpad file is empty', async () => {
      vi.mocked(manager.readScratchpadSync).mockReturnValue('');

      const api = createMockAPI();
      const factories = createExtensionFactories();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'list' });

      expect(result.content[0].text).toContain('Scratchpad is empty');
    });
  });

  describe('add action', () => {
    it('adds item at front and writes to file', async () => {
      vi.mocked(manager.readScratchpadSync).mockReturnValue('- [ ] existing\n');

      const api = createMockAPI();
      const factories = createExtensionFactories();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'add', item: 'new item' });

      expect(result.content[0].text).toBe('[Scratchpad] Added: "new item"');
      expect(manager.writeScratchpadSync).toHaveBeenCalledWith(mockCtx.configDir, expect.any(String));

      const written = vi.mocked(manager.writeScratchpadSync).mock.calls[0]?.[1] as string;
      const lines = written.trim().split('\n');
      expect(lines[0]).toMatch(/^- \[ \] new item/);
      expect(lines[1]).toMatch(/^- \[ \] existing/);
    });

    it('returns error when item is not provided', async () => {
      const api = createMockAPI();
      const factories = createExtensionFactories();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'add' });

      expect(result.content[0].text).toBe('[Scratchpad] Please provide an item text.');
      expect(manager.writeScratchpadSync).not.toHaveBeenCalled();
    });
  });

  describe('done action', () => {
    it('marks matching item as done and writes to file', async () => {
      vi.mocked(manager.readScratchpadSync).mockReturnValue('- [ ] item1\n- [ ] item2\n');

      const api = createMockAPI();
      const factories = createExtensionFactories();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'done', item: 'item1' });

      expect(result.content[0].text).toBe('[Scratchpad] Marked done: "item1"');
      expect(manager.writeScratchpadSync).toHaveBeenCalled();

      const written = vi.mocked(manager.writeScratchpadSync).mock.calls[0]?.[1] as string;
      const lines = written.trim().split('\n');
      expect(lines[0]).toMatch(/^- \[x\] item1/);
      expect(lines[1]).toMatch(/^- \[ \] item2/);
    });

    it('returns error when item is not provided', async () => {
      const api = createMockAPI();
      const factories = createExtensionFactories();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'done' });

      expect(result.content[0].text).toBe('[Scratchpad] Please provide the item text to mark as done.');
      expect(manager.writeScratchpadSync).not.toHaveBeenCalled();
    });

    it('returns not-found for non-existent item', async () => {
      vi.mocked(manager.readScratchpadSync).mockReturnValue('- [ ] item1\n');

      const api = createMockAPI();
      const factories = createExtensionFactories();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'done', item: 'nonexistent' });

      expect(result.content[0].text).toContain('Item not found');
      expect(result.content[0].text).toContain('nonexistent');
      expect(manager.writeScratchpadSync).not.toHaveBeenCalled();
    });
  });

  describe('clear_done action', () => {
    it('removes completed items and writes to file', async () => {
      vi.mocked(manager.readScratchpadSync).mockReturnValue('- [x] done item\n- [ ] open item\n- [x] another done\n');

      const api = createMockAPI();
      const factories = createExtensionFactories();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'clear_done' });

      expect(result.content[0].text).toBe('[Scratchpad] Cleared completed items.');
      expect(manager.writeScratchpadSync).toHaveBeenCalled();

      const written = vi.mocked(manager.writeScratchpadSync).mock.calls[0]?.[1] as string;
      expect(written).toContain('open item');
      expect(written).not.toContain('done item');
      expect(written).not.toContain('another done');
    });
  });

  describe('unknown action', () => {
    it('returns error message', async () => {
      const api = createMockAPI();
      const factories = createExtensionFactories();
      factories[3]?.(api);
      const tool = findTool(api, 'scratchpad');

      const result = await tool.execute('id', { action: 'invalid' });

      expect(result.content[0].text).toContain('Unknown action');
      expect(result.content[0].text).toContain('invalid');
      expect(manager.writeScratchpadSync).not.toHaveBeenCalled();
    });
  });
});

describe('memory_search extension', () => {
  let mockCtx: MemoryContext;

  beforeEach(() => {
    mockCtx = createMockMemoryContext();
    createExtensionFactories(mockCtx);
  });

  it('registers tool with correct name, label, and description', () => {
    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[4]?.(api);

    const tool = findTool(api, 'memory_search');
    expect(tool.name).toBe('memory_search');
    expect(tool.label).toContain('Search memory');
    expect(tool.description).toContain('BM25');
  });

  it('returns formatted results from backend.search', async () => {
    mockCtx.backend.search = vi.fn().mockResolvedValue([
      { filePath: 'memory/MEMORY.md', score: 0.92, snippet: 'Important fact about project' },
      { filePath: 'memory/daily/2026-05-22.md', score: 0.45, snippet: 'Working on feature X' },
    ]);

    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[4]?.(api);
    const tool = findTool(api, 'memory_search');

    const result = await tool.execute('id', { query: 'project' });

    expect(result.content[0].text).toContain('search results');
    expect(result.content[0].text).toContain('project');
    expect(result.content[0].text).toContain('MEMORY.md');
    expect(result.content[0].text).toContain('score: 0.92');
    expect(result.content[0].text).toContain('Important fact');
    expect(result.content[0].text).toContain('Working on feature X');
  });

  it('returns no-results message when backend.search returns empty', async () => {
    mockCtx.backend.search = vi.fn().mockResolvedValue([]);

    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[4]?.(api);
    const tool = findTool(api, 'memory_search');

    const result = await tool.execute('id', { query: 'nonexistent' });

    expect(result.content[0].text).toBe('[Memory Search] No results found for "nonexistent".');
  });

  it('respects max_results parameter', async () => {
    mockCtx.backend.search = vi.fn().mockResolvedValue([]);

    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[4]?.(api);
    const tool = findTool(api, 'memory_search');

    await tool.execute('id', { query: 'test', max_results: 10 });

    expect(mockCtx.backend.search).toHaveBeenCalledWith('test', 10);
  });

  it('defaults max_results to 5 when not provided', async () => {
    mockCtx.backend.search = vi.fn().mockResolvedValue([]);

    const api = createMockAPI();
    const factories = createExtensionFactories();
    factories[4]?.(api);
    const tool = findTool(api, 'memory_search');

    await tool.execute('id', { query: 'test' });

    expect(mockCtx.backend.search).toHaveBeenCalledWith('test', 5);
  });
});
