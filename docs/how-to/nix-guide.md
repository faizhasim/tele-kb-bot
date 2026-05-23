# Nix Guide

Configure and run tele-kb-bot declaratively with Nix, home-manager, sops-nix, and nix-darwin.

## Overview

tele-kb-bot is fully configurable through environment variables at runtime.
No secrets are embedded in the compiled binary.

- **Environment variables** replace every config file field (see [Configuration](../reference/configuration.md#environment-variables)).
- **The binary needs no filesystem state** at launch (except session/memory storage, which is ephemeral or in `XDG_DATA_HOME`).
- **A single `tele-kb-bot start` invocation** with env vars is enough to run.

## Environment-Only Setup

Set environment variables and run the binary directly. No config file, no setup wizard needed.

```bash
TELE_KB_BOT_CONFIG=/persistent/config \
TELEGRAM_BOT_TOKEN=123456789:AAF... \
TELEGRAM_ALLOWED_USER_IDS=111111111 \
OPENER_GO_API_KEY=sk-... \
tele-kb-bot start
```

`TELE_KB_BOT_CONFIG` points to a writable directory where session files, memory, and logs
are stored. If not set, defaults to `$XDG_CONFIG_HOME/tele-kb-bot` (typically
`~/.config/tele-kb-bot`).

!!! tip "No `setup` needed"
    When all values come from environment variables, `tele-kb-bot setup` is not required.
    The binary reads `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, and
    `OPENER_GO_API_KEY` on startup. You still need a writable `TELE_KB_BOT_CONFIG`
    directory for session persistence and logs.

## home-manager

Set environment variables declaratively:

```nix
{ config, pkgs, ... }:

{
  home.sessionVariables = {
    TELE_KB_BOT_CONFIG = "${config.xdg.configHome}/tele-kb-bot";
    TELEGRAM_BOT_TOKEN = "123456789:AAF...";
    TELEGRAM_ALLOWED_USER_IDS = "111111111";
    OPENER_GO_API_KEY = "sk-...";
    LOG_LEVEL = "info";
  };
}
```

> See ADR-0002 for the full configuration schema.

!!! warning "Non‑NixOS caveat"
    On macOS, `home-manager` session variables are loaded by `bash`/`zsh` init scripts.
    If launchd does not inherit them (it reads its own environment), you must duplicate
    them in the launchd `EnvironmentVariables` block (see [nix-darwin launchd](#nix-darwin-launchd)).

## sops-nix Secrets

Store sensitive values (bot token, API key) encrypted in your Nix repository.

```nix
{ config, pkgs, ... }:

{
  sops.secrets = {
    "telegram-bot-token" = {
      sopsFile = ./secrets/telegram.yaml;
      owner = config.home.username;
    };
    "opener-go-api-key" = {
      sopsFile = ./secrets/telegram.yaml;
      owner = config.home.username;
    };
  };
}
```

Then reference the decrypted values in `sessionVariables`:

```nix
{
  home.sessionVariables = {
    TELEGRAM_BOT_TOKEN = "$(cat ${config.sops.secrets.telegram-bot-token.path})";
    OPENER_GO_API_KEY = "$(cat ${config.sops.secrets.opener-go-api-key.path})";
    TELE_KB_BOT_CONFIG = "${config.xdg.configHome}/tele-kb-bot";
  };
}
```

!!! caution "Shell expansion timing"
    `sessionVariables` with `$(cat ...)` are shell-evaluated at login shell start.
    If the secrets file path changes after deploy, log out and back in.

### Alternative: secrets directory

If you prefer filesystem-based config, point `TELE_KB_BOT_CONFIG` to a directory with
`config.yaml` and `agents/auth.json` pre-placed by sops-nix:

```nix
{ config, pkgs, ... }:

{
  sops.secrets."tele-kb-bot/config" = {
    path = "${config.xdg.configHome}/tele-kb-bot/agents/auth.json";
  };

  home.sessionVariables = {
    TELE_KB_BOT_CONFIG = "${config.xdg.configHome}/tele-kb-bot";
  };
}
```

## nix-darwin launchd

!!! warning "No Nix package yet"
    tele-kb-bot does not have a Nix package yet. The examples below assume the binary is installed via Homebrew at `/opt/homebrew/bin/tele-kb-bot`. Replace accordingly if using a different path.

For 24/7 daemon management on macOS, register tele-kb-bot as a launchd user agent via
nix-darwin:

```nix
{ config, pkgs, ... }:

{
  launchd.user.agents.tele-kb-bot = {
    serviceConfig = {
      ProgramArguments = [
        "/opt/homebrew/bin/tele-kb-bot"
        "start"
      ];

      EnvironmentVariables = {
        TELE_KB_BOT_CONFIG = "/Users/faizhasim/.config/tele-kb-bot";
        TELEGRAM_BOT_TOKEN = "123456789:AAF...";
        TELEGRAM_ALLOWED_USER_IDS = "111111111";
        OPENER_GO_API_KEY = "sk-...";
        LOG_LEVEL = "info";
        PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
      };

      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 5;

      StandardOutPath = "/Users/faizhasim/.config/tele-kb-bot/logs/out.log";
      StandardErrorPath = "/Users/faizhasim/.config/tele-kb-bot/logs/err.log";
    };
  };
}
```

!!! tip "PATH must be explicit"
    launchd runs with a minimal environment. Always set `PATH` in `EnvironmentVariables`
    so that child processes (e.g. `qmd`) are discoverable.

### Manage from nix-darwin

```bash
# Reload after nix-darwin rebuild
launchctl kickstart gui/$(id -u)/tele-kb-bot

# Stop
launchctl bootout gui/$(id -u)/tele-kb-bot

# Logs
tail -f ~/.config/tele-kb-bot/logs/out.log | pino-pretty
```

## Non-Interactive First Run

When you want the setup wizard to write a `config.yaml` file (e.g. for testing or
one-off machines) but cannot provide interactive input:

```bash
# Create the config directory
mkdir -p ~/.config/tele-kb-bot

# Run setup without prompts
TELEGRAM_BOT_TOKEN=123456789:AAF... \
TELEGRAM_ALLOWED_USER_IDS=111111111 \
OPENER_GO_API_KEY=sk-... \
tele-kb-bot setup --non-interactive
```

This writes `config.yaml` and `agents/auth.json` to `~/.config/tele-kb-bot/`.

## Notes

- **Config directory isolation** — tele-kb-bot uses `~/.config/tele-kb-bot/` by default,
  separate from `~/.pi/` and other tool configs. Override with `TELE_KB_BOT_CONFIG`.
- **Ephemeral mode** — set `memory.mode = ephemeral` in config (or the default config
  if no file is present) to avoid filesystem writes to memory storage. Sessions still
  persist to disk for crash recovery.
- **No Nix package yet** — tele-kb-bot is distributed via Homebrew. To use it with
  nix-darwin, install the binary via Homebrew (which coexists) or package it yourself
  with `pkgs.buildBunPackage`.
- **`--config` flag** — every command accepts `--config <path>` to override the config
  directory. Combine with nix-darwin `ProgramArguments` for fully managed deployments:
  `["/opt/homebrew/bin/tele-kb-bot", "start", "--config", "/nix/var/tele-kb-bot"]`.
