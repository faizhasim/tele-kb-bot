/**
 * GrammY bot controller for tele-kb-bot.
 *
 * Factory function that wires GrammY long-polling to pi session registry.
 * Handles text/photo/document/voice messages, command dispatch, and streaming.
 *
 * @module
 */

import { Bot, type Context } from 'grammy';
import type { Config } from '../config/schema';
import { createCLILogger } from '../logger';
import { buildMemoryContext } from '../memory/context';
import type { MemoryContext } from '../memory/interface';
import { readMemorySync, readScratchpadSync } from '../memory/manager';
import { splitIntoChunks } from '../telegram/chunking';
import type { SessionRegistry } from './session-registry';

interface BotController {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

const isAllowed = (ctx: Context, config: Config): boolean => {
  const userId = ctx.from?.id;
  if (!userId) return false;
  return config.telegram.allowed_user_ids.includes(userId);
};

const TYPING_INTERVAL = 4000;

const createBotController = (config: Config, registry: SessionRegistry, memoryCtx?: MemoryContext): BotController => {
  const log = createCLILogger('tele-kb-bot');
  const bot = new Bot(config.telegram.bot_token);
  const typingTimers = new Map<number, ReturnType<typeof setInterval>>();

  const startTyping = (chatId: number): void => {
    if (typingTimers.has(chatId)) return;
    bot.api.sendChatAction(chatId, 'typing').catch((err) => {
      log.debug({ err }, 'Failed to send initial typing indicator');
    });
    const timer = setInterval(() => {
      bot.api.sendChatAction(chatId, 'typing').catch((err) => {
        log.debug({ err }, 'Failed to send typing indicator');
      });
    }, TYPING_INTERVAL);
    typingTimers.set(chatId, timer);
  };

  const stopTyping = (chatId: number): void => {
    const timer = typingTimers.get(chatId);
    if (timer) {
      clearInterval(timer);
      typingTimers.delete(chatId);
    }
  };

  const sendChunked = async (chatId: number, text: string): Promise<void> => {
    const chunks = splitIntoChunks(text);
    for (const chunk of chunks) {
      try {
        await bot.api.sendMessage(chatId, chunk, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      } catch (err) {
        // HTML parsing failed — strip tags, retry as plain text
        log.warn({ err: String(err) }, 'HTML send failed, falling back to plain text');
        const plain = chunk.replace(/<[^>]*>/g, '').trim();
        await bot.api.sendMessage(chatId, plain || '(empty response)', {
          link_preview_options: { is_disabled: true },
        });
      }
    }
  };

  const handleMessage = async (ctx: Context): Promise<void> => {
    if (!isAllowed(ctx, config)) return;
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const text = ctx.message?.text ?? ctx.message?.caption ?? '';

    startTyping(chatId);

    try {
      const session = await registry.getOrCreate(chatId);

      const RESPONSE_TIMEOUT = 120_000;

      // Abort the session if prompt takes too long
      const sessionTimeout = setTimeout(() => session.abort(), RESPONSE_TIMEOUT);

      // Create a promise that resolves with the assistant response text
      const responsePromise = new Promise<string>((resolve) => {
        const timeout = setTimeout(() => resolve(''), RESPONSE_TIMEOUT);
        const unsub = session.subscribe((event) => {
          if (event.type === 'agent_end') {
            clearTimeout(timeout);
            unsub();
            const msgs: Array<Record<string, unknown>> = (event as Record<string, unknown>).messages as Array<
              Record<string, unknown>
            >;
            // Find the last assistant message — iterate backwards
            const lastAssistant = msgs.toReversed().find((m) => m.role === 'assistant');
            if (lastAssistant) {
              const content = lastAssistant.content;
              const parts = Array.isArray(content)
                ? (content as Array<Record<string, unknown>>)
                    .filter((c) => c.type === 'text')
                    .map((c) => (typeof c.text === 'string' ? c.text : ''))
                : [];
              const text = parts.join('\n');
              if (text) {
                resolve(text);
                return;
              }
            }
            resolve('');
          }
        });
      });

      // Build memory context if auto_inject is enabled
      const promptPrefix =
        config.memory.auto_inject && memoryCtx
          ? await (async () => {
              try {
                const searchResults = await memoryCtx.backend.search(text, config.memory.search.max_results);
                const ctxStr = buildMemoryContext({
                  scratchpad: readScratchpadSync(memoryCtx.configDir),
                  searchResults,
                  longTermMemory: readMemorySync(memoryCtx.configDir),
                });
                return ctxStr ? `${ctxStr}\n\n---\n\n` : '';
              } catch {
                return '';
              }
            })()
          : '';

      const fullPrompt = promptPrefix ? `${promptPrefix}[telegram-kb] ${text}` : `[telegram-kb] ${text}`;

      try {
        await session.prompt(fullPrompt);
      } finally {
        clearTimeout(sessionTimeout);
        stopTyping(chatId);
      }

      const responseText = await responsePromise;

      if (responseText) {
        await sendChunked(chatId, responseText);
      } else {
        await bot.api.sendMessage(chatId, 'Done — no text response.');
      }
    } catch (err) {
      stopTyping(chatId);
      log.error({ err, chatId }, 'Error handling message');
      await bot.api.sendMessage(chatId, 'Sorry, an error occurred.').catch(() => {});
    }
  };

  // ─── Handlers ──────────────────────────────────────────────────

  bot.on(':text', async (ctx) => {
    const text = ctx.message?.text ?? '';
    if (text === '/start') {
      if (!isAllowed(ctx, config)) return;
      await ctx.reply("Hello! Send me a message and I'll process it with AI.\n\n/stop — Cancel the current response");
      return;
    }
    if (text === '/stop') {
      registry.abort(ctx.chat.id);
      await ctx.reply('Stopped.');
      return;
    }
    await handleMessage(ctx);
  });

  bot.on(':photo', async (ctx) => {
    if (!isAllowed(ctx, config)) return;
    await handleMessage(ctx);
  });

  bot.on(':document', async (ctx) => {
    if (!isAllowed(ctx, config)) return;
    await handleMessage(ctx);
  });

  bot.on(':voice', async (ctx) => {
    if (!isAllowed(ctx, config)) return;
    await handleMessage(ctx);
  });

  bot.catch((err) => {
    log.error({ err: err.error }, 'GrammY error');
  });

  // ─── Lifecycle ─────────────────────────────────────────────────

  const start = async (): Promise<void> => {
    log.info('Starting GrammY bot polling...');
    bot.start({
      onStart: () => log.info('Bot polling started'),
      drop_pending_updates: true,
    });
  };

  const stop = async (): Promise<void> => {
    for (const timer of typingTimers.values()) clearInterval(timer);
    typingTimers.clear();
    await bot.stop();
    log.info('Bot stopped');
  };

  return { start, stop };
};

export type { BotController };
export { createBotController };
