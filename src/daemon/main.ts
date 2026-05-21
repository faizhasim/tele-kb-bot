/**
 * Daemon entry point for tele-kb-bot.
 *
 * Wires together config loading, session management, and Telegram bot.
 * Handles graceful shutdown on SIGINT/SIGTERM.
 *
 * @module
 */

import { BunFileSystem } from '@effect/platform-bun';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { loadConfig } from '../config/loader';
import { ensureConfigDirs, resolveConfigDir } from '../config/paths';
import { BINARY_NAME } from '../constants';
import { createCLILogger, EffectLoggerLive } from '../logger';
import { createMemoryContext } from '../memory/manager';
import { createBotController } from './bot';
import { createSessionRegistry } from './session-registry';

// ─── Runtime ────────────────────────────────────────────────────────

const daemonLayer = Layer.merge(
  BunFileSystem.layer,
  EffectLoggerLive(BINARY_NAME, (process.env.LOG_LEVEL as string) ?? 'info'),
);

const runtime = ManagedRuntime.make(daemonLayer);

// ─── Signal Handling ────────────────────────────────────────────────

const setupSignalHandlers = (
  controller: ReturnType<typeof createBotController>,
  registry: ReturnType<typeof createSessionRegistry>,
): void => {
  const log = createCLILogger(BINARY_NAME);
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'Received shutdown signal');

    await controller.stop();
    log.info('Bot stopped');

    await registry.disposeAll();
    log.info('Sessions disposed');

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    log.error({ err }, 'Uncaught exception');
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
};

// ─── Main ───────────────────────────────────────────────────────────

/**
 * Start the tele-kb-bot daemon.
 */
const startDaemon = (configOverride?: string): Promise<void> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const log = createCLILogger(BINARY_NAME);
      log.info('tele-kb-bot daemon starting...');

      // Load config
      const configDir = configOverride ?? resolveConfigDir();
      const { config, configDir: resolvedDir } = yield* loadConfig(configDir);
      log.info(
        {
          configDir: resolvedDir,
          provider: config.llm.provider,
          model: config.llm.model,
        },
        'Config loaded',
      );

      // Ensure directories
      yield* ensureConfigDirs(resolvedDir);

      // Initialise memory backend
      const memoryCtx = yield* Effect.promise(() => createMemoryContext(config, resolvedDir));
      log.info({ mode: config.memory.mode, available: memoryCtx.backend.isAvailable() }, 'Memory backend initialised');

      // Create services
      const registry = createSessionRegistry(config, resolvedDir);

      // Verify bot token via Telegram API
      const tokenResp = yield* Effect.promise(() =>
        fetch(`https://api.telegram.org/bot${config.telegram.bot_token}/getMe`).then((r) => r.json()),
      );
      const tokenData = tokenResp as { ok: boolean; result?: { first_name: string }; description?: string };
      if (!tokenData.ok) {
        log.error({ error: tokenData.description }, 'Bot token verification failed');
        console.error("ERROR: Invalid Telegram bot token. Run 'tele-kb-bot setup' to reconfigure.");
        process.exit(1);
      }
      log.info({ botName: tokenData.result?.first_name }, 'Bot token verified');

      // Create controller with memory context
      const controller = createBotController(config, registry, memoryCtx);
      setupSignalHandlers(controller, registry);

      log.info('Starting bot polling...');
      yield* Effect.promise(() => controller.start());
    }),
  );

export { startDaemon };
