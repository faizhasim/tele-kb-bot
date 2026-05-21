/**
 * Memory file manager for tele-kb-bot.
 *
 * Reads/writes MEMORY.md, SCRATCHPAD.md, and daily/YYYY-MM-DD.md files
 * using the Effect FileSystem service.
 *
 * @module
 */

import { join } from "node:path";
import { FileSystem } from "@effect/platform/FileSystem";
import { Effect } from "effect";
import type { IndexState } from "./search";
import { indexDocuments, search } from "./search";
import type { SearchResult } from "./types";

// ─── File Names ──────────────────────────────────────────────────────

const MEMORY_FILE = "MEMORY.md";
const SCRATCHPAD_FILE = "SCRATCHPAD.md";
const DAILY_DIR = "daily";

// ─── Path Helpers ───────────────────────────────────────────────────

const memoryPath = (baseDir: string) => join(baseDir, MEMORY_FILE);
const scratchpadPath = (baseDir: string) => join(baseDir, SCRATCHPAD_FILE);
const dailyPath = (baseDir: string, date: string) => join(baseDir, DAILY_DIR, `${date}.md`);

const todayDate = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const yesterdayDate = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ─── Read Functions ──────────────────────────────────────────────────

const readSafe = (path: string): Effect.Effect<string, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!exists) return "";
    return yield* fs.readFileString(path).pipe(Effect.catchAll(() => Effect.succeed("")));
  });

const readMemory = (baseDir: string): Effect.Effect<string, never, FileSystem> => readSafe(memoryPath(baseDir));

const readScratchpad = (baseDir: string): Effect.Effect<string, never, FileSystem> => readSafe(scratchpadPath(baseDir));

const readDaily = (baseDir: string, date: string): Effect.Effect<string, never, FileSystem> =>
  readSafe(dailyPath(baseDir, date));

const readToday = (baseDir: string): Effect.Effect<string, never, FileSystem> => readDaily(baseDir, todayDate());

const readYesterday = (baseDir: string): Effect.Effect<string, never, FileSystem> =>
  readDaily(baseDir, yesterdayDate());

// ─── Write Functions ─────────────────────────────────────────────────

const appendToFile = (path: string, content: string): Effect.Effect<void, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.catchAll(() => Effect.succeed(false)));
    const prefix = exists ? "\n" : "";
    yield* fs.writeFileString(path, prefix + content, { flag: "a" }).pipe(Effect.catchAll(() => Effect.void));
  });

const overwriteFile = (path: string, content: string): Effect.Effect<void, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.writeFileString(path, content).pipe(Effect.catchAll(() => Effect.void));
  });

const appendToMemory = (baseDir: string, content: string): Effect.Effect<void, never, FileSystem> =>
  appendToFile(memoryPath(baseDir), content);

const writeScratchpad = (baseDir: string, content: string): Effect.Effect<void, never, FileSystem> =>
  overwriteFile(scratchpadPath(baseDir), content);

const appendToToday = (baseDir: string, content: string): Effect.Effect<void, never, FileSystem> =>
  appendToFile(dailyPath(baseDir, todayDate()), content);

// ─── Search Index ────────────────────────────────────────────────────

const buildSearchIndex = (baseDir: string): Effect.Effect<IndexState, never, FileSystem> =>
  Effect.gen(function* () {
    const [memory, today, yesterday] = yield* Effect.all([
      readMemory(baseDir),
      readToday(baseDir),
      readYesterday(baseDir),
    ]);

    const docs = [
      ...(memory ? [{ path: `memory/${MEMORY_FILE}`, content: memory }] : []),
      ...(today ? [{ path: `memory/daily/${todayDate()}.md`, content: today }] : []),
      ...(yesterday ? [{ path: `memory/daily/${yesterdayDate()}.md`, content: yesterday }] : []),
    ];

    return indexDocuments(docs);
  });

const searchMemory = (state: IndexState, query: string, maxResults = 5): ReadonlyArray<SearchResult> =>
  search(state, query, maxResults);

export type { SearchResult };
export {
  appendToMemory,
  appendToToday,
  buildSearchIndex,
  dailyPath,
  memoryPath,
  readMemory,
  readScratchpad,
  readToday,
  readYesterday,
  scratchpadPath,
  searchMemory,
  todayDate,
  writeScratchpad,
  yesterdayDate,
};
