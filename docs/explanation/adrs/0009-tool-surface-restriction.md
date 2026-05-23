---
status: accepted
date: 2026-05-23
decision-makers: Mohd Faiz Hasim
---

# Agent Tool Surface Restriction

## Context and Problem Statement

tele-kb-bot was designed as a **read-only knowledge base assistant**. The system prompt tells the agent: *"Your role is strictly read-only. You must NOT write, edit, or delete any files."* The ADR-0004 integration description states "compiled-in extensions" with only `telegram_attach`, `memory_write`, `memory_read`, `scratchpad`, and `memory_search` tools.

However, a security audit revealed a gap: the pi SDK registers **bash, edit, and write** as default built-in tools whenever `createAgentSession()` or `createAgentSessionFromServices()` is called without explicit tool restrictions. tele-kb-bot's `session-factory.ts` never passes `tools`, `noTools`, or `customTools`, so the agent has access to full shell execution (`bash`) and file modification (`edit`, `write`) — the system prompt is purely advisory, not enforced.

Separately, the bot's actual use case has clarified: it is a personal bot that searches an Obsidian vault via qmd and returns Obsidian URIs. It does not need shell access, file editing, or general-purpose agent capabilities.

We need to decide how to close this security gap and whether the pi SDK AgentSession is the right abstraction for this use case.

## Decision Drivers

- **No shell execution** — the agent must not be able to run arbitrary bash commands
- **No file modification** — the agent must not write, edit, or delete files outside its memory directory
- **Keep qmd search** — the ability to search Obsidian notes and return URIs is the core feature
- **Minimal maintenance burden** — code should match the actual scope of the project
- **Personal use** — the bot serves one user; operational complexity should be near zero

## Considered Options

1. **Restrict tools at pi SDK level** — Pass `noTools: "builtin"` or `tools: []` to `createAgentSessionFromServices()`, keeping the AgentSession but removing bash/edit/write
2. **Eliminate pi SDK, use direct bot** — Replace AgentSession with a direct GrammY handler that calls qmd (MCP client or CLI) and optionally formats results via a raw LLM completion call
3. **Eliminate pi SDK and LLM** — Direct bot with qmd search only, no LLM involvement

## Decision Outcome

Chosen option: **Restrict tools at pi SDK level** (Option 1), because it closes the security gap with minimal code changes while keeping the existing LLM provider integration (auth, model registry, settings) and conversation flow intact. The existing `memory_search` extension already wraps qmd search — no new search tool is needed.

### Consequences

- Good, because bash/edit/write tools are removed from the agent in a 2-line code change in `session-factory.ts`
- Good, because the system prompt and actual tool surface are now consistent
- Good, because the existing `memory_search` + `memory_read` extensions cover the qmd search flow
- Good, because no dependencies change — the binary size and startup time are unaffected
- Bad, because the pi SDK still carries the code for bash/edit/write in the compiled binary (they are just not registered with the session)
- Neutral, because the AgentSession still provides session management, compaction, and conversation history that the qmd-only use case does not need

## Pros and Cons of the Options

### Option 1: Restrict tools at pi SDK level

Pass `noTools: "builtin"` to `createAgentSessionFromServices()`. The AgentSession retains extension tools (memory_search, telegram_attach, etc.) but removes bash, edit, write, grep, find, ls from the agent's registry.

- Good, because it's a minimal code change — 2 lines in one file
- Good, because all existing LLM provider configuration (auth.json, models.json) keeps working
- Good, because the existing memory extension tools handle qmd search through the same interface
- Good, because no test changes needed — the existing tests mock the pi SDK layer
- Bad, because the pi SDK's session management, compaction, and skill system remain unused overhead
- Bad, because the binary still compiles in the full pi SDK (reducing this requires Option 2 or 3)

### Option 2: Eliminate pi SDK, use direct bot

Replace AgentSession with a direct GrammY handler. Search qmd via MCP client or CLI subprocess. Optionally format results via a raw HTTP call to an LLM provider (no agent framework, no tool surface).

- Good, because the only dependency left is GrammY — zero agent framework, zero tool surface
- Good, because the binary shrinks significantly (pi SDK is the largest dependency)
- Good, because the security model is trivially verifiable — there are no agent tools at all
- Bad, because it requires rewriting `session-factory.ts`, `extensions.ts`, `session-registry.ts`, and the handler
- Bad, because LLM provider integration (auth, model selection, retry) must be re-implemented
- Bad, because tests for the removed modules need to be rewritten or removed

### Option 3: Eliminate pi SDK and LLM

Direct bot with GrammY, search qmd, format results as plain markdown, reply. No LLM call at all.

- Good, because the code path is shortest and most predictable
- Good, because there are zero API keys to manage — qmd is a local binary
- Good, because latency is lowest and there is no per-turn cost
- Neutral, because the bot loses natural language understanding — search is purely keyword-based
- Bad, because the user loses the ability to ask conversational follow-ups or have results interpreted

## More Information

### Discovery

The gap was found by tracing `createAgentSession()` in the pi SDK (`node_modules/@mariozechner/pi-coding-agent/dist/core/sdk.js`):

```javascript
// Line ~140 in sdk.js — runs when tools/noTools are not specified
const defaultActiveToolNames = ["read", "bash", "edit", "write"];
```

tele-kb-bot's `session-factory.ts` calls `createAgentSessionFromServices()` with none of `tools`, `noTools`, or `customTools`, so the default tool list is used.

### Tool Surface After Restriction

After `noTools: "builtin"`, the agent only has access to:

| Tool | Source | Purpose |
|------|--------|---------|
| `telegram_attach` | Compiled extension | Queue files for Telegram attachment |
| `memory_write` | Compiled extension | Write to MEMORY.md (memory dir only) |
| `memory_read` | Compiled extension | Read from MEMORY.md |
| `scratchpad` | Compiled extension | Manage checklist |
| `memory_search` | Compiled extension | Search via BM25 or qmd |

No shell execution (`bash`). No file writing outside the memory directory (`edit`, `write`). No arbitrary file reading (`read`, `grep`, `find`, `ls`).

### Implementation Plan

1. In `src/pi/session-factory.ts`, add `noTools: "builtin"` to the `createAgentSessionFromServices()` call
2. Update the system prompt in `src/constants/system-prompt.ts` to remove claims about "bash, read, grep, find" access — the agent only has memory tools
3. In `src/memory/qmd.ts`, set `QMD_FORCE_CPU=1` in the child process environment for all qmd CLI invocations, preventing Metal GPU crashes on macOS
4. Run all tests to verify no breakage
5. Run `bun run format && bun run lint:fix` before completion
### Session Pool Limit

The session registry now enforces a hard cap on concurrent AgentSessions via `config.bot.max_sessions` (default 5). When `getOrCreate` is called and the pool is at capacity, the least-recently-used session is evicted before creating the new one. This prevents unbounded memory growth from concurrent chats while maintaining responsiveness for the active user.

The pool limit is an advanced setting — the setup wizard writes the default (`5`) to config.yaml without prompting. Users change it by editing config.yaml directly or setting `TELEGRAM_BOT_MAX_SESSIONS` env var.

This sits alongside the existing 30-minute idle eviction (sweep-based): the pool limit catches bursts, idle eviction cleans up stale sessions.
### Future Consideration

If the pi SDK's unused overhead becomes an issue (binary size, update frequency), Option 2 remains viable as a future refactor. The tool restriction here is the minimum-viable security fix.

### Related Decisions

- [ADR-0004](0004-pi-sdk-integration.md): pi SDK Integration — defines how `createAgentSessionFromServices()` is used, which is where the tool restriction must be applied
- [ADR-0006](0006-memory-system-design.md): Memory System — memory search extensions remain the agent's primary tool after restriction
