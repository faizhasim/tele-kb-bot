# Nix Guide

Using tele-kb-bot with Nix, home-manager, or nix-darwin.

## Overview

tele-kb-bot supports fully declarative config via environment variables — no filesystem writes required at runtime (except session/memory storage).

## Environment-Only Setup

```bash
TELE_KB_BOT_CONFIG=/path/to/config/dir \
TELEGRAM_BOT_TOKEN=xxx \
TELEGRAM_ALLOWED_USER_IDS=111 \
OPENER_GO_API_KEY=sk-... \
tele-kb-bot start
```

## home-manager

```nix
{
  home.sessionVariables = {
    TELE_KB_BOT_CONFIG = "\${config.xdg.configHome}/tele-kb-bot";
    OPENER_GO_API_KEY = "sk-...";          # or use sops-nix
    TELEGRAM_BOT_TOKEN = "123:...";
    TELEGRAM_ALLOWED_USER_IDS = "111111111";
  };
}
```

## sops-nix Secrets

```nix
{
  sops.secrets."tele-kb-bot/opener-go-api-key" = {
    # ...
  };
}
```

Then reference via env vars or point config dir to a pre-populated location.

## nix-darwin launchd

```nix
{
  launchd.user.agents.tele-kb-bot = {
    serviceConfig.ProgramArguments = [
      "\${pkgs.tele-kb-bot}/bin/tele-kb-bot"
      "start"
    ];
    serviceConfig.EnvironmentVariables = {
      TELE_KB_BOT_CONFIG = "/Users/faizhasim/.config/tele-kb-bot";
      PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
    };
    serviceConfig.RunAtLoad = true;
    serviceConfig.KeepAlive = true;
    serviceConfig.ThrottleInterval = 5;
  };
}
```

## Non-Interactive First Run

```bash
# Create config directory
mkdir -p ~/.config/tele-kb-bot

# Run setup without prompts
TELEGRAM_BOT_TOKEN=xxx \
TELEGRAM_ALLOWED_USER_IDS=111 \
OPENER_GO_API_KEY=sk-... \
tele-kb-bot setup --non-interactive
```

## Notes

- The binary has zero secrets — all keys come from env/disk
- Config directory is isolated from `~/.pi/`
- Pass `--config` flag or `TELE_KB_BOT_CONFIG` env var for custom location
