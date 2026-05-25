/**
 * qmd integration for tele-kb-bot.
 *
 * qmd (https://github.com/tobi/qmd) is a local markdown search engine supporting
 * BM25, vector semantic search, and hybrid search with LLM reranking.
 *
 * Integration strategy:
 * - Detect qmd binary at startup (absolute path from config)
 * - Index memory directory as a qmd collection
 * - Route search calls to qmd CLI based on configured mode
 * - Graceful degradation: if qmd not found, caller falls back to built-in BM25
 *
 * The binary path is configured via `memory.qmd.binary_path`. If the binary is
 * found but fails at runtime (e.g. Node.js version mismatch in a pnpm shim),
 * the error is logged with full stderr for diagnosis. No attempt is made to
 * resolve an alternative Node.js or bypass the shell script — the user is
 * expected to fix their environment or set a different `binary_path`.
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { getLogger } from '../logger';

let _available: boolean | null = null;
let _binaryPath: string = 'qmd';

const configure = (binaryPath: string): void => {
  if (binaryPath !== _binaryPath) {
    _binaryPath = binaryPath;
    _available = null;
  }
};

const detect = (): boolean => {
  if (_available !== null) return _available;
  try {
    execFileSync('command', ['-v', _binaryPath], { stdio: 'ignore' });
    _available = true;
  } catch {
    _available = false;
  }
  return _available;
};

const reset = (): void => {
  _available = null;
};

// ─── Core runner ────────────────────────────────────────────────

/**
 * Run qmd with the given args.
 *
 * Attempts to execute the configured binary directly. On failure, logs the
 * error with full stderr and returns null so callers fall back gracefully.
 *
 * @returns stdout on success, null on any failure.
 */
const run = (args: Array<string>, timeout = 30_000): string | null => {
  if (!detect()) return null;

  try {
    return execFileSync(_binaryPath, args, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout,
      env: { ...process.env, QMD_FORCE_CPU: '1' },
    });
  } catch (err: unknown) {
    const error = err as Error & { stderr?: Buffer | string; status?: number; code?: string };
    const stderrText = typeof error.stderr === 'string' ? error.stderr : (error.stderr?.toString() ?? '');
    getLogger().error(
      {
        binary: _binaryPath,
        args,
        error: error.message,
        code: error.code,
        status: error.status,
        stderr: stderrText.slice(0, 400),
      },
      'qmd run failed',
    );
    return null;
  }
};

interface QmdResult {
  readonly filePath: string;
  readonly score: number;
  readonly snippet: string;
}

const parseOutput = (raw: string): Array<QmdResult> => {
  try {
    const parsed = JSON.parse(raw);
    const items: Array<Record<string, unknown>> = Array.isArray(parsed)
      ? parsed
      : (((parsed as Record<string, unknown>).results as Array<Record<string, unknown>>) ?? []);
    return items.map((i) => ({
      filePath: String(i.path ?? i.file ?? i.filePath ?? ''),
      score: Number(i.score ?? i.relevance ?? 0),
      snippet: String(i.snippet ?? i.content ?? i.text ?? '').slice(0, 200),
    }));
  } catch {
    return [];
  }
};

const search = (q: string, maxResults = 5): Array<QmdResult> | null => {
  if (!q || q.trim().length === 0) return null;
  const out = run(['search', q, '--json', '--limit', String(maxResults)]);
  return out ? parseOutput(out) : null;
};

const vsearch = (q: string, maxResults = 5): Array<QmdResult> | null => {
  const out = run(['vsearch', q, '--json', '--limit', String(maxResults)], 60_000);
  return out ? parseOutput(out) : null;
};

const query = (q: string, maxResults = 5): Array<QmdResult> | null => {
  const out = run(['query', q, '--json', '--limit', String(maxResults)], 60_000);
  return out ? parseOutput(out) : null;
};

export type { QmdResult };
export { configure, detect, query, reset, run, search, vsearch };
