# Deployment Guide

Run tele-kb-bot 24/7 on a macOS machine with automatic restart on crash and login.

## Prerequisites

- **macOS** — tested on Sonoma (14) and Sequoia (15)
- **Homebrew** — installed from [brew.sh](https://brew.sh)
- **SSH access** to the target machine (if remote), or physical/terminal access

!!! tip "x86 vs ARM"
    The Homebrew formula ships both `arm64` (Apple Silicon) and `x86_64` (Intel) builds.
    The installer selects the right one automatically.

## Installation

On the target machine:

```bash
# Add the tap (one-time)
brew tap faizhasim/tele-kb-bot https://github.com/faizhasim/tele-kb-bot.git

# Install the binary
brew install tele-kb-bot

# Run the setup wizard
tele-kb-bot setup

# Install launchd service for auto-start
tele-kb-bot install-launchd
```

The `setup` wizard writes configuration to `~/.config/tele-kb-bot/config.yaml`.
It stores your Telegram bot token and LLM API key with `0600` permissions.

!!! tip "Headless first-run"
    On a machine without a terminal, use the non-interactive mode:

    ```bash
    TELEGRAM_BOT_TOKEN=xxx \
    TELEGRAM_ALLOWED_USER_IDS=111,222 \
    tele-kb-bot setup --non-interactive
    ```

## launchd Lifecycle

The `install-launchd` command writes a property list to
`~/Library/LaunchAgents/com.tele-kb-bot.plist` and offers to load it immediately.
The plist configures the bot to start on login and restart automatically on crash.

> See ADR-0007 for distribution strategy details.

Logs are written to `~/.config/tele-kb-bot/logs/` — `out.log` for bot activity events,
`err.log` for launchd-level stderr.

## Management Commands

| Action             | Command                                                              |
| ------------------ | -------------------------------------------------------------------- |
| Check running      | `launchctl list | grep tele-kb-bot`                                  |
| Start              | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tele-kb-bot.plist` |
| Stop               | `launchctl bootout gui/$(id -u)/com.tele-kb-bot`                     |
| View logs (follow) | `tail -f ~/.config/tele-kb-bot/logs/out.log`                         |
| Check health       | `tele-kb-bot status`                                                 |
| Reload config      | Stop then start the service (config is read at startup)              |

!!! warning "`bootout` vs `unload`"
    Use `launchctl bootout` on macOS Ventura+. The legacy `launchctl unload` still works on
    some versions but `bootout` is the canonical command.

### Quick health check

```bash
tele-kb-bot status
```

This reports:
- Binary version and path
- Config directory validity
- Config file parse status
- Telegram bot connection (fetches bot name from the API)
- Allowed user count

## Update Procedure

```bash
# 1. Upgrade the binary
brew upgrade tele-kb-bot

# 2. Stop the running service
launchctl bootout gui/$(id -u)/com.tele-kb-bot

# 3. Start the new version
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tele-kb-bot.plist
```
!!! tip "Rollback"
    Download a previous binary from [GitHub Releases](https://github.com/faizhasim/tele-kb-bot/releases) and replace the current one at `$(which tele-kb-bot)`, then restart the service.


## Troubleshooting

| Symptom                     | Likely cause                          | Check / fix                                         |
| --------------------------- | ------------------------------------- | --------------------------------------------------- |
| Bot doesn't start           | Missing or invalid config             | `tele-kb-bot status` — re-run `setup` if errors     |
| launchd errors              | Config or binary path issue           | `tail -100 ~/.config/tele-kb-bot/logs/err.log`      |
| Bot unresponsive            | Network down or invalid token         | `curl -s https://api.telegram.org/bot$TOKEN/getMe`  |
| `tele-kb-bot: command not found` | Homebrew bin not in PATH        | Add `eval "$(/opt/homebrew/bin/brew shellenv)"` to `~/.zshrc` |
| launchd service not found   | Plist not loaded after install        | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tele-kb-bot.plist` |
| Binary won't run            | Architecture mismatch                 | `file $(which tele-kb-bot)` — needs ARM or x64 matching your Mac |
| `bootout` fails             | Service already unloaded              | Run once: `launchctl bootout gui/$(id -u)/com.tele-kb-bot 2>/dev/null \|\| true` then bootstrap |

### Reset from scratch

If the service is in a broken state:

```bash
# Stop and unload
launchctl bootout gui/$(id -u)/com.tele-kb-bot 2>/dev/null || true

# Remove the plist
rm -f ~/Library/LaunchAgents/com.tele-kb-bot.plist

# Reinstall
tele-kb-bot install-launchd
```
