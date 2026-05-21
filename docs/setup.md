# Setup Guide

First-time setup for tele-kb-bot.

## Prerequisites

1. A Telegram bot token from [@BotFather](https://t.me/BotFather)
2. An [OpenCode Go](https://opencode.ai/go) subscription — the pi SDK has it built-in, you just need the API key
3. macOS with Homebrew installed

## Step-by-Step

### 1. Install

```bash
brew tap faizhasim/tele-kb-bot
brew install tele-kb-bot
```

### 2. Create a Telegram Bot

1. Open Telegram and chat with [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:AAF...`)
4. Find your Telegram user ID (send `/id` to [@userinfobot](https://t.me/userinfobot))

### 3. Run Setup

```bash
tele-kb-bot setup
```

The wizard will prompt for:

- Telegram bot token
- Allowed user IDs (your Telegram user ID)
- LLM API key (optional — can use `OPENER_GO_API_KEY` env var instead)

The API key is stored in `~/.config/tele-kb-bot/agents/auth.json`. The pi SDK has OpenCode Go built-in — no extra provider configuration needed.

### 4. Verify

```bash
tele-kb-bot status
```

Should show your bot name and config status.

### 5. Install as a Service

```bash
tele-kb-bot install
```

This creates a launchd plist at `~/Library/LaunchAgents/com.tele-kb-bot.plist`. The bot will:

- Start automatically on login
- Restart if it crashes
- Log to `~/.config/tele-kb-bot/logs/`

### 6. Start

```bash
tele-kb-bot start
```

Or let launchd manage it after reboot.

## Non-Interactive Setup

For Nix users, CI, or scripting:

```bash
TELEGRAM_BOT_TOKEN=xxx \
TELEGRAM_ALLOWED_USER_IDS=111,222 \
OPENER_GO_API_KEY=sk-... \
tele-kb-bot setup --non-interactive
```

## Troubleshooting

| Problem                          | Solution                                         |
| -------------------------------- | ------------------------------------------------ |
| `tele-kb-bot: command not found` | Ensure `/opt/homebrew/bin` is in PATH            |
| Bot doesn't respond              | Check `tele-kb-bot status`, verify token         |
| Config validation errors         | Check `~/.config/tele-kb-bot/config.yaml` syntax |
| Launchd service not running      | `launchctl list \| grep tele-kb-bot`             |
| View logs                        | `tail -f ~/.config/tele-kb-bot/logs/out.log`     |
