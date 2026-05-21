/**
 * Telegram message handler for tele-kb-bot.
 *
 * Converts incoming Telegram messages into pi session prompts,
 * filters by allowed users, and handles media downloading.
 *
 * @module
 */

import { mkdirSync } from "node:fs";
import type { Config } from "../config/schema";
import type { SessionRegistry } from "../daemon/session-registry";
import { getLogger } from "../logger";
import type { TelegramClient } from "./client";
import { cleanupFile, downloadTelegramFile } from "./media";
import { startStreaming } from "./streaming";
import type { IncomingMessage } from "./types";

export interface HandlerOptions {
  config: Config;
  configDir: string;
  client: TelegramClient;
  sessionRegistry?: SessionRegistry;

  /** Called when the session generates a response text fragment */
  onResponseFragment?: (chatId: number, text: string) => void;

  /** Called when the session completes a response */
  onResponseComplete?: (chatId: number, text: string) => void;
}

/**
 * Process an incoming Telegram message.
 *
 * Steps:
 * 1. Check if user is allowed
 * 2. Download media files if present
 * 3. Build pi session prompt
 * 4. Forward to pi session
 * 5. Send response back
 */
export async function handleMessage(message: IncomingMessage, options: HandlerOptions): Promise<void> {
  const { config, configDir, client, sessionRegistry } = options;
  const log = getLogger();

  // 1. Filter by allowed users
  if (!isUserAllowed(message.userId, config)) {
    log.debug({ userId: message.userId }, "Ignoring message from unauthorized user");
    return;
  }

  log.info({ chatId: message.chatId, userId: message.userId, type: message.type }, "Processing incoming message");

  // 2. Download media files if present
  const filePaths = await downloadMediaFiles(message, client, configDir);

  // 3. Build the prompt
  const prompt = buildPrompt(message, filePaths);

  // 4. If no session registry yet, respond with stub
  if (!sessionRegistry) {
    await client.sendMessage(
      message.chatId,
      `Received: ${message.type} message${message.text ? ` — "${message.text.substring(0, 100)}"` : ""}\n\n_Bot daemon is initializing…_`,
    );
    return;
  }

  // 5. Start streaming (typing indicator)
  const streaming = startStreaming(client, message.chatId);

  try {
    // 6. Get or create session
    const session = await sessionRegistry.getOrCreate(message.chatId);

    // 7. Build attachments section for the prompt
    const attachmentsSection =
      filePaths.length > 0 ? `\n\nAttachments:\n${filePaths.map((p) => `- ${p}`).join("\n")}` : "";

    // 8. Send to pi session (responses come through session events)
    await session.prompt(`[telegram-kb] ${prompt}${attachmentsSection}`);

    // 9. Stop streaming
    streaming.stop();
  } catch (err) {
    streaming.stop();
    log.error({ err, chatId: message.chatId }, "Error processing message");

    await client.sendMessage(message.chatId, "Sorry, an error occurred while processing your message.");
  } finally {
    // 10. Clean up temp files
    for (const fp of filePaths) {
      cleanupFile(fp);
    }
  }
}

/**
 * Check if a user is in the allowed list.
 */
export function isUserAllowed(userId: number, config: Config): boolean {
  if (config.telegram.allowed_user_ids.length === 0) return true;
  return config.telegram.allowed_user_ids.includes(userId);
}

/**
 * Download media files from Telegram.
 */
async function downloadMediaFiles(
  message: IncomingMessage,
  client: TelegramClient,
  configDir: string,
): Promise<string[]> {
  if (!message.fileIds || message.fileIds.length === 0) return [];

  const tempDir = `${configDir}/telegram-tmp`;
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });

  const paths: string[] = [];

  for (const fileId of message.fileIds) {
    const fileUrl = await client.getFileUrl(fileId);
    if (!fileUrl) continue;

    const ext = message.type === "photo" ? ".jpg" : ".bin";

    const localPath = await downloadTelegramFile(fileUrl, ext, tempDir);
    if (localPath) {
      paths.push(localPath);
    }
  }

  return paths;
}

/**
 * Build a pi session prompt from an incoming message.
 */
function buildPrompt(message: IncomingMessage, filePaths: string[]): string {
  const parts: string[] = [];

  if (message.text) {
    parts.push(message.text);
  }

  if (filePaths.length > 0) {
    parts.push(`[Attached ${filePaths.length} file(s)]`);
  }

  if (message.type === "photo") {
    parts.push("[User sent a photo]");
  } else if (message.type === "voice") {
    parts.push("[User sent a voice message (audio file attached)]");
  } else if (message.type === "document" && !message.text) {
    parts.push("[User sent a file]");
  }

  return parts.join("\n");
}
