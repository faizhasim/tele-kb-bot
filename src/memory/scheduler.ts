/**
 * Periodic qmd index scheduler for tele-kb-bot.
 *
 * Runs `qmd update` and `qmd embed` on configurable intervals to keep
 * the search index fresh without manual intervention.
 *
 * Uses `setInterval` under the hood — no external dependencies.
 * AbortController-based teardown for clean shutdown on SIGINT/SIGTERM.
 *
 * @module
 */

import { run as qmdRun } from './qmd';

// ─── Types ──────────────────────────────────────────────────────────

interface QmdScheduler {
  /** Start the periodic update/embed cycles. Safe to call multiple times. */
  start(): void;
  /** Stop all timers. Idempotent. */
  stop(): void;
}

interface SchedulerLogger {
  info(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
}

// ─── Factory ─────────────────────────────────────────────────────────

const createQmdScheduler = (
  updateIntervalSeconds: number | undefined,
  embedIntervalSeconds: number | undefined,
  logger: SchedulerLogger,
): QmdScheduler => {
  const effectiveUpdate = updateIntervalSeconds ?? 300; // default 5 min
  const effectiveEmbed = embedIntervalSeconds ?? 3600; // default 60 min
  const abortController = new AbortController();
  const signal = abortController.signal;

  let updateTimer: ReturnType<typeof setInterval> | null = null;
  let embedTimer: ReturnType<typeof setInterval> | null = null;

  const safeRun = (args: Array<string>, label: string, timeout: number): void => {
    if (signal.aborted) return;
    const start = performance.now();
    const result = qmdRun(args, timeout);
    if (signal.aborted) return;
    const elapsed = Math.round(performance.now() - start);
    if (result !== null) {
      logger.info({ elapsed, label }, `qmd ${label} complete`);
    } else {
      logger.error({ elapsed, label }, `qmd ${label} failed`);
    }
  };

  return {
    start(): void {
      // Prevent double-start
      if (updateTimer !== null || embedTimer !== null) return;

      if (effectiveUpdate > 0) {
        updateTimer = setInterval(() => {
          safeRun(['update'], 'update', 120_000);
        }, effectiveUpdate * 1000);
        if (typeof updateTimer === 'object' && typeof updateTimer.unref === 'function') {
          updateTimer.unref();
        }
      }

      if (effectiveEmbed > 0) {
        embedTimer = setInterval(() => {
          safeRun(['embed'], 'embed', 300_000);
        }, effectiveEmbed * 1000);
        if (typeof embedTimer === 'object' && typeof embedTimer.unref === 'function') {
          embedTimer.unref();
        }
      }
    },

    stop(): void {
      abortController.abort();
      if (updateTimer !== null) {
        clearInterval(updateTimer);
        updateTimer = null;
      }
      if (embedTimer !== null) {
        clearInterval(embedTimer);
        embedTimer = null;
      }
    },
  };
};

export type { QmdScheduler, SchedulerLogger };
export { createQmdScheduler };
