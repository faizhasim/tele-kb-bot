/**
 * Compiled-in extension factories for tele-kb-bot.
 *
 * These extensions are compiled into the binary (not loaded from filesystem).
 * They are the only tools available to the agent after `noTools: "builtin"`
 * disables the pi SDK's default read/bash/edit/write tools.
 *
 * Available tools (5):
 *
 * - `telegram_attach` — Queue file paths for sending as Telegram attachments
 *   after the agent turn completes. The bot controller reads the queued paths
 *   after prompt() resolves and sends each file via sendDocument.
 *
 * - `memory_write` — Append content to MEMORY.md and today's daily log,
 *   then rebuild the search index so new entries are immediately findable.
 *
 * - `memory_read` — Search the knowledge base via the configured backend
 *   (qmd in persistent mode, BM25 in ephemeral mode). Falls back to raw
 *   MEMORY.md content when search returns nothing.
 *
 * - `scratchpad` — Manage a persistent checklist stored in SCRATCHPAD.md.
 *   Supports list/add/done/clear_done actions.
 *
 * - `memory_search` — Full-text search against the knowledge base backend.
 *   Returns ranked results with file paths, scores, and content snippets.
 *
 * All memory operations (write, read, search, scratchpad) are scoped to
 * `<config_dir>/memory/`. The agent has no filesystem access outside this
 * directory and no shell execution capability.
 *
 * @module
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

// ─── Obsidian URI Helper ────────────────────────────────────────────

const QMD_URI_RE = /^qmd:\/\/([^/]+)\/(.+)$/;

/**
 * qmd normalizes dots and other special characters in directory names to
 * hyphens (e.g. `20.20-sejati` → `20-20-sejati`).  This helper resolves
 * each path segment against the real filesystem, trying exact match first
 * and then a fuzzy match that treats hyphens in the qmd path as wildcards
 * for dots or hyphens.
 *
 * Returns the real filesystem path, or the unresolved path as fallback.
 */
const resolveQmdToRealPath = (vaultDir: string, qmdRelativePath: string): string => {
  const segments = qmdRelativePath.split('/');
  let current = vaultDir.replace(/\/+$/, '');

  for (const segment of segments) {
    if (!segment) continue;
    const exact = join(current, segment);
    if (existsSync(exact)) {
      current = exact;
      continue;
    }
    // Fuzzy match: each hyphen/dot in the segment can be a dot OR a hyphen
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      const pattern = segment.replace(/[-.]/g, '[-.]');
      const re = new RegExp(`^${pattern}$`);
      const match = entries.find((e) => (e.isFile() || e.isDirectory() ? re.test(e.name) : false));
      if (match) {
        current = join(current, match.name);
        continue;
      }
    } catch {
      // unreadable directory — fall through
    }
    // Fallback: use qmd's path segment unchanged
    current = exact;
  }
  return current;
};

/**
 * Given a file path (absolute filesystem path or qmd:// URI) and the
 * configured vault directories, compute a working Obsidian URI.
 *
 * Returns null when the file is not under any known vault directory.
 */
const formatObsidianUri = (filePath: string, vaultDirectories: ReadonlyArray<string>): string | null => {
  // --- Handle qmd:// URIs ---
  const qmdMatch = filePath.match(QMD_URI_RE);
  if (qmdMatch) {
    const [, collectionName, qmdRelPath] = qmdMatch;
    for (const vaultDir of vaultDirectories) {
      const normDir = vaultDir.replace(/\/+$/, '');
      const dirName = normDir.split('/').pop();
      if (dirName === collectionName) {
        const realPath = resolveQmdToRealPath(normDir, qmdRelPath);
        const vaultName = dirName;
        const relativePath = realPath.startsWith(`${normDir}/`) ? realPath.slice(normDir.length + 1) : qmdRelPath;
        const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
        return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodedPath}`;
      }
    }
    return null;
  }

  // --- Handle absolute filesystem paths ---
  for (const vaultDir of vaultDirectories) {
    const normDir = vaultDir.replace(/\/+$/, '');
    if (filePath.startsWith(`${normDir}/`)) {
      const vaultName = normDir.split('/').pop() ?? 'vault';
      const relativePath = filePath.slice(normDir.length + 1);
      const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
      return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodedPath}`;
    }
  }
  return null;
};

// Module-level memory context, set by createExtensionFactories
let _memoryCtx: MemoryContext | null = null;

// ─── Telegram Attach Tool ────────────────────────────────────────────

const telegramAttachSchema = Type.Object({
  file_paths: Type.Array(Type.String(), {
    description: 'File paths to attach to the Telegram reply',
  }),
  caption: Type.Optional(Type.String({ description: 'Optional caption for the files' })),
});

/**
 * Create the `telegram_attach` extension factory.
 *
 * Registers a tool that queues file paths to be sent as Telegram attachments
 * after the agent completes its response. The bot controller reads file paths
 * from the assistant's output and processes each as a sendDocument API call.
 *
 * File paths must be absolute and readable by the bot process. Typical sources
 * are files discovered in vault directories during memory_search results.
 *
 * The caption is optional and appears as the message text above the attachment.
 */
const createTelegramAttachExtension = (): ExtensionFactory => {
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
        });
      },
    });
  };
};

// ─── Memory Tools ────────────────────────────────────────────────────

/**
 * Create the `memory_write` extension factory.
 *
 * Registers a tool that appends content to MEMORY.md under an optional section
 * heading, records a summary line in today's daily log, and triggers a search
 * index rebuild so the new content is immediately findable by memory_search
 * and memory_read.
 *
 * The write is scoped to `<config_dir>/memory/`. The agent cannot write
 * anywhere else on the filesystem.
 *
 * Index rebuild failures are silently swallowed — the content is persisted
 * regardless; it just won't appear in search results until the next rebuild.
 */
const createMemoryWriteExtension = (): ExtensionFactory => {
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
        };
      },
    });
  };
};

/**
 * Create the `memory_read` extension factory.
 *
 * Registers a tool that searches the knowledge base via the configured backend
 * (qmd in persistent mode, BM25 in ephemeral mode). Results are returned as
 * ranked markdown snippets with file paths and relevance scores.
 *
 * If the backend returns no results, falls back to dumping the raw MEMORY.md
 * content (truncated to 2000 chars) so the agent can still see what's stored.
 *
 * Returns a clear "No entries found" message when both search and fallback
 * produce nothing.
 */
const createMemoryReadExtension = (): ExtensionFactory => {
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
          };
        }

        // Try search first; fall back to raw MEMORY.md content
        const results = await ctx.backend.search(params.query, 5);
        if (results.length > 0) {
          const lines = results.map((r) => {
            const uri = formatObsidianUri(r.filePath, ctx.vaultDirectories);
            const uriLine = uri ? `\n  <code>${uri}</code>` : '';
            return `- **${r.filePath}** (score: ${r.score}): ${r.snippet}${uriLine}`;
          });
          return {
            content: [
              {
                type: 'text' as const,
                text: `### Memory search results for "${params.query}"\n${lines.join('\n')}`,
              },
            ],
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
          };
        }

        return {
          content: [{ type: 'text' as const, text: `[Memory] No entries found for "${params.query}".` }],
        };
      },
    });
  };
};

/**
 * Create the `scratchpad` extension factory.
 *
 * Registers a tool for managing a persistent checklist stored as
 * SCRATCHPAD.md in the memory directory. Supports four actions:
 *
 * - `list` — Show all open (unchecked) items
 * - `add` — Append a new item to the checklist
 * - `done` — Mark an existing item as complete by matching its text
 * - `clear_done` — Remove all completed items from the checklist
 *
 * Item matching for `done` uses exact text comparison. The scratchpad file
 * uses markdown checklist syntax (`- [ ]` / `- [x]`).
 */
const createScratchpadExtension = (): ExtensionFactory => {
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
        };
      },
    });
  };
};

/**
 * Create the `memory_search` extension factory.
 *
 * Registers a tool that performs full-text search against the knowledge base
 * backend. In persistent mode, delegates to qmd for semantic/vector/BM25
 * search. In ephemeral mode, uses the built-in BM25 index over markdown files
 * in the memory directory.
 *
 * Returns ranked results with file paths, relevance scores, and content
 * snippets (truncated to 200 chars). Returns a clear "No results" message
 * when the query produces no matches.
 */
const createMemorySearchExtension = (): ExtensionFactory => {
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
          };
        }

        const lines = results.map((r) => {
          const uri = formatObsidianUri(r.filePath, ctx.vaultDirectories);
          const uriLine = uri ? `\n  <code>${uri}</code>` : '';
          return `- **${r.filePath}** (score: ${r.score})\n  ${r.snippet}${uriLine}`;
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `### Memory search results for "${params.query}"\n${lines.join('\n')}`,
            },
          ],
        };
      },
    });
  };
};

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Assemble all compiled-in extension factories.
 *
 * Called once by `createPiSession()` in `session-factory.ts` during service
 * creation. The factories are passed via `resourceLoaderOptions.extensionFactories`
 * so the pi SDK registers them as agent-accessible tools.
 *
 * When `memoryCtx` is provided, all memory-scoped tools (memory_write,
 * memory_read, scratchpad, memory_search) are wired to the real backend.
 * Without it, tools return "[Memory] Not initialised yet." stubs.
 *
 * After ADR-0009, these 5 tools are the agent's only available tools — the pi
 * SDK's default read/bash/edit/write are disabled via `noTools: "builtin"`.
 *
 * @param memoryCtx - Shared memory context with backend + configDir. Pass null
 *                    during testing or early startup to get stub responses.
 */
const createExtensionFactories = (memoryCtx?: MemoryContext): ExtensionFactory[] => {
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
};

export { createExtensionFactories, formatObsidianUri, resolveQmdToRealPath };
