---
status: proposed
date: 2026-05-24
decision-makers: Mohd Faiz Hasim
---

# Auto-Indexing Strategy for qmd

## Context and Problem Statement

The bot uses qmd for persistent search indexing. Currently, the index is built once at startup via `rebuildIndex()`, which adds vault directories as qmd collections and runs `qmd update`. After that, the index is static for the entire bot lifetime.

This means:
- New notes added to the vault are not searchable until the bot restarts
- Modified notes may show stale content in search snippets
- Deleted notes may still appear in search results
- The user must manually run `tele-kb-bot index build` or restart the daemon to refresh

We need a strategy to keep the search index current without manual intervention.

## Decision Drivers

- **Freshness** — Notes should be searchable within minutes of being added/changed
- **Minimal overhead** — A personal bot on a Mac Mini should not consume noticeable CPU or battery
- **Simplicity** — No additional dependencies beyond what qmd already provides
- **Robustness** — Auto-indexing should not crash the bot or cause search unavailability
- **Vector embeddings** — `qmd embed` is expensive; it should run much less frequently than full-text updates

## Considered Options

1. **Periodic `qmd update`** — Run `qmd update` on a fixed timer. This re-indexes all collections incrementally (fast, only processes changed files). Run `qmd embed` on a longer timer.

2. **File system watcher** — Use `fs.watch` or `chokidar` to detect file changes in vault directories and trigger immediate update.

3. **Hybrid** — File watcher for responsive updates to full-text index, periodic embed for vector refresh.

4. **No auto-indexing (status quo)** — Manual `tele-kb-bot index build` or restart on demand.

## Decision Outcome

Chosen option: **Periodic `qmd update` with separate embed interval** (Option 1), because:

- It uses qmd's own incremental indexing (`qmd update`), which is fast and efficient
- No additional dependencies (no chokidar, no fsevents)
- The timer-based approach is simple, predictable, and easy to configure
- `qmd embed` runs separately on a longer interval since vector embedding is expensive
- File watchers on macOS have reliability issues (fsevents coalescing, directory deletion, resource exhaustion on large vaults)

### Consequences

- Good, because notes are searchable within the update interval (default 5 minutes)
- Good, because `qmd update` is incremental and only processes changed files
- Good, because the bot process doesn't need file watcher permissions or extra resource monitoring
- Good, because intervals are configurable in config.yaml (update interval, embed interval)
- Bad, because there is a delay between file change and index freshness (bounded by update interval)
- Bad, because `qmd update` still scans the filesystem on each tick to detect changes
- Neutral, because the existing `rebuildIndex()` at startup ensures the index is fresh on restart

### Implementation Plan

1. Add a background scheduler to the daemon (`src/daemon/`) that runs:
   - `qmd update` at a configurable interval (default: 5 minutes)
   - `qmd embed` at a configurable interval (default: 60 minutes)
2. Add config fields `memory.qmd.update_interval_seconds` and `memory.qmd.embed_interval_seconds` to `ConfigSchema` (defaults: 300 and 3600)
3. Start the scheduler after `createMemoryContext` returns, store the abort controller for clean shutdown
4. Log each update cycle at `info` level with timing

The scheduler is a simple `setInterval`/`clearInterval` — no cron library needed. The update calls use the existing `run()` function from `qmd.ts`.

```typescript
// Pseudocode for the scheduler
const updateTimer = setInterval(() => {
  run(['update'], 120_000); // 2 minute timeout for update
}, config.memory.qmd.update_interval_seconds * 1000);

const embedTimer = setInterval(() => {
  run(['embed'], 300_000); // 5 minute timeout for embed
}, config.memory.qmd.embed_interval_seconds * 1000);

// On shutdown:
clearInterval(updateTimer);
clearInterval(embedTimer);
```

5. Expose intervals in the config schema, defaults file, and setup wizard (advanced/optional)
6. The `memory.qmd.enabled` flag already gates all qmd activity — the scheduler only starts when `enabled && mode === 'persistent'`

### Future Consideration

If periodic scanning becomes a performance concern on large vaults, we can later add `fs.watch` as an optional faster trigger while keeping the periodic cycle as a fallback. The API surface (update/embed intervals) remains the same.

## Related Decisions

- [ADR-0006](0006-memory-system-design.md) — Memory System (defines the backend interface that `rebuildIndex` is part of)
- [ADR-0009](0009-tool-surface-restriction.md) — Tool Surface Restriction (qmd binary path resolution)
