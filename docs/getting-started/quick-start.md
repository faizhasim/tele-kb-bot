# Quick Start

Get running in 30 seconds.

## Three Commands

```bash
brew tap faizhasim/tele-kb-bot https://github.com/faizhasim/tele-kb-bot.git
brew install tele-kb-bot
tele-kb-bot setup
```

That's it. The `setup` wizard will ask for:

- **Bot token** — from [@BotFather](https://t.me/BotFather) on Telegram
- **Your Telegram user ID** — get it from [@userinfobot](https://t.me/userinfobot)
- **API key** — for the LLM provider

## Verify

```bash
tele-kb-bot status
```

Should print your bot's name, version, and config status. You're ready.

## Start

```bash
tele-kb-bot start
```

Message your bot on Telegram. It should reply.

!!! tip "Prefer non-interactive setup?"
    Use environment variables and `--non-interactive`:
    ```bash
    TELEGRAM_BOT_TOKEN=xxx \
    TELEGRAM_ALLOWED_USER_IDS=111,222 \
    OPENER_GO_API_KEY=sk-... \
    tele-kb-bot setup --non-interactive
    ```

---

Need more detail? Read the [Setup Guide](setup.md).
