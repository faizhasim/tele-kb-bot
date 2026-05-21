/**
 * Telegram bot client for tele-kb-bot.
 *
 * Function expressions wrapping the Telegram Bot API via fetch().
 * All functions return Effect for composability.
 *
 * @module
 */

import { readFile } from 'node:fs/promises';
import { Data, Effect, pipe } from 'effect';
import { createCLILogger } from '../logger';
import { splitIntoChunks, truncateCaption } from './chunking';

// ─── Constants ───────────────────────────────────────────────────────

const TELEGRAM_API = 'https://api.telegram.org/bot';

// ─── Types ──────────────────────────────────────────────────────────

interface SendResult {
  readonly ok: boolean;
  readonly messageId?: number;
  readonly error?: string;
}

interface VerifyResult {
  readonly ok: boolean;
  readonly botName?: string;
  readonly error?: string;
}

// ─── Tagged Errors ──────────────────────────────────────────────────

class TelegramApiError extends Data.TaggedError('TelegramApiError')<{
  readonly message: string;
  readonly errorCode?: number;
  readonly description?: string;
}> {}

type TelegramError = TelegramApiError;

// ─── Logger ─────────────────────────────────────────────────────────

const log = createCLILogger('telegram-client');

// ─── Internal HTTP Helpers ───────────────────────────────────────────

/**
 * Make a GET request to the Telegram API.
 */
const apiGet = <T>(
  botToken: string,
  method: string,
  params?: Record<string, string | number>,
): Effect.Effect<T, TelegramError> =>
  Effect.tryPromise({
    try: async () => {
      const url = new URL(`${TELEGRAM_API}${botToken}/${method}`);
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          url.searchParams.set(key, String(value));
        }
      }
      const response = await fetch(url.toString());
      const data = (await response.json()) as { ok: boolean; result?: T; description?: string; error_code?: number };

      if (!data.ok) {
        throw new TelegramApiError({
          message: data.description ?? 'Unknown Telegram API error',
          errorCode: data.error_code,
          description: data.description,
        });
      }

      return data.result as T;
    },
    catch: (err) =>
      err instanceof TelegramApiError
        ? err
        : new TelegramApiError({
            message: `Telegram API request failed: ${err instanceof Error ? err.message : String(err)}`,
          }),
  });

/**
 * Make a POST request with JSON body to the Telegram API.
 */
const apiPostJson = <T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Effect.Effect<T, TelegramError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${TELEGRAM_API}${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { ok: boolean; result?: T; description?: string; error_code?: number };

      if (!data.ok) {
        throw new TelegramApiError({
          message: data.description ?? 'Unknown Telegram API error',
          errorCode: data.error_code,
          description: data.description,
        });
      }

      return data.result as T;
    },
    catch: (err) =>
      err instanceof TelegramApiError
        ? err
        : new TelegramApiError({
            message: `Telegram API POST failed: ${err instanceof Error ? err.message : String(err)}`,
          }),
  });

/**
 * Make a POST request with multipart form data to the Telegram API.
 * Reads the file from disk using FileSystem service.
 */
const apiPostMultipart = <T>(
  botToken: string,
  method: string,
  fields: Record<string, string | Blob>,
): Effect.Effect<T, TelegramError> =>
  Effect.tryPromise({
    try: async () => {
      const formData = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, value);
      }

      const response = await fetch(`${TELEGRAM_API}${botToken}/${method}`, {
        method: 'POST',
        body: formData,
      });
      const data = (await response.json()) as { ok: boolean; result?: T; description?: string; error_code?: number };

      if (!data.ok) {
        throw new TelegramApiError({
          message: data.description ?? 'Unknown Telegram API error',
          errorCode: data.error_code,
          description: data.description,
        });
      }

      return data.result as T;
    },
    catch: (err) =>
      err instanceof TelegramApiError
        ? err
        : new TelegramApiError({
            message: `Telegram API multipart POST failed: ${err instanceof Error ? err.message : String(err)}`,
          }),
  });

// ─── Message Types ───────────────────────────────────────────────────

interface TelegramMessage {
  readonly message_id: number;
  readonly text?: string;
  readonly chat: { readonly id: number };
}

interface TelegramUser {
  readonly id: number;
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly username?: string;
}

// ─── Send Text ───────────────────────────────────────────────────────

/**
 * Send a text message to a Telegram chat.
 * Automatically splits long text into multiple chunks.
 * Returns the last SendResult (typically the one that matters most).
 */
const sendText = (
  botToken: string,
  chatId: number,
  text: string,
  options?: {
    readonly replyToMessageId?: number;
    readonly disablePreview?: boolean;
  },
): Effect.Effect<SendResult, TelegramError> => {
  const chunks = splitIntoChunks(text).filter((c) => c.length > 0);

  if (chunks.length === 0) {
    return Effect.succeed({ ok: true });
  }

  const sendOneChunk = (chunk: string, index: number): Effect.Effect<TelegramMessage, TelegramError> => {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: chunk,
    };
    if (options?.replyToMessageId && index === 0) {
      body.reply_parameters = { message_id: options.replyToMessageId };
    }
    if (options?.disablePreview) {
      body.link_preview_options = { is_disabled: true };
    }
    return apiPostJson<TelegramMessage>(botToken, 'sendMessage', body);
  };

  return pipe(
    Effect.all(chunks.map((chunk, i) => sendOneChunk(chunk, i))),
    Effect.map((messages) => {
      const last = messages[messages.length - 1];
      if (!last) return { ok: false, error: 'No messages sent' };
      return { ok: true, messageId: last.message_id };
    }),
    Effect.catchAll((err) => {
      log.error({ err, chatId }, 'sendText failed');
      return Effect.succeed({ ok: false, error: err.message } as SendResult);
    }),
  );
};

// ─── Send Document ───────────────────────────────────────────────────

/**
 * Send a file as a document to a Telegram chat.
 * Reads the file from disk using the FileSystem service.
 */
const sendDocument = (
  botToken: string,
  chatId: number,
  filePath: string,
  caption?: string,
  options?: { readonly replyToMessageId?: number },
): Effect.Effect<SendResult, never> =>
  pipe(
    Effect.tryPromise({
      try: () => readFile(filePath),
      catch: (e) =>
        new TelegramApiError({
          message: `Failed to read file ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
        }),
    }),
    Effect.map((fileBuffer) => {
      const blob = new Blob([fileBuffer]);
      const fields: Record<string, string | Blob> = {
        chat_id: String(chatId),
        document: blob,
      };
      if (caption) fields.caption = truncateCaption(caption);
      if (options?.replyToMessageId) {
        fields.reply_parameters = JSON.stringify({ message_id: options.replyToMessageId });
      }
      return fields;
    }),
    Effect.flatMap((fields) => apiPostMultipart<TelegramMessage>(botToken, 'sendDocument', fields)),
    Effect.map((msg) => ({ ok: true, messageId: msg.message_id }) as SendResult),
    Effect.catchAll((err) => {
      log.error({ err, chatId, filePath }, 'sendDocument failed');
      return Effect.succeed({ ok: false, error: err.message } as SendResult);
    }),
  );

// ─── Send Chat Action ────────────────────────────────────────────────

type ChatAction =
  | 'typing'
  | 'upload_document'
  | 'upload_photo'
  | 'record_video'
  | 'upload_video'
  | 'record_voice'
  | 'upload_voice';

/**
 * Send a chat action (typing indicator, upload status, etc.).
 * Silently fails — chat actions are best-effort.
 */
const sendChatAction = (botToken: string, chatId: number, action: ChatAction = 'typing'): Effect.Effect<void> =>
  pipe(
    apiPostJson<boolean>(botToken, 'sendChatAction', {
      chat_id: chatId,
      action,
    }),
    Effect.as(undefined),
    Effect.catchAll((err) => {
      log.debug({ err, chatId, action }, 'Failed to send chat action (best-effort)');
      return Effect.void;
    }),
  );

// ─── Verify Token ────────────────────────────────────────────────────

/**
 * Verify the bot token by calling the Telegram getMe API.
 */
const verifyToken = (botToken: string): Effect.Effect<VerifyResult, never> =>
  pipe(
    apiGet<TelegramUser>(botToken, 'getMe'),
    Effect.map((user) => ({ ok: true, botName: user.first_name })),
    Effect.catchAll((err) => Effect.succeed({ ok: false, error: err.message } as VerifyResult)),
  );

// ─── Backward-Compatible Type (temporary bridge) ─────────────────────

/**
 * @deprecated Use the exported function expressions directly.
 * This type is a bridge for the daemon modules that haven't been refactored yet.
 */
interface TelegramClient {
  readonly botToken: string;
  readonly sendText: (
    chatId: number,
    text: string,
    options?: { readonly replyToMessageId?: number; readonly disablePreview?: boolean },
  ) => Effect.Effect<SendResult, TelegramError>;
  readonly sendDocument: (
    chatId: number,
    filePath: string,
    caption?: string,
    options?: { readonly replyToMessageId?: number },
  ) => Effect.Effect<SendResult, never>;
  readonly sendChatAction: (chatId: number, action?: ChatAction) => Effect.Effect<void>;
  readonly verifyToken: () => Effect.Effect<VerifyResult, never>;
}

/**
 * Create a TelegramClient wrapper with a bound bot token.
 * @deprecated Use the exported function expressions directly.
 */
const createTelegramClient = (botToken: string): TelegramClient => ({
  botToken,
  sendText: (chatId, text, opts) => sendText(botToken, chatId, text, opts),
  sendDocument: (chatId, filePath, caption, opts) => sendDocument(botToken, chatId, filePath, caption, opts),
  sendChatAction: (chatId, action) => sendChatAction(botToken, chatId, action),
  verifyToken: () => verifyToken(botToken),
});

// ─── Exports ─────────────────────────────────────────────────────────

export type { ChatAction, SendResult, TelegramClient, TelegramError, VerifyResult };
export { createTelegramClient, sendChatAction, sendDocument, sendText, verifyToken };
