/**
 * Effect-based logger service for tele-kb-bot.
 *
 * Wraps pino as the logging backend behind an Effect Context service.
 *
 * @module
 */

import { Context, Effect, Layer } from 'effect';
import pino from 'pino';

// ─── Service Tag ────────────────────────────────────────────────────

interface EffectLogger {
  readonly debug: (msg: string, ...args: Array<unknown>) => Effect.Effect<void>;
  readonly info: (msg: string, ...args: Array<unknown>) => Effect.Effect<void>;
  readonly warn: (msg: string, ...args: Array<unknown>) => Effect.Effect<void>;
  readonly error: (msg: string, ...args: Array<unknown>) => Effect.Effect<void>;
  readonly fatal: (msg: string, ...args: Array<unknown>) => Effect.Effect<void>;
}

const EffectLogger = Context.GenericTag<EffectLogger>('@tele-kb-bot/logger');

// ─── Pino Backend ───────────────────────────────────────────────────

const createPinoLogger = (name: string, level: string): pino.Logger =>
  pino({
    name,
    level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
    redact: {
      paths: ['*.bot_token', '*.api_key', '*.token', '*.secret'],
      censor: '***redacted***',
    },
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  });

// ─── Layer ──────────────────────────────────────────────────────────

const EffectLoggerLive = (name: string, level: string): Layer.Layer<EffectLogger> =>
  Layer.effect(
    EffectLogger,
    Effect.sync(() => {
      const pino = createPinoLogger(name, level);
      return EffectLogger.of({
        debug: (msg, ...args) => Effect.sync(() => pino.debug(args.length > 0 ? { args } : undefined, msg)),
        info: (msg, ...args) => Effect.sync(() => pino.info(args.length > 0 ? { args } : undefined, msg)),
        warn: (msg, ...args) => Effect.sync(() => pino.warn(args.length > 0 ? { args } : undefined, msg)),
        error: (msg, ...args) => Effect.sync(() => pino.error(args.length > 0 ? { args } : undefined, msg)),
        fatal: (msg, ...args) => Effect.sync(() => pino.fatal(args.length > 0 ? { args } : undefined, msg)),
      });
    }),
  );

// ─── Synchronous Logger (for CLI modules) ───────────────────────────

/**
 * Create a direct pino logger for CLI use (no Effect dependency).
 */
const createCLILogger = (name: string, level?: string): pino.Logger =>
  createPinoLogger(name, level ?? process.env.LOG_LEVEL ?? 'info');

// ─── Backward-Compatible Exports ─────────────────────────────────────

let _singletonLogger: pino.Logger | null = null;

/**
 * @deprecated Use createCLILogger() or the EffectLogger service instead.
 */
const getLogger = (): pino.Logger => {
  if (!_singletonLogger) {
    _singletonLogger = createCLILogger('tele-kb-bot');
  }
  return _singletonLogger;
};

/**
 * @deprecated Use createCLILogger() instead.
 */
const createLogger = (opts?: { name?: string; level?: string }): pino.Logger => {
  _singletonLogger = createCLILogger(opts?.name ?? 'tele-kb-bot', opts?.level);
  return _singletonLogger;
};

export { createCLILogger, createLogger, EffectLogger, EffectLoggerLive, getLogger };
