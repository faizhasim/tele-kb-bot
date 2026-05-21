# Deployment Guide

Deploying tele-kb-bot to a machine for 24/7 operation.

## Prerequisites

- macOS (tested on Sonoma+)
- Homebrew installed
- SSH access to target machine

## Installation

```bash
# On target machine
brew tap faizhasim/tele-kb-bot
brew install tele-kb-bot
tele-kb-bot setup
tele-kb-bot install
```

## launchd Lifecycle

The `tele-kb-bot install` command creates:

- `~/Library/LaunchAgents/com.tele-kb-bot.plist`
- Logs at `~/.config/tele-kb-bot/logs/out.log` and `err.log`

### Management Commands

```bash
# Check if running
launchctl list | grep tele-kb-bot

# Start
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tele-kb-bot.plist

# Stop
launchctl bootout gui/$(id -u)/com.tele-kb-bot

# View logs
tail -f ~/.config/tele-kb-bot/logs/out.log
tail -f ~/.config/tele-kb-bot/logs/err.log

# Check health
tele-kb-bot status
```

## Updating

```bash
brew upgrade tele-kb-bot
launchctl bootout gui/$(id -u)/com.tele-kb-bot
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tele-kb-bot.plist
```

## Monitoring

The bot logs all activity to `~/.config/tele-kb-bot/logs/out.log` with structured JSON. View with pino-pretty:

```bash
tail -f ~/.config/tele-kb-bot/logs/out.log | pino-pretty
```

## Troubleshooting

| Issue             | Check                                           |
| ----------------- | ----------------------------------------------- |
| Bot doesn't start | `tele-kb-bot status` to verify config           |
| launchd errors    | `tail ~/.config/tele-kb-bot/logs/err.log`       |
| Bot unresponsive  | Verify internet, bot token validity             |
| Memory usage high | Idle sessions evicted after 30 min              |
| Binary won't run  | macOS version compatibility, architecture match |
