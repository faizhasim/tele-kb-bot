/**
 * Streaming preview for Telegram responses.
 *
 * Sends periodic chat actions (typing indicator) while the bot
 * is processing a response, and optionally updates a message draft
 * with in-progress text.
 *
 * @module
 */

import { getLogger } from "../logger";
import type { TelegramClient } from "./client";

/** Interval between typing indicator updates in ms. */
const TYPING_INTERVAL_MS = 4000;

/**
 * Manages streaming indicators for a single response.
 *
 * Sends `sendChatAction("typing")` periodically while the bot
 * is generating a response.
 */
export class StreamingManager {
  private readonly client: TelegramClient;
  private readonly chatId: number;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private _isActive = false;
  private startTime = 0;

  constructor(client: TelegramClient, chatId: number) {
    this.client = client;
    this.chatId = chatId;
  }

  /** Whether streaming is currently active. */
  get isActive(): boolean {
    return this._isActive;
  }

  /** How long streaming has been active in ms. */
  get elapsedMs(): number {
    return this._isActive ? Date.now() - this.startTime : 0;
  }

  /**
   * Start streaming — begins periodic typing indicators.
   */
  start(): void {
    if (this._isActive) return;

    this._isActive = true;
    this.startTime = Date.now();

    // Send initial typing indicator immediately
    this.sendTyping();

    // Set interval for periodic updates
    this.typingTimer = setInterval(() => {
      this.sendTyping();
    }, TYPING_INTERVAL_MS);
  }

  /**
   * Stop streaming — clears the typing indicator interval.
   */
  stop(): void {
    if (!this._isActive) return;

    this._isActive = false;
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
  }

  private sendTyping(): void {
    this.client.sendChatAction(this.chatId, "typing").catch(() => {
      // Best-effort — typing indicators may fail silently
    });
  }
}

/**
 * Create a streaming manager for a response.
 * Automatically starts the typing indicator.
 *
 * @returns The streaming manager
 */
export function startStreaming(client: TelegramClient, chatId: number): StreamingManager {
  const manager = new StreamingManager(client, chatId);
  manager.start();
  return manager;
}

/**
 * Handle a completion notification — logs timing info.
 */
export function logResponseTiming(chatId: number, streamingManager: StreamingManager): void {
  const elapsed = streamingManager.elapsedMs;
  const log = getLogger();
  log.info({ chatId, elapsedMs: elapsed }, `Response completed in ${(elapsed / 1000).toFixed(1)}s`);
}
