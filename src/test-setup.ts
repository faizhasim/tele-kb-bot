/**
 * Global vitest setup — runs before all test files.
 *
 * Raises the process max listeners limit to suppress the
 * MaxListenersExceededWarning that appears when multiple test
 * files add process listeners (SIGINT/SIGTERM for daemon tests,
 * process.exit spies, etc.).
 */

process.setMaxListeners(50);
