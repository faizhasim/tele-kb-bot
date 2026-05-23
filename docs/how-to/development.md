# Development Guide

Building, testing, and releasing tele-kb-bot from source.

## Prerequisites

- **[Bun](https://bun.sh/) v1.2+** — runtime and bundler (`curl -fsSL https://bun.sh/install | bash`)
- **Node.js 22+** — some tooling requires it (optional, but recommended for full toolchain)

## Quick Start

```bash
git clone https://github.com/faizhasim/tele-kb-bot.git
cd tele-kb-bot
bun install
bun run dev -- help
```

## Running

```bash
# Development — runs via Bun without compilation
bun run dev -- help
bun run dev -- status
bun run dev -- start --config ./dev-config/

# Production build (compiled binary)
bun run build
./dist/tele-kb-bot -- help

# Intel Mac build
bun run build:intel

# Tests
bun test           # Bun-native test runner
bun run test       # Vitest (preferred — richer reporting)
```

!!! note "`--config` flag"
    Every command accepts `--config <path>` to override the config directory.
    Useful for running an isolated dev instance alongside your production bot.

### dev-config pattern

For local development, maintain a lightweight dev config:

```bash
mkdir -p dev-config/agents
cat > dev-config/config.yaml << 'EOF'
telegram:
  bot_token: "YOUR_DEV_BOT_TOKEN"
  allowed_user_ids: [111111111]
llm:
  provider: "opencode-go"
  model: "deepseek-v4-flash"
  reasoning: "low"
memory:
  enabled: true
  mode: "ephemeral"
  auto_inject: false
EOF

bun run dev -- start --config ./dev-config/
```

## Testing

Both `bun test` and `bun run test` (vitest) use the same co-located spec files.
Run both before pushing.

```bash
# Single spec file
bun test src/config/config.spec.ts

# Vitest filter
bun run test -- src/config/

# Watch mode
bun run test:watch
```

> See the code for test patterns and Effect-based test runtime setup.

## Release Process

Releases produce a GitHub Release with pre-built binaries for macOS (ARM + x64),
Linux (ARM + amd64), and Windows (amd64), plus updated Homebrew and Scoop formulae.

### One-Click Release (Recommended)

1. Go to GitHub → **Actions** → **CI** workflow
2. Click **"Run workflow"**
3. Enter the version number (e.g. `0.1.1`)
4. The workflow will:
    - Lint and run tests
    - Create a `v0.1.1` git tag
    - Build binaries for all targets
    - Create a GitHub Release with tarballs, zip files, and SHA256 checksums
    - Auto-update `Formula/tele-kb-bot.rb` (Homebrew)
    - Generate `Scoop/tele-kb-bot.json` (Windows)

### Manual Tag Push

```bash
git tag v0.1.1
git push origin v0.1.1
```

The tag push triggers the same CI pipeline.

### Local Dry Run

```bash
goreleaser release --snapshot --clean
```

Tests the build and packaging without publishing anything. Artifacts land in `dist/`.
Use this to verify the build matrix and checksum generation before cutting a real release.
