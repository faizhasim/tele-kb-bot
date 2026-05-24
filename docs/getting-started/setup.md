# Setup Guide

By the end of this guide, you'll have a running Telegram bot that can chat with an LLM.

## Prerequisites

- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An [OpenCode Go](https://opencode.ai/go) API key
- macOS with [Homebrew](https://brew.sh)

## Install

```bash
brew tap faizhasim/tele-kb-bot https://github.com/faizhasim/tele-kb-bot.git
brew install tele-kb-bot
```

Verify:

```bash
tele-kb-bot version
```

## Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts.
3. Copy the bot token (looks like `123456789:AAF...`).
4. Find your Telegram user ID: message [@userinfobot](https://t.me/userinfobot) and send `/id`.

!!! warning "Keep your token secret"
    Anyone with your bot token can control your bot. Never commit it to version control.

## Run Setup

```bash
tele-kb-bot setup
```

The wizard will prompt for your bot token, allowed user IDs, and API key.

## Verify

```bash
tele-kb-bot status
```

Expected output:

```
  tele-kb-bot v0.1.0
  ========================================

  Binary information:
    Path:    /opt/homebrew/bin/tele-kb-bot
    Version: 0.1.0

  Config directory:
    Path: /Users/you/.config/tele-kb-bot
    agents            ✓
    memory            ✓
    logs              ✓
    telegram-tmp      ✓

  Config file:
    ✓ /Users/you/.config/tele-kb-bot/config.yaml
    ✓ Config valid
      Provider: opencode-go/deepseek-v4-flash
      Reasoning: high
      Allowed users: 111111111
      Memory: enabled

  Telegram bot status:
    ✓ Connected as: YourBot (@your_bot)
```


## Start

```bash
tele-kb-bot start
```

Message your bot on Telegram. It should reply.

!!! tip "Want to run 24/7?"
    After verifying, run `tele-kb-bot install-launchd` to set up automatic restart on login and crashes.

---

## Non-Interactive Setup

For scripting, CI, or Nix setups, pass everything via environment variables:

```bash
TELEGRAM_BOT_TOKEN=xxx \
TELEGRAM_ALLOWED_USER_IDS=111,222 \
OPENER_GO_API_KEY=sk-... \
tele-kb-bot setup --non-interactive
```

### Supported Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | Yes |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated Telegram user IDs | Yes |
| `OPENER_GO_API_KEY` | LLM provider API key | No |
| `LOG_LEVEL` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` | No |
| `TELE_KB_BOT_CONFIG` | Override config directory | No |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `tele-kb-bot: command not found` | Add `/opt/homebrew/bin` to your `PATH`. |
 Bot doesn't respond | Run `tele-kb-bot status` — verify the bot name appears.
| Config validation errors | Check `~/.config/tele-kb-bot/config.yaml` for YAML syntax. |
 View logs | `tail -f ~/.config/tele-kb-bot/logs/bot.log`
