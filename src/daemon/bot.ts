/**
 * GrammY bot controller for tele-kb-bot.
 *
 * Factory function that wires Telegram client to pi session registry.
 * Handles message routing, typing indicators, and command dispatch.
 *
 * @module
 */

import type { Config } from "../config/schema";
import { createCLILogger } from "../logger";
import type { TelegramClient } from "../telegram/client";
import type { SessionRegistry } from "./session-registry";

interface BotController {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

/**
 * Create a bot controller that wires a Telegram client to a pi session registry.
 * Returns a controller with start/stop methods.
 */
const createBotController = (
  _client: TelegramClient,
  _registry: SessionRegistry,
  config: Config,
  configDir: string,
): BotController => {
  const log = createCLILogger("tele-kb-bot");

  // TODO: Wire typingTimers/startTyping/stopTyping when GrammY integrated (Phase 4)

  const start = async (): Promise<void> => {
    log.info("Bot controller starting...");
    log.info({ allowedUsers: config.telegram.allowed_user_ids }, "Allowed users");
    log.info(
      {
        provider: config.llm.provider,
        model: config.llm.model,
        reasoning: config.llm.reasoning,
      },
      "LLM config",
    );
    log.info({ memoryEnabled: config.memory.enabled, configDir }, "Memory config");
    log.info("Bot controller started (GrammY integration pending)");
  };

  const stop = async (): Promise<void> => {
    log.info("Bot controller stopping...");
    log.info("Bot controller stopped");
  };

  return { start, stop };
};

export type { BotController };
export { createBotController };
