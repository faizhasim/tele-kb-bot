# Security Model

tele-kb-bot is designed as a **read-only knowledge base assistant** with a restricted tool surface. Its security model prioritises preventing credential leakage and unauthorised access over general-purpose agent capabilities.

## Zero Secrets in the Binary

The compiled binary contains **no secrets**. All sensitive values are loaded at runtime from:

- **Config file** (`config.yaml`, `0600` permissions): Telegram bot token, allowed user IDs
- **Auth file** (`agents/auth.json`, `0600` permissions): LLM provider API keys
- **Environment variables**: override config file values without modifying disk

This means the binary can be distributed via Homebrew, shared, or inspected without risk of credential leakage. CI/CD pipelines and release artifacts never embed secrets.

## File Permissions

All config directory structures are created with strict permissions:

| Path                                | Permission | Owner            | Purpose                     |
|-------------------------------------|------------|------------------|-----------------------------|
| `~/.config/tele-kb-bot/`            | `0700`     | `drwx------`     | Config directory root       |
| `~/.config/tele-kb-bot/config.yaml` | `0600`     | `-rw-------`     | Bot token + settings        |
| `~/.config/tele-kb-bot/agents/`     | `0700`     | `drwx------`     | Agent data directory        |
| `~/.config/tele-kb-bot/agents/auth.json` | `0600` | `-rw-------`  | LLM API keys                |
| `~/.config/tele-kb-bot/agents/sessions/` | `0700` | `drwx------` | Session persistence files  |
| `~/.config/tele-kb-bot/memory/`     | `0700`     | `drwx------`     | Knowledge base directory    |
| `~/.config/tele-kb-bot/telegram-tmp/` | `0700`   | `drwx------`     | Downloaded media (auto-cleaned) |
| `~/.config/tele-kb-bot/logs/`      | `0700`     | `drwx------`     | Log directory               |

The setup wizard (`tele-kb-bot setup`) applies these permissions automatically when creating the directory structure.

## User Whitelist

The bot only responds to messages from Telegram user IDs listed in `telegram.allowed_user_ids`. This is enforced at the handler layer before any processing occurs. Unauthorised messages are silently ignored — no error response, no logging of message content.

## API Key Redaction in Logs

All log output passes through Pino's redaction engine. Any value at these paths is replaced with `***redacted***` before being written to stdout, log files, or the launchd log streams:

- `*.bot_token`
- `*.api_key`
- `*.token`
- `*.secret`

> For implementation details, see [ADR-0002](../explanation/adrs/0002-config-directory-and-schema.md).

## Agent Tool Surface Restriction

Following [ADR-0009](../explanation/adrs/0009-tool-surface-restriction.md), the pi SDK's default built-in tools are disabled. The agent has **no shell execution** and **no arbitrary filesystem access**.

### Removed Tools

These pi SDK default tools are **not available** to the agent:

- `bash` — arbitrary shell execution
- `edit` — file modification
- `write` — file creation
- `read` — arbitrary file reading
- `grep` — content search across filesystem
- `find` — filesystem enumeration
- `ls` — directory listing

### Allowed Tools

After restriction, the agent has access to exactly five compiled-in extension tools:

| Tool                 | Purpose                                              |
|----------------------|------------------------------------------------------|
| `telegram_attach`    | Queue file paths to send as Telegram attachments     |
| `memory_write`       | Append content to MEMORY.md (memory directory only)  |
| `memory_read`        | Search and read from the knowledge base              |
| `memory_search`      | Full-text search against the knowledge base backend  |
| `scratchpad`         | Manage a persistent checklist (SCRATCHPAD.md)        |

### Scope Boundaries

- **`memory_write`**: Writes only to `<config_dir>/memory/MEMORY.md`. Cannot write outside this directory.
- **`memory_read`** and **`memory_search`**: Read from the configured memory backend (BM25 in-memory index or qmd). Results may include file paths from vault directories, but the agent cannot read those files directly — it only receives pre-computed snippets.
- **`telegram_attach`**: Queues file paths provided by the memory search tools for Telegram attachment. The agent cannot read arbitrary files.
- **`scratchpad`**: Reads and writes only `<config_dir>/memory/SCRATCHPAD.md`.
