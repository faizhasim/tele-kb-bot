---
status: accepted
date: 2026-05-21
decision-makers: Mohd Faiz Hasim
---

# Memory System Design

## Context and Problem Statement

tele-kb-bot needs a persistent knowledge base that remembers conversations and facts across sessions. What file format, search strategy, and context injection approach should we use?

The system must work offline (no external services), be human-readable (plain markdown), and support both keyword and semantic search (optional qmd).

## Decision Drivers

- Two memory modes: ephemeral (BM25 in-memory) and persistent (qmd on-disk)
- Human-readable files — markdown is git-friendly, editable by hand
- Context injection must be additive — never replace or truncate the LLM's system prompt
- BM25 search in pure TypeScript — no native modules
- LRU cache for query results with configurable size/count limits
- qmd support must be optional — if binary not in PATH, degrade gracefully to BM25
- Idempotent setup — re-running setup preserves existing values

## Considered Options

- **Plain markdown + pure-TypeScript BM25** — human-readable files, built-in search
- **SQLite + FTS5** — fast search, structured storage, but opaque binary files
- **Vector database (qmd, Chroma, etc.)** — semantic search, but requires native deps
- **JSON-based memory** — structured, machine-friendly, less human-readable

## Decision Outcome

Chosen option: **Dual-mode memory with LRU cache**, because:

- Two modes: ephemeral (BM25 in-memory, rebuilt on startup) and persistent (qmd on-disk, survives restarts)
- Memory tools are wired to the real backend — no more stubs
- LRU cache avoids redundant search calls with configurable memory limits
- Context injection happens before each prompt if `auto_inject` is enabled
- qmd integration is gated behind `which qmd` check — degrades gracefully to BM25
- File layout follows pi-memory patterns (adapted from MIT-licensed reference)

### Consequences

- Good, because memory files are portable and editable by hand
- Good, because BM25 is well-understood, testable, and has no native deps
- Good, because LRU cache reduces redundant search calls
- Good, because persistent mode (qmd) survives restarts with semantic search
- Bad, because BM25 is limited to keyword matching — no semantic understanding without qmd
- Bad, because qmd requires a native binary (optional, graceful fallback)
- Bad, because markdown parsing (especially scratchpad) is best-effort

### Confirmation

Unit tests verify BM25 scoring against known queries, scratchpad parsing correctness, and context injection size limits. Integration test verifies the full context build pipeline.

## Memory File Layout

```
<config_dir>/memory/
├── MEMORY.md          # Long-term facts (append)
├── SCRATCHPAD.md      # Checklist: - [ ] item, - [x] item
└── daily/
    └── YYYY-MM-DD.md  # Daily log (append-only)
```

Context injection order (all additive, total capped at 16K chars):

1. Open scratchpad items (2K chars)
2. Today's daily log tail (3K chars)
3. BM25 search results from user prompt (2.5K chars)
4. MEMORY.md middle-truncated (4K chars)
5. Yesterday's daily log tail (3K chars)

Injection is gated by `memory.auto_inject` in config. The memory context is built from scratchpad + daily logs + backend search results, then prepended to the user message before it reaches the LLM.

## Vault Directories

Vault directories are paths to markdown/PDF knowledge bases that the bot can search.

- Configured via `vault_directories` in config.yaml (array of absolute paths)
- Also settable via `VAULT_DIRECTORIES` env var (colon-separated on Unix, semicolon on Windows)
- In persistent mode, `qmd index` is called on each vault directory at startup
- In ephemeral mode, vault files are scanned and indexed into BM25 at runtime
- The `tele-kb-bot index` CLI command triggers indexing manually

## LRU Cache

Search results are cached in an LRU (Least Recently Used) cache to avoid redundant queries:

- `memory.cache.max_entries` — max number of cached queries (default: 100)
- `memory.cache.max_size_bytes` — max total cache size in bytes (default: 100 MB)
- Eviction: when either limit is exceeded, least recently used entries are evicted first
- Size validation in setup uses human-readable formats ("500MB", "2GB")

## Setup Idempotency

The `tele-kb-bot setup` command is idempotent:
- Re-running setup preserves existing values unless explicitly changed
- Each field shows its current value as the default
- Pressing Enter keeps the existing value unchanged
- Users can incrementally update individual settings without losing others

### Related Decisions

- [ADR-0004](0004-pi-sdk-integration.md): pi SDK integration — memory tools (memory_write, memory_read, scratchpad, memory_search) are registered as compiled-in extension factories
- [ADR-0002](0002-config-directory-and-schema.md): Config directory — memory files live under `<config_dir>/memory/`
