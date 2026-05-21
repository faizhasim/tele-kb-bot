/**
 * Telegram types for tele-kb-bot.
 *
 * @module
 */

/** Incoming message types we handle */
export type IncomingMessageType = 'text' | 'photo' | 'document' | 'voice' | 'media_group' | 'command';

/** Parsed incoming message from Telegram */
export interface IncomingMessage {
  /** The original Telegram message ID */
  messageId: number;
  /** Chat ID (Telegram user or group chat) */
  chatId: number;
  /** User ID of the sender */
  userId: number;
  /** Type of message */
  type: IncomingMessageType;
  /** Text content (for text messages and caption on media) */
  text?: string;
  /** File IDs for media messages */
  fileIds?: string[];
  /** Local file paths after downloading */
  filePaths?: string[];
  /** Whether this is part of a media group */
  mediaGroupId?: string;
}

/** Result from processing a message through the bot */
export interface MessageResult {
  /** Text response to send back */
  text?: string;
  /** File paths to attach to the response */
  attachPaths?: string[];
  /** Whether the message was handled (or silently dropped) */
  handled: boolean;
  /** Whether processing is still in progress (streaming) */
  streaming?: boolean;
}

/** Pending attachment from the telegram_attach tool */
export interface PendingAttachment {
  /** File path to attach */
  filePath: string;
  /** Optional caption */
  caption?: string;
}
