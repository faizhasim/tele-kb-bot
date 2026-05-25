---
status: accepted
date: 2026-05-21
decision-makers: faizhasim
---

# pi SDK Integration Architecture

## Context and Problem Statement

tele-kb-bot needs to create isolated pi `AgentSession` instances per Telegram chat, configured to use the tele-kb-bot config directory instead of `~/.pi/`. How should we integrate the pi SDK to achieve complete isolation, compiled-in extensions, and programmatic path control?

The pi SDK provides multiple integration layers — a high-level `createAgentSession()` wrapper and lower-level `createAgentSessionServices()` + `createAgentSessionFromServices()` APIs. Additionally, extensions can be loaded from the filesystem or passed as compiled-in factories. The architecture must ensure zero reliance on `~/.pi/` or environment variables like `PI_CODING_AGENT_DIR`.

## Decision Drivers

- Complete isolation from `~/.pi/` — no environment variable dependence, no filesystem defaults
- Self-contained binary — all extensions (telegram_attach, memory tools) compiled in, never loaded from disk
- Per-chat session isolation with idle eviction — each Telegram user gets their own isolated session
- Programmatic path control — all paths (auth, models, sessions, settings) passed explicitly
- Minimal magic — every registration, event handler, and API call should be traceable in source

## Considered Options

- **`createAgentSession()` wrapper** — The high-level API that auto-resolves paths and defaults
- **`createAgentSessionServices()` + `createAgentSessionFromServices()`** — Lower-level API with explicit service creation and path passing
- **Filesystem extensions** — Extensions loaded from `<config_dir>/agents/extensions/` directory
- **Compiled-in extension factories** — Extensions passed as `ExtensionFactory[]` to `resourceLoaderOptions.extensionFactories`
- **Shared global session** — One AgentSession for all chats
- **Per-chat sessions with registry** — Dedicated AgentSession per chat, managed by a registry

## Decision Outcome

Chosen option: **`createAgentSessionServices()` + `createAgentSessionFromServices()`** with **compiled-in extension factories** and **per-chat session registry**, because these give full path control, eliminate filesystem dependencies for extensions, and provide isolation between chats.

### Consequences

- Good, because every path (agentDir, auth.json, models.json, sessions/) is passed programmatically — zero env var dependence
- Good, because all extensions are compiled into the binary — no extension directory to manage or ship
- Good, because per-chat sessions are isolated — one chat cannot see another's conversation or tools
- Good, because session registry provides idle eviction (30 min default) and lazy creation
- Bad, because compiled-in extensions require a rebuild to modify; no hot-reload for extension development
- Bad, because `createAgentSessionServices()` path is more verbose than the high-level wrapper

### Confirmation

The integration is confirmed by verifying that:

1. `AgentSession` uses `<config_dir>/agents/` for all state (`AuthStorage`, `ModelRegistry`, `SettingsManager`)
2. Running `tele-kb-bot start` does NOT read or write to `~/.pi/` or `$XDG_CONFIG_HOME/pi/`
3. Extensions (`telegram_attach`, memory tools) are registered and functional in the compiled binary
4. Each Telegram chat produces a separate JSONL session file under `<config_dir>/agents/sessions/`

## Pros and Cons of the Options

### `createAgentSession()` wrapper

The high-level convenience wrapper that auto-creates services from defaults.

- Good, because it's the simplest API — one function call creates everything
- Good, because it has built-in defaults for auth, models, settings, and session management
- Bad, because it auto-resolves `agentDir` from `~/.pi/agent` or `PI_CODING_AGENT_DIR` — we'd need to override this
- Bad, because it auto-discovers and loads extensions from the filesystem — we want compiled-in only
- Bad, because less control over the resource loader configuration

### `createAgentSessionServices()` + `createAgentSessionFromServices()`

The lower-level API that separates service creation from session creation.

- Good, because we pass `resourceLoaderOptions.extensionFactories` for compiled-in extensions
- Good, because we explicitly create `AuthStorage`, `ModelRegistry`, `SettingsManager` with our paths
- Good, because we control the `DefaultResourceLoader` configuration — no filesystem extension discovery
- Good, because service creation can be shared (same AuthStorage/ModelRegistry across all sessions)
- Bad, because the API is more verbose — requires understanding the service layer
- Bad, because we must manage the lifecycle of services ourselves

### Filesystem extensions

Extensions loaded from `<config_dir>/agents/extensions/` as separate `.ts`/`.js` files.

- Good, because extensions can be added without rebuilding the binary
- Good, because it matches pi's default extension loading model
- Bad, because adds a runtime dependency on the filesystem for extension loading
- Bad, because users would need to manage extension files alongside the binary
- Bad, because extension loading code adds complexity and potential failure points

### Compiled-in extension factories

Extensions passed as `ExtensionFactory[]` via `resourceLoaderOptions.extensionFactories`.

- Good, because the binary is fully self-contained — no extension files to ship or manage
- Good, because extension registration happens at compile time — no runtime discovery overhead
- Good, because TypeScript type checking catches extension interface mismatches at build time
- Bad, because modifying an extension requires a full rebuild
- Bad, because it's less familiar than the filesystem extension model

### Shared global session

One AgentSession for all Telegram chats.

- Good, because it's the simplest possible session model — no registry, no eviction
- Bad, because all chats share the same conversation history — cross-talk between users
- Bad, because memory tools and workspace state are shared — compromised isolation
- Bad, because a `/stop` from one user would abort responses for all users

### Per-chat sessions with registry

Dedicated AgentSession per chat, managed by a `SessionRegistry` with lazy creation and idle eviction.

- Good, because complete isolation between users — separate conversations, tools, and memory
- Good, because sessions are persisted to JSONL and survive restarts
- Good, because idle eviction frees memory (30 min default timeout)
- Neutral, because registry adds complexity for session lifecycle management
- Bad, because each session has its own AI context window — more memory usage than shared

## More Information

### Integration Flow

```
SessionRegistry (lazy per-chat)
  │
  ├── createAgentSessionServices({
  │     cwd: <workspace>,
  │     agentDir: <config_dir>/agents/,
  │     authStorage: AuthStorage.create(<config_dir>/agents/auth.json),
  │     modelRegistry: ModelRegistry.create(auth, <config_dir>/agents/models.json),
  │     settingsManager: SettingsManager.create(cwd, <config_dir>/agents/),
  │     resourceLoaderOptions: { extensionFactories: [telegramAttachFactory, memoryFactory] }
  │   })
  │
  └── createAgentSessionFromServices({
        services,
        sessionManager: SessionManager.create(<config_dir>/agents/sessions/),
        model: <resolved from registry>,
        thinkingLevel: "high",
        tools: [...],
        customTools: [...]
      })
```

### Extension Registration

Two compiled-in extension factories:

1. **`telegram_attach` tool** — Queues file paths for sending as Telegram attachments after the agent turn completes. Registered as a ToolDefinition with schema for file paths and captions.

2. **Memory tools** — `memory_write`, `memory_read`, `scratchpad`, `memory_search` tools that delegate to the memory module (`src/memory/`). Adapted from pi-memory concepts (MIT, credited in source).

### Provider Registration (Built-In)

Opcencode Go is a **built-in provider** in the pi SDK (`@mariozechner/pi-coding-agent` v0.73+). The SDK ships with 12 Opencode Go models (`deepseek-v4-flash`, `kimi-k2.6`, etc.) pre-configured with the correct API type (`openai-completions`) and base URL (`https://opencode.ai/zen/go/v1`).

No custom `registerProvider` call is needed. The API key is resolved from `auth.json` (written by `tele-kb-bot setup`) automatically via the `AuthStorage` linked to the `ModelRegistry`.

For reference, the built-in definition is equivalent to:

```typescript
// Built-in — not called manually
modelRegistry.registerProvider("opencode-go", {
  baseUrl: "https://opencode.ai/zen/go/v1",
  api: "openai-completions",
  models: [
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    },
  ],
});
```

### Related Decisions

- [ADR-0002](0002-config-directory-and-schema.md): Config directory — defines `<config_dir>/agents/` structure used by AuthStorage, ModelRegistry, SettingsManager
- [ADR-0005](0005-telegram-bot-design.md): Telegram bot design — SessionRegistry manages per-chat sessions created by this integration
- [ADR-0006](0006-memory-system-design.md): Memory system — memory tools are registered as compiled-in extension factories via this architecture
