# tele-kb-bot

A standalone Telegram bot backed by the pi coding agent SDK. Runs on macOS, managed via Homebrew and launchd.

## Quick Reference

- **Package Manager:** Bun
- **Development:** `bun run dev`
- **Build:** `bun run build` (arm64 binary)
- **Test:** `bun run test` (co-located .spec.ts files)
- **Coverage:** `bun run test:coverage`

### CLI Commands

| Command   | Description                          |
|-----------|--------------------------------------|
| `setup`   | Interactive first-run configuration  |
| `start`   | Run the daemon (foreground)          |
| `status`  | Show configuration and health status |
| `install` | Create and load launchd plist        |
| `version` | Print version                        |
### Quick Start
```bash
brew install tele-kb-bot
tele-kb-bot setup
tele-kb-bot install
```

## Agent Workflow

When making changes, run these checks at the end of each work loop:

```bash
bun run format       # Format code with Biome
bun run lint:fix     # Lint and auto-fix with Biome
bun run test:coverage # Run tests + coverage report
```
Always run all three before marking work as complete. If any check fails, investigate and fix before continuing.

## Detailed Instructions

- [Architecture & Decisions](.agents/architecture.md) -- System architecture, project structure, ADRs, dependencies
- [Development Guide](.agents/development.md) -- Development setup, docs, agent skills

## Security

- Zero secrets in compiled binary -- all keys come from `~/.config/tele-kb-bot/`
- Config files have 0600 permissions
- Only allowed Telegram user IDs can interact
- API keys are never logged (redacted by pino)
