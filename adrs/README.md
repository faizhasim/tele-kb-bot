# Architecture Decision Records

This directory contains ADRs for tele-kb-bot, following the MADR format.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-use-architectural-decision-records.md) | Use Markdown Architectural Decision Records (MADR) | Accepted | 2026-05-21 |
| [0002](0002-config-directory-and-schema.md) | Config Directory Location and Schema | Accepted | 2026-05-21 |
| [0003](0003-cli-command-structure.md) | CLI Command Structure and Design | Accepted | 2026-05-21 |
| [0004](0004-pi-sdk-integration.md) | pi SDK Integration Architecture | Accepted | 2026-05-21 |
| [0005](0005-telegram-bot-design.md) | Telegram Bot Design and Message Flow | Accepted | 2026-05-21 |
| [0006](0006-memory-system-design.md) | Memory System Design | Accepted | 2026-05-21 |
| [0007](0007-distribution-strategy-homebrew.md) | Distribution Strategy — Homebrew Tap | Accepted | 2026-05-21 |
| [0008](0008-use-html-over-markdownv2.md) | Use HTML parse_mode over MarkdownV2 for Telegram Messages | Accepted | 2026-05-21 |
| [0009](0009-tool-surface-restriction.md) | Agent Tool Surface Restriction | Accepted | 2026-05-23 |

## Decision Graph

```
ADR-0002 (Config)
  ├──→ ADR-0004 (pi SDK) — agent state uses config directory
  └──→ ADR-0007 (Distribution) — zero-secrets model enables public tap

ADR-0004 (pi SDK)
  ├──→ ADR-0005 (Telegram) — session registry manages per-chat sessions
  └──→ ADR-0006 (Memory) — memory tools are compiled-in extension factories

ADR-0005 (Telegram) → ADR-0004 (pi SDK) — messages dispatch to AgentSessions
ADR-0006 (Memory) → ADR-0004 (pi SDK) — registered as extension factories
ADR-0007 (Distribution) → ADR-0005 (Telegram) — distributes the bot
ADR-0008 (HTML over MarkdownV2) → ADR-0005 (Telegram) — sendMessage parse mode
```

## Creating a New ADR

1. Copy `adr-template.md` to `NNNN-title-with-dashes.md`
2. Fill in context, decision drivers, considered options, outcome, consequences
3. Link related ADRs in a "Related Decisions" section
4. Update this index after acceptance
