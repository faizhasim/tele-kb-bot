# tele-kb-bot

A standalone Telegram bot backed by the pi coding agent SDK. Runs on macOS, managed via Homebrew and launchd.

## Quick Start

```bash
brew install tele-kb-bot
tele-kb-bot setup
tele-kb-bot install
```

## Architecture

```
Telegram → GrammY Bot (long-polling) → PiSession per chat → LLM (deepseek-v4-flash)
                                  ↑
                         Memory System (BM25 + daily logs)
```

## Commands

| Command      | Description                              |
|--------------|------------------------------------------|
| `setup`      | Interactive first-run configuration      |
| `start`      | Run the daemon (foreground)              |
| `status`     | Show configuration and health status     |
| `install`    | Create and load launchd plist            |
| `version`    | Print version                            |

## Development

```bash
bun run dev          # Run in development mode
bun run test         # Run tests (co-located .spec.ts files)
bun run test:coverage # Run tests with coverage report
bun run build        # Build arm64 binary
```

## Agent Workflow

When making changes, run these checks at the end of each work loop:

```bash
bun run format       # Format code with Biome
bun run lint:fix     # Lint and auto-fix with Biome
bun run test:coverage # Run tests + coverage report
```

Always run all three before marking work as complete. If any check fails, investigate and fix before continuing.

## Project Structure

```
src/
├── index.ts          # Entry point
├── logger.ts         # Pino logger setup
├── cli/              # CLI commands (setup, status, install, help)
├── config/           # Config loading, validation, schema (TypeBox)
├── daemon/           # Bot controller, session registry, shutdown
├── pi/               # pi SDK integration (session factory, extensions, provider)
├── telegram/         # Telegram client, handlers, media, streaming, chunking
└── memory/           # Knowledge base (BM25 search, scratchpad, context injection)
docs/                 # Documentation site (MkDocs + Nord theme)
├── getting-started/  # Tutorials
├── how-to/           # How-to guides
├── reference/        # CLI, config, architecture, security
└── explanation/      # ADRs, design rationale, Homebrew strategy
adrs/                 # Source ADRs (also promoted to docs)
Formula/              # Homebrew formula
scripts/              # Release pipeline
```

## Documentation

Full documentation site at **https://faizhasim.github.io/tele-kb-bot** (MkDocs + Nord theme).

To build and view locally:
```bash
pip install -r requirements.txt
mkdocs serve
```

Includes Mermaid diagrams, admonitions, tabs, code copy, and all 9 ADRs promoted into the Explanation section.


## Key Decisions

All architecturally significant decisions are documented as ADRs in `adrs/`:

- `0001`: Use Markdown ADRs (MADR)
- `0002`: Config directory location and YAML schema
- `0003`: CLI command structure
- `0004`: pi SDK integration architecture
- `0005`: Telegram bot design and message flow
- `0006`: Memory system design
- `0007`: Distribution strategy (Homebrew tap)

## Security

- Zero secrets in the compiled binary — all keys come from `~/.config/tele-kb-bot/`
- Config files have 0600 permissions
- Only allowed Telegram user IDs can interact with the bot
- API keys are never logged (redacted by pino)

## Dependencies

- `@mariozechner/pi-coding-agent` — pi SDK for per-chat agent sessions
- `@sinclair/typebox` — Runtime type validation for config schema
- `grammy` — Telegram bot framework
- `js-yaml` — YAML config parsing
- `pino` — Structured logging
