# CLI Reference

`tele-kb-bot` is a single-binary command-line application. It provides several commands for setup, runtime management, and administration.

## Commands Overview

| Command             | Purpose                                      |
|---------------------|----------------------------------------------|
| `setup`             | First-run interactive configuration wizard   |
| `start`             | Run the bot daemon in the foreground         |
| `status`            | Show configuration and health status         |
| `index`             | Build or clear the markdown search index     |
| `launchd add`       | Create and load a launchd service plist      |
| `launchd remove`    | Unload and remove launchd service plist      |
| `systemd add`       | Create and start a systemd service (Linux)   |
| `systemd remove`    | Stop and remove systemd service (Linux)      |
| `version`           | Print the binary version                     |
| `help`              | Print usage information                      |

## Global Flags

These flags are accepted **before the subcommand** on the invocation line.

| Flag                 | Env Var               | Description                                        |
|----------------------|-----------------------|----------------------------------------------------|
| `--config <path>`    | `TELE_KB_BOT_CONFIG`  | Override the config directory path                 |
| `--non-interactive`  | —                     | Skip interactive prompts (use env vars for values) |

## Commands

### `setup`

First-run configuration wizard. Walks through bot token, allowed users, LLM API key, and memory preferences interactively. Idempotent — re-running preserves existing values unless explicitly changed.

```bash
tele-kb-bot setup
tele-kb-bot setup --non-interactive
```

**Interactive prompts:**

1. Telegram bot token (validated against Bot API before proceeding)
2. Allowed Telegram user IDs (comma-separated)
3. LLM API key (optional — can use `OPENER_GO_API_KEY` env var instead)
4. Memory mode (ephemeral BM25 or persistent qmd)
5. Search cache configuration (max entries, max size)
6. Vault directory paths

After configuration, the wizard asks whether to install the launchd service and (if vault directories were configured) whether to build the search index immediately.

**Non-interactive mode** (`--non-interactive`) reads from environment variables and fails if required values are missing:

```bash
TELEGRAM_BOT_TOKEN=xxx \
TELEGRAM_ALLOWED_USER_IDS=111,222 \
OPENER_GO_API_KEY=sk-... \
tele-kb-bot setup --non-interactive
```

Writes config to `<config_dir>/config.yaml` with `0600` permissions. API keys are written to `<config_dir>/agents/auth.json` with `0600` permissions.

### `start`

Start the bot daemon in the foreground. Loads configuration, verifies the bot token against the Telegram API, initialises the memory backend, creates the session registry, and begins long-polling for messages.

```bash
tele-kb-bot start
tele-kb-bot start --config ./dev-config/
```

**Behaviour:**

- Creates `logs/` directory under config dir
- Writes structured JSON logs to `<config_dir>/logs/bot.log` (with rotation)
- Runs until SIGINT/SIGTERM, then performs graceful shutdown: stops polling, disposes all LLM sessions
- Handles `unhandledRejection` and `uncaughtException` with logging and exit

### `status`

Display the current configuration and health status. Useful for verifying the setup worked and checking the bot's connection to Telegram.

```bash
tele-kb-bot status
```

**Output includes:**

- Binary path and version
- Config directory contents (each subdirectory shown with verify/absent indicator)
- Config file source (file / env-only / defaults) and validity
- Configured LLM provider, model, and reasoning level
- Allowed user IDs
- Memory mode
- Telegram bot connection status (fetches `/getMe` from Bot API)

Returns exit code `0` on success, `1` on validation errors.

### `index`

Manage the qmd search index over vault directories.

```bash
# Build or rebuild the search index
tele-kb-bot index build

# Clear the search index
tele-kb-bot index clear
```

**Subcommands:**

| Subcommand | Description                                    |
|------------|------------------------------------------------|
| `build`    | Scan all vault directories and build the index |
| `clear`    | Remove the index from disk                     |

Requires the `qmd` binary to be installed and in `PATH`, or accessible via the `QMD_BINARY_PATH` env var.

### `launchd add|remove`

Create or remove a macOS launchd service plist at `~/Library/LaunchAgents/com.tele-kb-bot.plist`.

```bash
# Create and load the service
tele-kb-bot launchd add

# Unload and remove the service
tele-kb-bot launchd remove
```
**Generated plist behaviour:**

- Starts the bot automatically on login (`RunAtLoad`)
- Restarts if the process crashes (`KeepAlive`)
- 5-second throttle between restarts
- Captures stdout to `<config_dir>/logs/out.log`
- Captures stderr to `<config_dir>/logs/err.log`

After writing the plist, the command prompts to load the service immediately via `launchctl bootstrap`.

### `systemd add|remove`

Create or remove a Linux systemd user service at `~/.config/systemd/user/tele-kb-bot.service`.

```bash
# Create, enable, and start the service
tele-kb-bot systemd add

# Stop, disable, and remove the service
tele-kb-bot systemd remove
```

**Generated service behaviour:**

- Starts automatically on login (`WantedBy=default.target`)
- Restarts on failure with 5-second delay
- Captures logs via journald: `journalctl --user -u tele-kb-bot -f`

### `version`

Print the binary version to stdout.

```bash
tele-kb-bot version
# tele-kb-bot v0.1.0
```

### `help`

Print full usage information, including all commands, flags, environment variables, and examples.

```bash
tele-kb-bot help
tele-kb-bot   # no arguments also prints help
```

## Exit Codes

| Code | Meaning                               |
|------|---------------------------------------|
| `0`  | Success                               |
| `1`  | General error (config, network, etc.) |

For commands that perform sub-operations (setup writes config, status validates), non-zero exit indicates the operation failed or validation found errors.

## Environment Variables

| Variable                     | Commands              | Description                                       |
|------------------------------|-----------------------|---------------------------------------------------|
| `TELE_KB_BOT_CONFIG`         | all                   | Config directory path (default: `~/.config/tele-kb-bot/`) |
| `TELEGRAM_BOT_TOKEN`         | `setup`, `start`      | Telegram bot token from @BotFather                |
| `TELEGRAM_ALLOWED_USER_IDS`  | `setup`               | Comma-separated Telegram user IDs                 |
| `OPENER_GO_API_KEY`          | `setup`, `start`      | LLM provider API key                              |
| `VAULT_DIRECTORIES`          | `setup`               | Colon-separated vault directory paths             |
| `QMD_BINARY_PATH`            | `index`               | Path to qmd binary (default: `qmd` in PATH)       |
| `TELEGRAM_BOT_MAX_SESSIONS`  | `start`               | Override max concurrent LLM sessions              |
| `LOG_LEVEL`                  | all                   | Log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |

## Zero Secrets

The compiled binary contains **zero secrets**. All credentials — bot token, API keys — are loaded from the config file or environment variables at runtime. The binary can be distributed, shared, and inspected without risk of credential leakage. See the [security reference](security.md) for details.
