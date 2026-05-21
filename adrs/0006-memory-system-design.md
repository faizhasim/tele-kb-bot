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

- Zero external dependencies — must work without internet or services
- Human-readable files — markdown is git-friendly, editable by hand
- Context injection must be additive — never replace or truncate the LLM's system prompt
- BM25 search in pure TypeScript — no native modules
- qmd support must be optional — if binary not in PATH, degrade gracefully

## Considered Options

- **Plain markdown + pure-TypeScript BM25** — human-readable files, built-in search
- **SQLite + FTS5** — fast search, structured storage, but opaque binary files
- **Vector database (qmd, Chroma, etc.)** — semantic search, but requires native deps
- **JSON-based memory** — structured, machine-friendly, less human-readable

## Decision Outcome

Chosen option: **Plain markdown + pure-TypeScript BM25**, because:

- Markdown files are human-readable, git-friendly, and easy to backup
- Pure-TypeScript BM25 has zero dependencies and works in `bun build --compile`
- qmd integration is gated behind `which qmd` check — degrades to BM25 if missing
- File layout follows pi-memory patterns (adapted from MIT-licensed reference)

### Consequences

- Good, because memory files are portable and editable by hand
- Good, because BM25 is well-understood, testable, and has no native deps
- Bad, because BM25 is limited to keyword matching — no semantic understanding without qmd
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

### Related Decisions

- [ADR-0004](0004-pi-sdk-integration.md): pi SDK integration — memory tools (memory_write, memory_read, scratchpad, memory_search) are registered as compiled-in extension factories
- [ADR-0002](0002-config-directory-and-schema.md): Config directory — memory files live under `<config_dir>/memory/`
