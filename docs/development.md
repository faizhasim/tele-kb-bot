# Development Guide

Building and contributing to tele-kb-bot.

## Prerequisites

- [Bun](https://bun.sh/) v1.2+
- Node.js 22+
- macOS (primary target)

## Quick Start

```bash
git clone https://github.com/faizhasim/tele-kb-bot.git
cd tele-kb-bot
bun install
bun run dev -- help
```

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── constants.ts          # Shared constants (BINARY_NAME, VERSION)
├── logger.ts             # EffectLogger service + createCLILogger
├── cli/                  # CLI commands (help, setup, install, status)
├── config/               # Config schema, defaults, loader, paths
├── daemon/               # Bot controller, session registry, main
├── memory/               # Scratchpad, BM25 search, context builder, manager
├── pi/                   # pi SDK: provider, extensions, session-factory
├── telegram/             # Client, handler, media, streaming, chunking
└── launchd/              # launchd plist template
```

## Running

```bash
# Development
bun run dev -- help

# Build
bun run build

# Tests
bun test
vitest run
```

## Testing

- **Pure functions**: Regular vitest assertions
- **Effect-based functions**: `ManagedRuntime.make()` → `runPromise`
- Co-located specs: `src/**/*.spec.ts`
- Both `bun test` and `vitest run` must pass

## Architecture Decisions

See [adrs/](adrs/) for all ADRs (MADR format).

## Release Process

Releases are fully automated via GitHub Actions + GoReleaser.

### One-Click Release (Recommended)

1. Go to GitHub → Actions → **CI** workflow
2. Click **"Run workflow"**
3. Enter the version number (e.g., `0.1.1`)
4. The workflow will:
   - Lint and test
   - Create a `v0.1.1` git tag
   - Build binaries for macOS (arm64 + x64), Linux (arm64 + amd64), Windows (amd64)
   - Create a GitHub Release with tarballs/zip + checksums
   - Auto-update the Homebrew formula (`Formula/tele-kb-bot.rb`)
   - Generate a Scoop manifest (`Scoop/tele-kb-bot.json`)

### Manual Tag Push (Alternative)

```bash
git tag v0.1.1
git push origin v0.1.1
```

The tag push triggers the same release pipeline.

### Local Dry Run

```bash
goreleaser release --snapshot --clean
```

Tests the build and packaging without publishing anything. Artifacts go to `dist/`.

## Key Design Principles

- **Function expressions** over classes/declarations
- **Effect TS** for all I/O and error handling
- **Zero secrets** in the compiled binary
- **Pure functions** where possible (no side effects, no IO)
- **Co-located tests** with `.spec.ts` extension
- **Async FS** via `@effect/platform` FileSystem service
