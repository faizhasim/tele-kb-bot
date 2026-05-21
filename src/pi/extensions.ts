/**
 * Compiled-in extension factories for tele-kb-bot.
 *
 * These extensions are compiled into the binary (not loaded from filesystem):
 * - `telegram_attach` — Queues file paths for sending as Telegram attachments
 * - Memory tools — `memory_write`, `memory_read`, `scratchpad`, `memory_search`
 *
 * @module
 */

import type { ExtensionAPI, ExtensionFactory } from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';
import type { MemoryContext } from '../memory/interface';
import {
  appendMemorySync,
  appendTodaySync,
  readMemorySync,
  readScratchpadSync,
  writeScratchpadSync,
} from '../memory/manager';
import { addItem, clearDone, openItems, parseScratchpad, renderScratchpad } from '../memory/scratchpad';
import type { ScratchpadItem } from '../memory/types';

// Module-level memory context, set by createExtensionFactories
let _memoryCtx: MemoryContext | null = null;

// ─── Telegram Attach Tool ────────────────────────────────────────────

const telegramAttachSchema = Type.Object({
  file_paths: Type.Array(Type.String(), {
    description: 'File paths to attach to the Telegram reply',
  }),
  caption: Type.Optional(Type.String({ description: 'Optional caption for the files' })),
});

function createTelegramAttachExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'telegram_attach',
      label: 'Attach files to Telegram',
      description:
        'Queue file paths to be sent as Telegram attachments (documents, photos, etc.) after the response is complete. ' +
        'Use this when the user requests files that exist in the workspace.',
      parameters: telegramAttachSchema,
      execute(_toolCallId: string, params: { file_paths: string[]; caption?: string }) {
        const fileList = params.file_paths.map((p) => `- ${p}`).join('\n');
        const caption = params.caption ? `\nCaption: ${params.caption}` : '';
        return Promise.resolve({
          content: [
            {
              type: 'text' as const,
              text: `Queued ${params.file_paths.length} file(s) for Telegram attachment:\n${fileList}${caption}\n\nFiles will be sent after the response is complete.`,
            },
          ],
          details: undefined,
        });
      },
    });
  };
}

// ─── Memory Tools ────────────────────────────────────────────────────

function createMemoryWriteExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const memoryWriteSchema = Type.Object({
      content: Type.String({ description: 'Content to write to memory' }),
      section: Type.Optional(
        Type.String({
          description: "Optional section name (e.g., 'decisions', 'notes')",
        }),
      ),
    });

    pi.registerTool({
      name: 'memory_write',
      label: 'Write to memory',
      description:
        'Write important information to the knowledge base for future reference. ' +
        'Use this to save decisions, facts, or context that should persist across conversations.',
      parameters: memoryWriteSchema,
      async execute(_toolCallId: string, params: { content: string; section?: string }) {
        const ctx = _memoryCtx;
        if (!ctx) {
          return {
            content: [{ type: 'text' as const, text: '[Memory] Not initialised yet.' }],
            details: undefined,
          };
        }

        const section = params.section ?? 'general';
        const entry = `### ${section}\n${params.content}`;
        appendMemorySync(ctx.configDir, entry);
        appendTodaySync(ctx.configDir, `[memory_write] ${section}: ${params.content.substring(0, 100)}`);

        // Rebuild the index so new content is immediately searchable
        await ctx.backend.rebuildIndex().catch(() => {});

        const preview = params.content.substring(0, 100);
        return {
          content: [
            {
              type: 'text' as const,
              text: `[Memory] Stored in section "${section}": ${preview}${params.content.length > 100 ? '...' : ''}`,
            },
          ],
          details: undefined,
        };
      },
    });
  };
}

function createMemoryReadExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const memoryReadSchema = Type.Object({
      query: Type.String({ description: 'Search query or topic' }),
    });

    pi.registerTool({
      name: 'memory_read',
      label: 'Read from memory',
      description: 'Read previously stored information from the knowledge base.',
      parameters: memoryReadSchema,
      async execute(_toolCallId: string, params: { query: string }) {
        const ctx = _memoryCtx;
        if (!ctx) {
          return {
            content: [{ type: 'text' as const, text: '[Memory] Not initialised yet.' }],
            details: undefined,
          };
        }

        // Try search first; fall back to raw MEMORY.md content
        const results = await ctx.backend.search(params.query, 5);
        if (results.length > 0) {
          const lines = results.map((r) => `- **${r.filePath}** (score: ${r.score}): ${r.snippet}`);
          return {
            content: [
              {
                type: 'text' as const,
                text: `### Memory search results for "${params.query}"\n${lines.join('\n')}`,
              },
            ],
            details: undefined,
          };
        }

        const full = readMemorySync(ctx.configDir);
        if (full) {
          const truncated = full.length > 2000 ? `${full.slice(0, 2000)}\n…` : full;
          return {
            content: [
              {
                type: 'text' as const,
                text: `### Full memory (truncated)\n${truncated}`,
              },
            ],
            details: undefined,
          };
        }

        return {
          content: [{ type: 'text' as const, text: `[Memory] No entries found for "${params.query}".` }],
          details: undefined,
        };
      },
    });
  };
}

function createScratchpadExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const scratchpadSchema = Type.Object({
      action: Type.Union(
        [Type.Literal('list'), Type.Literal('add'), Type.Literal('done'), Type.Literal('clear_done')],
        { description: 'Scratchpad action' },
      ),
      item: Type.Optional(Type.String({ description: 'Item text (for add/done actions)' })),
    });

    pi.registerTool({
      name: 'scratchpad',
      label: 'Scratchpad checklist',
      description:
        'Manage a persistent checklist. Actions: list (show all items), add (add new item), ' +
        'done (mark item as complete), clear_done (remove completed items).',
      parameters: scratchpadSchema,
      async execute(_toolCallId: string, params: { action: string; item?: string }) {
        const ctx = _memoryCtx;
        if (!ctx) {
          return {
            content: [{ type: 'text' as const, text: '[Scratchpad] Not initialised yet.' }],
            details: undefined,
          };
        }

        const raw = readScratchpadSync(ctx.configDir);
        let items: Array<ScratchpadItem> = parseScratchpad(raw) as Array<ScratchpadItem>;
        let result = '';

        switch (params.action) {
          case 'list': {
            const open = openItems(items);
            result =
              open.length > 0
                ? `### Open scratchpad items\n${open.map((i) => `- ${i.text}`).join('\n')}`
                : 'Scratchpad is empty.';
            break;
          }
          case 'add': {
            if (!params.item) {
              result = 'Please provide an item text.';
              break;
            }
            items = addItem(items, params.item);
            writeScratchpadSync(ctx.configDir, renderScratchpad(items));
            result = `Added: "${params.item}"`;
            break;
          }
          case 'done': {
            if (!params.item) {
              result = 'Please provide the item text to mark as done.';
              break;
            }
            const idx = items.findIndex((i) => i.text === params.item);
            if (idx === -1) {
              result = `Item not found: "${params.item}". Use "list" to see all items.`;
              break;
            }
            items = [
              ...items.slice(0, idx),
              { ...(items[idx] as ScratchpadItem), done: true },
              ...items.slice(idx + 1),
            ];
            writeScratchpadSync(ctx.configDir, renderScratchpad(items));
            result = `Marked done: "${params.item}"`;
            break;
          }
          case 'clear_done': {
            items = clearDone(items);
            writeScratchpadSync(ctx.configDir, renderScratchpad(items));
            result = 'Cleared completed items.';
            break;
          }
          default: {
            result = `Unknown action: "${params.action}". Valid: list, add, done, clear_done.`;
          }
        }

        return {
          content: [{ type: 'text' as const, text: `[Scratchpad] ${result}` }],
          details: undefined,
        };
      },
    });
  };
}

function createMemorySearchExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const memorySearchSchema = Type.Object({
      query: Type.String({ description: 'Search query' }),
      max_results: Type.Optional(Type.Number({ default: 5, description: 'Maximum results to return' })),
    });

    pi.registerTool({
      name: 'memory_search',
      label: 'Search memory',
      description: 'Search the knowledge base using BM25 keyword search. Returns ranked results with relevance scores.',
      parameters: memorySearchSchema,
      async execute(_toolCallId: string, params: { query: string; max_results?: number }) {
        const ctx = _memoryCtx;
        if (!ctx) {
          return {
            content: [{ type: 'text' as const, text: '[Memory Search] Not initialised yet.' }],
            details: undefined,
          };
        }

        const results = await ctx.backend.search(params.query, params.max_results ?? 5);
        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `[Memory Search] No results found for "${params.query}".`,
              },
            ],
            details: undefined,
          };
        }

        const lines = results.map((r) => `- **${r.filePath}** (score: ${r.score})\n  ${r.snippet}`);

        return {
          content: [
            {
              type: 'text' as const,
              text: `### Memory search results for "${params.query}"\n${lines.join('\n')}`,
            },
          ],
          details: undefined,
        };
      },
    });
  };
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Create all extension factories for the compiled-in extensions.
 *
 * @param memoryCtx - Optional memory context to wire memory tools to real backends.
 */
function createExtensionFactories(memoryCtx?: MemoryContext): ExtensionFactory[] {
  if (memoryCtx) {
    _memoryCtx = memoryCtx;
  }
  return [
    createTelegramAttachExtension(),
    createMemoryWriteExtension(),
    createMemoryReadExtension(),
    createScratchpadExtension(),
    createMemorySearchExtension(),
  ];
}

export { createExtensionFactories };
