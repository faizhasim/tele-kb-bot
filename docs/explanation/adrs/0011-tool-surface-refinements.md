---
status: accepted
date: 2026-05-25
decision-makers: Mohd Faiz Hasim
---

# Tool Surface Refinements — Remove telegram_attach, Feature Flag Search Tools

## Context and Problem Statement

After deploying tele-kb-bot with the restricted tool surface (ADR-0009), we observed two problems:

1. **`telegram_attach` never worked** — This tool was meant to queue files for Telegram attachment after the agent turn. In practice, the agent never used it effectively, and the file-attachment mechanism was unreliable. There are better mechanisms for capturing notes and documents (directly via Obsidian, email, or the Obsidian mobile app).

2. **`memory_search`/`memory_read` caused search loops** — The agent repeatedly called these tools instead of answering from the already-injected search results (`auto_inject`). With reasoning modes, the agent would search 8+ times per turn, consuming the full 120s timeout without ever producing a response.

3. **`auto_inject` already covers the search need** — The app-level search (running before the agent wakes up) provides relevant results injected directly into the prompt. The agent does not need to search — it just reads what's provided.

## Decision Drivers

- **Faster responses** — Eliminating unnecessary tool calls reduces turn time from 120s+ to seconds
- **Reliability** — `auto_inject` search always runs; agent-driven search may loop or time out
- **Simplicity** — Fewer agent tools means fewer failure modes and a simpler system prompt
- **Human-in-the-loop** — Users guide the conversation with follow-up questions, which trigger fresh auto_inject searches
- **Future-proofing** — Search tools remain available behind a config flag for users who need agent-driven search

## Considered Options

1. **Remove telegram_attach entirely; hide memory_search/memory_read behind feature flag** (chosen)
2. **Keep all tools but update system prompt** — Already tried, agent still looped
3. **Remove all search tools permanently** — Too restrictive; some users may want agent-driven search

## Decision Outcome

Chosen option: **Option 1** — Remove `telegram_attach`, gate `memory_search`/`memory_read` behind `memory.search_tools_enabled: false` (default off).

### Consequences

- Good, because the agent now has only 2 tools: `memory_write` and `scratchpad` — no way to enter a search loop
- Good, because `auto_inject` still provides relevant search results on every message
- Good, because users who need agent-driven search can enable it via config flag
- Good, because `telegram_attach` dead code is removed
- Neutral, because the agent cannot do ad-hoc searches if `auto_inject` results are insufficient (user must rephrase)
- Good, because the agent responds within seconds instead of timing out at 120s+

### Implementation

1. **`src/pi/extensions.ts`** — Removed `createTelegramAttachExtension()` entirely. `createExtensionFactories()` accepts `searchToolsEnabled` boolean. When false (default), only `memory_write` and `scratchpad` are registered. When true, `memory_read` and `memory_search` are also registered.

2. **`src/config/schema.ts`** — Added `memory.search_tools_enabled: S.optional(S.Boolean)`.

3. **`src/config/defaults.ts`** — Default value: `false`.

4. **`src/pi/session-factory.ts`** — Passes `config.memory.search_tools_enabled ?? false` to `createExtensionFactories()`.

5. **`src/constants/system-prompt.ts`** — Updated to explain that relevant memories are auto-injected, and the agent does not need to search.

6. **`src/daemon/bot.ts`** — Timeout increased from 120s → 300s. Progressive streaming added so users see intermediate text.

## Related Decisions

- [ADR-0009](0009-tool-surface-restriction.md) — Agent Tool Surface Restriction (`noTools: "builtin"`)
- [ADR-0006](0006-memory-system-design.md) — Memory System (auto_inject, memory search)
