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
import { createCLILogger, createDaemonPinoLogger, EffectLoggerLiveWithFile, resolveLogFile } from '../logger';
import { createMemoryContext } from '../memory/manager';
import { createBotController } from './bot';
import { createSessionRegistry } from './session-registry';

// ─── Runtime ────────────────────────────────────────────────────────

// (Runtime created inside startDaemon after config loads — uses EffectLoggerLiveWithFile)

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
 * Loads config first, then creates a runtime with file-logging layer.
 */
const startDaemon = (configOverride?: string): Promise<void> =>
  Effect.gen(function* () {
    // Use CLI logger initially (before config is loaded and log file known)
    const log = createCLILogger(BINARY_NAME);
    log.info('tele-kb-bot daemon starting...');

    const configDir = configOverride ?? resolveConfigDir();
    const { config, configDir: resolvedDir } = yield* loadConfig(configDir);

    // Create a file+stdout logger now that configDir is known
    const daemonLog = createDaemonPinoLogger(BINARY_NAME, process.env.LOG_LEVEL ?? 'info', resolvedDir);
    daemonLog.info({ configDir: resolvedDir, provider: config.llm.provider, model: config.llm.model }, 'Config loaded');

    // Create runtime with FileSystem + Effect-based file-logging layer
    const daemonLayer = Layer.merge(
      BunFileSystem.layer,
      EffectLoggerLiveWithFile(BINARY_NAME, process.env.LOG_LEVEL ?? 'info', resolvedDir),
    );
    const daemonRuntime = ManagedRuntime.make(daemonLayer);

    // Log file destination
    daemonLog.info({ path: resolveLogFile(resolvedDir) }, 'Log file');

    return yield* Effect.promise(() =>
      daemonRuntime.runPromise(
        Effect.gen(function* () {
          yield* ensureConfigDirs(resolvedDir);

          const memoryCtx = yield* Effect.promise(() => createMemoryContext(config, resolvedDir));
          daemonLog.info(
            { mode: config.memory.mode, available: memoryCtx.backend.isAvailable() },
            'Memory backend initialised',
          );

          const registry = createSessionRegistry(config, resolvedDir);

          const tokenResp = yield* Effect.promise(() =>
            fetch(`https://api.telegram.org/bot${config.telegram.bot_token}/getMe`).then((r) => r.json()),
          );
          const tokenData = tokenResp as { ok: boolean; result?: { first_name: string }; description?: string };
          if (!tokenData.ok) {
            daemonLog.error({ error: tokenData.description }, 'Bot token verification failed');
            console.error("ERROR: Invalid Telegram bot token. Run 'tele-kb-bot setup' to reconfigure.");
            process.exit(1);
          }
          daemonLog.info({ botName: tokenData.result?.first_name }, 'Bot token verified');

          const controller = createBotController(config, registry, memoryCtx);
          setupSignalHandlers(controller, registry);

          daemonLog.info('Starting bot polling...');
          yield* Effect.promise(() => controller.start());
        }),
      ),
    );
  }).pipe(
    Effect.provide(
      Layer.merge(
        BunFileSystem.layer,
        EffectLoggerLiveWithFile(BINARY_NAME, process.env.LOG_LEVEL ?? 'info', resolveConfigDir()),
      ),
    ),
    Effect.runPromise,
  );

export { startDaemon };
