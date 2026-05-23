# Configuration Reference

All configuration options for `tele-kb-bot`.

## Config File Path

The default config directory is `~/.config/tele-kb-bot/`. Override it with the `TELE_KB_BOT_CONFIG` environment variable or the `--config` CLI flag.

The main config file is `config.yaml` inside the config directory. The setup wizard (`tele-kb-bot setup`) creates this file with `0600` permissions.

## Full YAML Schema

```yaml
# ─── Telegram ───────────────────────────────────────────────────────
telegram:
  # Telegram bot token from @BotFather (required).
  # Example: "123456789:AAF..."
  bot_token: string

  # Numeric Telegram user IDs allowed to talk to this bot (required).
  # Find your ID via @userinfobot on Telegram.
  # Example: [123456789, 987654321]
  allowed_user_ids: number[]

# ─── LLM Provider ───────────────────────────────────────────────────
llm:
  # LLM provider name. Default: "opencode-go"
  # The pi SDK has OpenCode Go built in — no extra setup needed.
  provider: string

  # Model identifier for the provider. Default: "deepseek-v4-flash"
  model: string

  # Reasoning effort level. Default: "high"
  # Controls how much the model thinks before responding.
  # Valid: "off" | "low" | "medium" | "high"
  reasoning: "off" | "low" | "medium" | "high"

  # LLM API key (optional).
  # Can also be set via OPENER_GO_API_KEY env var.
  # Stored separately in agents/auth.json with 0600 permissions.
  api_key: string

# ─── Memory / Knowledge Base ────────────────────────────────────────
memory:
  # Enable the memory/knowledge base system. Default: true
  enabled: boolean

  # Memory backend mode. Default: "ephemeral"
  #   ephemeral  — BM25 in-memory index over memory/ directory markdown files.
  #                Index lost on restart; rebuilt from MEMORY.md + daily logs.
  #   persistent — qmd on-disk search index over vault directories.
  #                Survives restarts; requires the qmd binary.
  mode: "ephemeral" | "persistent"

  # Automatically inject memory context into every prompt. Default: true
  # When enabled, search results + scratchpad + MEMORY.md content are
  # prepended to each user message so the agent has relevant context.
  auto_inject: boolean

  # Search configuration
  search:
    # Maximum search results to return per query. Default: 5
    max_results: number

    # Search mode. Default: "keyword"
    #   keyword  — BM25 keyword search (fast, exact terms)
    #   semantic — vector/semantic search (requires qmd binary with vector support)
    mode: "keyword" | "semantic"

  # LRU cache for search query results
  cache:
    # Maximum number of cached query results. Default: 100
    max_entries: number

    # Maximum total cache size in bytes. Default: 104857600 (100 MB)
    max_size_bytes: number

  # qmd search engine configuration
  qmd:
    # Enable qmd-based search. Default: false
    # Set to true when mode is "persistent"
    enabled: boolean

    # Path to the qmd binary. Default: "qmd"
    # Can also be set via QMD_BINARY_PATH env var.
    binary_path: string

# ─── Bot Behaviour ───────────────────────────────────────────────────
bot:
  # Maximum file attachments the agent can send per turn. Default: 10
  max_attachments_per_turn: number

  # Show a streaming preview (typing indicator) while the agent thinks.
  # Default: true
  streaming_preview: boolean

  # Maximum characters per Telegram message chunk. Default: 4096
  # Telegram has a 4096-byte limit per message; this controls the split
  # point for long responses.
  text_chunk_size: number

  # Maximum concurrent LLM sessions across Telegram chats. Default: 5
  # When exceeded, the least-recently-used session is evicted.
  # Can be overridden via TELEGRAM_BOT_MAX_SESSIONS env var.
  max_sessions: number

# ─── Filesystem Vaults ──────────────────────────────────────────────
# Directories containing markdown/PDF knowledge files to search.
# These are the Obsidian vaults or any markdown document directories.
# Example: ["/Users/me/Obsidian/Main", "/Users/me/Obsidian/Work"]
vault_directories: string[]

# ─── System Prompt Override ─────────────────────────────────────────
# Override the default read-only system prompt.
# Omit or leave empty to use the built-in default prompt.
# WARNING: Overriding the system prompt bypasses the read-only
# restriction. Only set this if you understand the security implications.
system_prompt: string
```

## Environment Variables

Environment variables override config file values at process start time. They take precedence over the file but do **not** modify the file on disk.

| Variable                     | Overrides                   | Description                                       |
|------------------------------|-----------------------------|---------------------------------------------------|
| `TELE_KB_BOT_CONFIG`         | Config directory            | Default: `~/.config/tele-kb-bot/`                 |
| `TELEGRAM_BOT_TOKEN`         | `telegram.bot_token`        | Bot token (for non-interactive setup, CI)         |
| `TELEGRAM_ALLOWED_USER_IDS`  | `telegram.allowed_user_ids` | Comma-separated Telegram user IDs                 |
| `OPENER_GO_API_KEY`          | `llm.api_key`               | LLM provider API key                              |
| `VAULT_DIRECTORIES`          | `vault_directories`         | Colon-separated vault directory paths             |
| `QMD_BINARY_PATH`            | `memory.qmd.binary_path`    | Path to the qmd binary                            |
| `TELEGRAM_BOT_MAX_SESSIONS`  | `bot.max_sessions`          | Max concurrent LLM sessions                       |
| `LOG_LEVEL`                  | Log level                   | `fatal`, `error`, `warn`, `info`, `debug`, `trace` |

!!! note

    Environment variables override the config file at **process start only**. If you change an env var while the bot is running, you must restart the daemon for the change to take effect.

## File Locations

| Path                                                    | Purpose                         | Permissions |
|---------------------------------------------------------|---------------------------------|-------------|
| `~/.config/tele-kb-bot/`                                | Config directory (root)         | `0700`      |
| `~/.config/tele-kb-bot/config.yaml`                     | User-facing configuration       | `0600`      |
| `~/.config/tele-kb-bot/agents/`                         | Agent directory                 | `0700`      |
| `~/.config/tele-kb-bot/agents/auth.json`                | LLM provider API keys           | `0600`      |
| `~/.config/tele-kb-bot/agents/models.json`              | Model registry definitions      | `0644`      |
| `~/.config/tele-kb-bot/agents/sessions/`                | Session persistence (JSONL)     | `0700`      |
| `~/.config/tele-kb-bot/memory/`                         | Knowledge base (markdown files) | `0700`      |
| `~/.config/tele-kb-bot/memory/MEMORY.md`                | Long-term memory storage        | `0644`      |
| `~/.config/tele-kb-bot/memory/SCRATCHPAD.md`            | Session scratchpad checklist    | `0644`      |
| `~/.config/tele-kb-bot/memory/daily/`                   | Daily activity logs             | `0700`      |
| `~/.config/tele-kb-bot/telegram-tmp/`                   | Downloaded media (auto-cleaned) | `0700`      |
| `~/.config/tele-kb-bot/logs/`                           | Log output directory            | `0700`      |
| `~/.config/tele-kb-bot/logs/bot.log`                    | Structured daemon logs (rotated)| `0644`      |
| `~/.config/tele-kb-bot/logs/out.log`                    | launchd stdout                  | `0644`      |
| `~/.config/tele-kb-bot/logs/err.log`                    | launchd stderr                  | `0644`      |
| `~/Library/LaunchAgents/com.tele-kb-bot.plist`          | launchd service plist           | `0644`      |

## Security

- Config directory permissions: `0700` (user-only rwx)
- Config file permissions: `0600` (user-only read/write)
- Auth file permissions: `0600`
- The compiled binary contains **zero secrets** — all keys loaded at runtime
- API keys are redacted in logs (`***redacted***`)
- The agent has **no shell execution** or filesystem modification capabilities (see [security reference](security.md))

!!! note "Secrets in the config file"

    The `llm.api_key` field exists in `config.yaml` for convenience, but setup stores it in `agents/auth.json` by default. If you do put an API key in `config.yaml`, ensure the file permissions remain `0600`. For environments with shared home directories (CI, servers), prefer the `OPENER_GO_API_KEY` environment variable.
