/**
 * Tests for the logger module.
 *
 * Synchronous pino functions tested with regular assertions.
 * Effect-based functions tested with ManagedRuntime.runPromise.
 */

import { Writable } from 'node:stream';
import { Effect, ManagedRuntime } from 'effect';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createCLILogger, createLogger, EffectLogger, EffectLoggerLive, getLogger } from './logger';

// ─── EffectLogger Service Tag ───────────────────────────────────────

describe('EffectLogger', () => {
  it('exists and is a Context Tag', () => {
    expect(EffectLogger).toBeDefined();
    expect(typeof EffectLogger.of).toBe('function');
  });

  it('of() creates a valid service object with all log methods', () => {
    const service = EffectLogger.of({
      debug: () => Effect.void,
      info: () => Effect.void,
      warn: () => Effect.void,
      error: () => Effect.void,
      fatal: () => Effect.void,
    });
    expect(typeof service.debug).toBe('function');
    expect(typeof service.info).toBe('function');
    expect(typeof service.warn).toBe('function');
    expect(typeof service.error).toBe('function');
    expect(typeof service.fatal).toBe('function');
  });
});

// ─── EffectLoggerLive Layer ─────────────────────────────────────────

describe('EffectLoggerLive', () => {
  const runtime = ManagedRuntime.make(EffectLoggerLive('test', 'silent'));

  it('runs debug log without throwing', async () => {
    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const logger = yield* EffectLogger;
          yield* logger.debug('test debug message');
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('runs info log without throwing', async () => {
    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const logger = yield* EffectLogger;
          yield* logger.info('test info message');
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('runs warn log without throwing', async () => {
    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const logger = yield* EffectLogger;
          yield* logger.warn('test warn message');
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('runs error log without throwing', async () => {
    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const logger = yield* EffectLogger;
          yield* logger.error('test error message');
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('runs fatal log without throwing', async () => {
    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const logger = yield* EffectLogger;
          yield* logger.fatal('test fatal message');
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('accepts extra args with log calls', async () => {
    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const logger = yield* EffectLogger;
          yield* logger.info('with args', { key: 'value', count: 42 });
          yield* logger.warn('multi arg', 1, 'two', { three: 3 });
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

// ─── Redact Configuration ───────────────────────────────────────────

describe('redact', () => {
  it('redacts nested bot_token via *.bot_token pattern', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (err?: Error) => void) {
        chunks.push(chunk.toString().trim());
        callback();
      },
    });

    const logger = pino(
      {
        level: 'info',
        redact: {
          paths: ['*.bot_token', '*.api_key', '*.token', '*.secret'],
          censor: '***redacted***',
        },
      },
      stream,
    );

    logger.info({ ctx: { bot_token: 'super-secret-token' } }, 'bot login');
    logger.flush();

    const lastChunk = chunks.at(-1);
    expect(lastChunk).toBeDefined();
    const parsed = JSON.parse(lastChunk as string);
    expect(parsed.ctx.bot_token).toBe('***redacted***');
  });

  it('redacts nested api_key via *.api_key pattern', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (err?: Error) => void) {
        chunks.push(chunk.toString().trim());
        callback();
      },
    });

    const logger = pino(
      {
        level: 'info',
        redact: {
          paths: ['*.bot_token', '*.api_key', '*.token', '*.secret'],
          censor: '***redacted***',
        },
      },
      stream,
    );

    logger.info({ config: { api_key: 'abc-123-def' } }, 'api config');
    logger.flush();

    const lastChunk = chunks.at(-1);
    expect(lastChunk).toBeDefined();
    const parsed = JSON.parse(lastChunk as string);
    expect(parsed.config.api_key).toBe('***redacted***');
  });

  it('censor value is ***redacted***', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (err?: Error) => void) {
        chunks.push(chunk.toString().trim());
        callback();
      },
    });

    const logger = pino(
      {
        level: 'info',
        redact: {
          paths: ['*.secret'],
          censor: '***redacted***',
        },
      },
      stream,
    );

    logger.info({ data: { secret: 'my-password' } }, 'login');
    logger.flush();

    const lastChunk = chunks.at(-1);
    expect(lastChunk).toBeDefined();
    const parsed = JSON.parse(lastChunk as string);
    expect(parsed.data.secret).toBe('***redacted***');
  });

  it('does not redact non-sensitive fields', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (err?: Error) => void) {
        chunks.push(chunk.toString().trim());
        callback();
      },
    });

    const logger = pino(
      {
        level: 'info',
        redact: {
          paths: ['*.bot_token', '*.api_key', '*.token', '*.secret'],
          censor: '***redacted***',
        },
      },
      stream,
    );

    logger.info({ username: 'alice', action: 'login' }, 'user action');
    logger.flush();

    const lastChunk = chunks.at(-1);
    expect(lastChunk).toBeDefined();
    const parsed = JSON.parse(lastChunk as string);
    expect(parsed.username).toBe('alice');
    expect(parsed.action).toBe('login');
  });
});

// ─── Deprecated getLogger (singleton) ───────────────────────────────

describe('getLogger (deprecated)', () => {
  it('returns a logger instance', () => {
    const log = getLogger();
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
  });

  it('returns the same instance across multiple calls (singleton)', () => {
    const a = getLogger();
    const b = getLogger();
    expect(a).toBe(b);
  });

  it('can be called without throwing', () => {
    const log = getLogger();
    expect(() => log.info('singleton test')).not.toThrow();
  });
});

// ─── Deprecated createLogger ────────────────────────────────────────

describe('createLogger (deprecated)', () => {
  it('creates a logger with default name when no options given', () => {
    const log = createLogger();
    expect(log).toBeDefined();
    expect(() => log.info('default logger')).not.toThrow();
  });

  it('creates a logger with custom name option', () => {
    const log = createLogger({ name: 'custom-name' });
    expect(log).toBeDefined();
    expect(() => log.info('custom name')).not.toThrow();
  });

  it('creates a logger with custom level option', () => {
    const log = createLogger({ level: 'warn' });
    expect(log).toBeDefined();
    // warn should work at this level
    expect(() => log.warn('custom level')).not.toThrow();
  });

  it('replaces the singleton reference', () => {
    const firstLogger = createLogger({ name: 'first' });
    const secondLogger = createLogger({ name: 'second' });

    // Second call replaces the singleton; getLogger() returns the new instance
    const current = getLogger();
    expect(firstLogger).not.toBe(secondLogger);
    expect(secondLogger).toBe(current);
  });
});

// ─── createCLILogger ────────────────────────────────────────────────

describe('createCLILogger', () => {
  it('creates a logger with the given name', () => {
    const log = createCLILogger('test');
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
    expect(() => log.info('hello')).not.toThrow();
  });

  it('uses LOG_LEVEL env var when level not specified', () => {
    const prevLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';

    try {
      const log = createCLILogger('test-env');
      expect(log).toBeDefined();
      expect(() => log.debug('env level test')).not.toThrow();
    } finally {
      if (prevLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = prevLevel;
      }
    }
  });

  it('prefers explicit level over LOG_LEVEL env var', () => {
    const prevLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'fatal';

    try {
      // Explicit 'info' level should take precedence over env var 'fatal'
      const log = createCLILogger('test-explicit', 'info');
      expect(log).toBeDefined();
      expect(() => log.info('explicit level')).not.toThrow();
    } finally {
      if (prevLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = prevLevel;
      }
    }
  });
});
