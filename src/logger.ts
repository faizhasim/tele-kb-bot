/**
 * Effect-based logger service for tele-kb-bot.
 *
 * Wraps pino as the logging backend behind an Effect Context service.
 * Supports stdout (CLI) and rotating file (daemon) output.
 *
 * @module
 */

import { createWriteStream, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Effect, Layer } from 'effect';
import pino from 'pino';
import pretty from 'pino-pretty';
import { SUBDIRS } from './config/paths';

// ─── Rolling File Writer ────────────────────────────────────────────

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_FILES = 5;

/**
 * Create a writable stream that rotates when the log file exceeds maxSize.
 */
const createRollingLogWriter = (
  logPath: string,
  maxSize: number = DEFAULT_MAX_FILE_SIZE,
  maxFiles: number = DEFAULT_MAX_FILES,
): ReturnType<typeof createWriteStream> => {
  // Rotate if current file exceeds maxSize
  try {
    if (existsSync(logPath)) {
      const size = statSync(logPath).size;
      if (size >= maxSize) {
        // Shift: bot.log.N → bot.log.N+1
        for (let i = maxFiles - 1; i >= 1; i--) {
          const oldPath = `${logPath}.${i}`;
          if (existsSync(oldPath)) {
            try {
              renameSync(oldPath, `${logPath}.${i + 1}`);
            } catch {
              // skip locked files
            }
          }
        }
        // Rotate: bot.log → bot.log.1
        renameSync(logPath, `${logPath}.1`);
      }
    }
  } catch {
    // best-effort rotation
  }

  return createWriteStream(logPath, { flags: 'a' });
};

const resolveLogFile = (configDir: string): string => join(configDir, SUBDIRS.LOGS, 'bot.log');

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

/**
 * Create a pino logger that writes to both stdout (pretty) and a rotating log file.
 * Used by the daemon. CLI commands should use createCLILogger instead.
 */
const createDaemonPinoLogger = (name: string, level: string, configDir: string): pino.Logger => {
  const logFile = resolveLogFile(configDir);
  const fileStream = createRollingLogWriter(logFile);

  // Use pino-pretty as a direct transform stream (not via pino.transport,
  // which uses thread-stream workers that don't work reliably in Bun)
  const prettyStream = pretty({
    colorize: true,
    translateTime: 'HH:MM:ss.l',
    ignore: 'pid,hostname',
  });

  return pino(
    {
      name,
      level,
      redact: {
        paths: ['*.bot_token', '*.api_key', '*.token', '*.secret'],
        censor: '***redacted***',
      },
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
    },
    pino.multistream([{ stream: fileStream }, { stream: prettyStream }]),
  );
};

// ─── Layer ──────────────────────────────────────────────────────────

/**
 * Create an EffectLogger layer that writes to stdout only (CLI-friendly).
 */
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

/**
 * Create an EffectLogger layer that writes to both stdout and a rotating log file.
 * Used by the daemon. The CLI layer (EffectLoggerLive) remains stdout-only.
 */
const EffectLoggerLiveWithFile = (name: string, level: string, configDir: string): Layer.Layer<EffectLogger> =>
  Layer.effect(
    EffectLogger,
    Effect.sync(() => {
      const pino = createDaemonPinoLogger(name, level, configDir);
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
 * Outputs to stdout only.
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

export {
  createCLILogger,
  createDaemonPinoLogger,
  createLogger,
  createRollingLogWriter,
  EffectLogger,
  EffectLoggerLive,
  EffectLoggerLiveWithFile,
  getLogger,
  resolveLogFile,
};
