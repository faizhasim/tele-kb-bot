/**
 * Compiled-in extension factories for tele-kb-bot.
 *
 * These extensions are compiled into the binary (not loaded from filesystem):
 * - `telegram_attach` — Queues file paths for sending as Telegram attachments
 * - Memory tools — `memory_write`, `memory_read`, `scratchpad`, `memory_search`
 *
 * @module
 */

import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

// ─── Telegram Attach Tool ────────────────────────────────────────────

const telegramAttachSchema = Type.Object({
  file_paths: Type.Array(Type.String(), {
    description: "File paths to attach to the Telegram reply",
  }),
  caption: Type.Optional(Type.String({ description: "Optional caption for the files" })),
});

/**
 * Create the telegram_attach extension factory.
 * Registers a tool that queues file paths for Telegram attachment.
 */
export function createTelegramAttachExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "telegram_attach",
      label: "Attach files to Telegram",
      description:
        "Queue file paths to be sent as Telegram attachments (documents, photos, etc.) after the response is complete. " +
        "Use this when the user requests files that exist in the workspace.",
      parameters: telegramAttachSchema,
      execute(_toolCallId: string, params: { file_paths: string[]; caption?: string }) {
        const fileList = params.file_paths.map((p) => `- ${p}`).join("\n");
        const caption = params.caption ? `\nCaption: ${params.caption}` : "";
        return Promise.resolve({
          content: [
            {
              type: "text" as const,
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

/**
 * Create memory stubs extension factories.
 *
 * These are placeholder implementations for v1. When the memory module
 * (src/memory/) is implemented, these stubs will delegate to the real
 * memory manager, BM25 search, and scratchpad implementations.
 */
export function createMemoryStubExtensions(): ExtensionFactory[] {
  return [
    (pi: ExtensionAPI) => {
      const memoryWriteSchema = Type.Object({
        content: Type.String({ description: "Content to write to memory" }),
        section: Type.Optional(
          Type.String({
            description: "Optional section name (e.g., 'decisions', 'notes')",
          }),
        ),
      });

      pi.registerTool({
        name: "memory_write",
        label: "Write to memory",
        description:
          "Write important information to the knowledge base for future reference. " +
          "Use this to save decisions, facts, or context that should persist across conversations.",
        parameters: memoryWriteSchema,
        execute(_toolCallId: string, params: { content: string; section?: string }) {
          const section = params.section ?? "general";
          const preview = params.content.substring(0, 100);
          return Promise.resolve({
            content: [
              {
                type: "text" as const,
                text: `[Memory] Stored in section "${section}": ${preview}${params.content.length > 100 ? "..." : ""}`,
              },
            ],
            details: undefined,
          });
        },
      });
    },
    (pi: ExtensionAPI) => {
      const memoryReadSchema = Type.Object({
        query: Type.String({ description: "Search query or topic" }),
      });

      pi.registerTool({
        name: "memory_read",
        label: "Read from memory",
        description: "Read previously stored information from the knowledge base.",
        parameters: memoryReadSchema,
        execute(_toolCallId: string, params: { query: string }) {
          return Promise.resolve({
            content: [
              {
                type: "text" as const,
                text: `[Memory] No entries found for "${params.query}" — memory system is being initialized.`,
              },
            ],
            details: undefined,
          });
        },
      });
    },
    (pi: ExtensionAPI) => {
      const scratchpadSchema = Type.Object({
        action: Type.Union(
          [Type.Literal("list"), Type.Literal("add"), Type.Literal("done"), Type.Literal("clear_done")],
          { description: "Scratchpad action" },
        ),
        item: Type.Optional(Type.String({ description: "Item text (for add/done actions)" })),
      });

      pi.registerTool({
        name: "scratchpad",
        label: "Scratchpad checklist",
        description:
          "Manage a persistent checklist. Actions: list (show all items), add (add new item), " +
          "done (mark item as complete), clear_done (remove completed items).",
        parameters: scratchpadSchema,
        execute(_toolCallId: string, params: { action: string; item?: string }) {
          return Promise.resolve({
            content: [
              {
                type: "text" as const,
                text: `[Scratchpad] Action "${params.action}" received${params.item ? ` for "${params.item}"` : ""}. Scratchpad system is being initialized.`,
              },
            ],
            details: undefined,
          });
        },
      });
    },
    (pi: ExtensionAPI) => {
      const memorySearchSchema = Type.Object({
        query: Type.String({ description: "Search query" }),
        max_results: Type.Optional(Type.Number({ default: 5, description: "Maximum results to return" })),
      });

      pi.registerTool({
        name: "memory_search",
        label: "Search memory",
        description:
          "Search the knowledge base using BM25 keyword search. Returns ranked results with relevance scores.",
        parameters: memorySearchSchema,
        execute(_toolCallId: string, params: { query: string; max_results?: number }) {
          return Promise.resolve({
            content: [
              {
                type: "text" as const,
                text: `[Memory Search] No results found for "${params.query}" (max: ${params.max_results ?? 5}) — search index is being initialized.`,
              },
            ],
            details: undefined,
          });
        },
      });
    },
  ];
}

/**
 * Create all extension factories for the compiled-in extensions.
 */
export function createExtensionFactories(): ExtensionFactory[] {
  return [createTelegramAttachExtension(), ...createMemoryStubExtensions()];
}
