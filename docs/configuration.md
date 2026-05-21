# Configuration Reference

All config options for `tele-kb-bot`.

## Config File

Path: `~/.config/tele-kb-bot/config.yaml` (override with `TELE_KB_BOT_CONFIG`)

## Schema

```yaml
# ─── Telegram ──────────────────────────────
telegram:
  bot_token: string          # from @BotFather (required)
  allowed_user_ids: number[] # Telegram user IDs (required)

# ─── LLM ───────────────────────────────────
llm:
  provider: string           # default: "opencode-go"
  model: string              # default: "deepseek-v4-flash"
  reasoning: "off" | "low" | "medium" | "high"  # default: "high"
  api_key: string            # optional, can use OPENER_GO_API_KEY env var

# ─── Memory ────────────────────────────────
memory:
  enabled: boolean           # default: true
  auto_inject: boolean       # default: true
  search:
    max_results: number      # default: 5
    mode: "keyword" | "semantic"  # default: "keyword" (semantic needs qmd binary)

# ─── Bot ───────────────────────────────────
bot:
  max_attachments_per_turn: number  # default: 10
  streaming_preview: boolean        # default: true
  text_chunk_size: number           # default: 4096
```

## Environment Variables

| Variable                    | Overrides                   | Notes                                  |
| --------------------------- | --------------------------- | -------------------------------------- |
| `TELE_KB_BOT_CONFIG`        | Config directory            | Default: `~/.config/tele-kb-bot/`      |
| `TELEGRAM_BOT_TOKEN`        | `telegram.bot_token`        | For non-interactive setup              |
| `TELEGRAM_ALLOWED_USER_IDS` | `telegram.allowed_user_ids` | Comma-separated                        |
| `OPENER_GO_API_KEY`         | `llm.api_key`               | LLM provider API key                   |
| `LOG_LEVEL`                 | Log level                   | fatal, error, warn, info, debug, trace |

## File Locations

| Path                                           | Purpose                         |
| ---------------------------------------------- | ------------------------------- |
| `~/.config/tele-kb-bot/config.yaml`            | User-facing config              |
| `~/.config/tele-kb-bot/agents/auth.json`       | API keys (0600)                 |
| `~/.config/tele-kb-bot/agents/models.json`     | Model definitions               |
| `~/.config/tele-kb-bot/agents/sessions/`       | Session persistence (JSONL)     |
| `~/.config/tele-kb-bot/memory/`                | Knowledge base (markdown)       |
| `~/.config/tele-kb-bot/telegram-tmp/`          | Downloaded files (auto-cleaned) |
| `~/Library/LaunchAgents/com.tele-kb-bot.plist` | launchd service                 |

## Security

- Config file permissions: `0600` (user-only read/write)
- Auth file permissions: `0600`
- Config directory: `0700`
- The compiled binary contains **zero** secrets — all keys loaded at runtime
- API keys are redacted in logs (`***redacted***`)
