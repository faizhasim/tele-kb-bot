<p align="center">
  <img src="docs/assets/images/tele-kb-bot-logo.svg" alt="tele-kb-bot" width="180">
</p>

<p align="center">
  <strong>Chat with an LLM from your phone. Search a local knowledge base. All in a single binary.</strong>
</p>

<p align="center">
  <a href="https://faizhasim.github.io/tele-kb-bot"><b>📚 Documentation</b></a> ·
  <a href="#-quick-start"><b>Quick Start</b></a> ·
  <a href="#-commands"><b>Commands</b></a> ·
  <a href="#-configuration"><b>Configuration</b></a> ·
  <a href="#-architecture"><b>Architecture</b></a>
</p>

<p align="center">
  <a href="https://github.com/faizhasim/tele-kb-bot/actions"><img src="https://img.shields.io/github/actions/workflow/status/faizhasim/tele-kb-bot/.github/workflows/ci.yml?branch=main&style=flat&logo=github&label=CI" alt="CI"></a>
  <a href="https://github.com/faizhasim/tele-kb-bot/releases"><img src="https://img.shields.io/github/v/release/faizhasim/tele-kb-bot?style=flat&logo=semver&label=release" alt="Release"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-bun-000?style=flat&logo=bun" alt="Bun"></a>
  <a href="https://effect.website"><img src="https://img.shields.io/badge/built%20with-effect-FF6B6B?style=flat&logo=typescript" alt="Effect"></a>
  <a href="https://brew.sh"><img src="https://img.shields.io/badge/pkg-homebrew-FBB040?style=flat&logo=homebrew" alt="Homebrew"></a>
  <a href="https://faizhasim.github.io/tele-kb-bot"><img src="https://img.shields.io/badge/docs-zensical-88C0D0?style=flat&logo=materialformkdocs&logoColor=white&labelColor=2E3440" alt="Docs"></a>
</p>

---

## 🚀 Quick Start

```bash
brew tap faizhasim/tele-kb-bot
brew install tele-kb-bot
tele-kb-bot setup
```

Three commands. That's it.

The `setup` wizard walks you through connecting your Telegram bot and configuring your LLM. After that, your bot is ready — just `tele-kb-bot start` to run it.

> [!TIP]
> Want to skip the wizard? Set `TELEGRAM_BOT_TOKEN` and run `tele-kb-bot setup --non-interactive`. See the full [Configuration reference](https://faizhasim.github.io/tele-kb-bot/reference/configuration/).

---

## ✨ What It Does

| Feature | Description |
|---------|-------------|
| **💬 Chat from your phone** | Send messages, photos, documents, voice notes — the bot processes them via an LLM |
| **🧠 Persistent memory** | Conversations and facts stored as plain markdown, searchable via BM25 or QMD (semantic) |
| **🔒 Private & secure** | Runs on your own machine. Zero secrets in the binary. User whitelist enforced. |
| **📦 Single binary** | Built with `bun build --compile` — no Node.js, no npm, no runtime needed |
| **🔄 Auto-restart** | launchd integration keeps it alive across reboots and crashes |
| **🖥️ Multi-platform** | macOS, Linux, and Windows builds via GoReleaser |

---

## 📟 Commands

| Command | Description |
|---------|-------------|
| `tele-kb-bot setup` | Interactive first-run configuration wizard |
| `tele-kb-bot start` | Run the daemon in the foreground |
| `tele-kb-bot status` | Show config health, bot info, and version |
| `tele-kb-bot install-launchd` | Create and load a launchd plist for auto-start |
| `tele-kb-bot version` | Print version and exit |
| `tele-kb-bot help` | Print full usage information |

---

## ⚙️ Configuration

Config lives in `~/.config/tele-kb-bot/config.yaml` (override with `TELE_KB_BOT_CONFIG`).

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated Telegram user IDs |
| `OPENER_GO_API_KEY` | LLM provider API key |
| `LOG_LEVEL` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` |

> [!NOTE]
> The compiled binary contains **zero secrets**. All credentials are read from disk at runtime. See the [Security model](https://faizhasim.github.io/tele-kb-bot/reference/security/).

---

## 🏗️ Architecture

```mermaid
flowchart LR
    subgraph Telegram["📱 Telegram"]
        A["You send message"]
    end

    subgraph Bot[" tele-kb-bot (single binary)"]
        B["GrammY"]
        C["pi SDK\nAgentSession"]
        D["LLM\ndeepseek-v4-flash"]
        B --> C --> D
        C --> E["QMD / BM25 search\n(memory/)"]
        C --> F["Markdown files\n(memory/)"]
        C --> G["Session persistence\n(JSONL)"]
    end

    subgraph Response["📱 Telegram"]
        H["Response back\nto you"]
    end

    A --> B
    D --> H
```

| Layer | Stack |
|-------|-------|
| **Runtime** | [Bun](https://bun.sh) — single binary via `bun build --compile` |
| **Functional core** | [Effect TS](https://effect.website) — composable effects, tagged errors, services |
| **Telegram** | [GrammY](https://grammy.dev) — long-polling bot framework |
| **AI** | [pi SDK](https://github.com/mariozechner/pi) — per-chat agent sessions |
| **LLM** | Opencode Go / deepseek-v4-flash with high reasoning |
| **Search** | BM25 (ephemeral) + [QMD](https://github.com/tobi/qmd) (persistent semantic search) |
| **Logging** | [pino](https://getpino.io) — structured JSON logging |
| **Packaging** | [GoReleaser](https://goreleaser.com) — cross-platform builds + Homebrew |

### Project Structure

```
src/
├── index.ts              # Entry point
├── constants.ts          # Shared constants
├── logger.ts             # EffectLogger service + pino
├── cli/                  # CLI commands (setup, start, status, install-launchd, help)
├── config/               # Schema (Effect Schema), loader, paths, defaults
├── daemon/               # Bot controller, session registry, main
├── memory/               # Scratchpad, QMD/BM25 search, context builder, manager
├── pi/                   # pi SDK provider, extensions, session factory
└── telegram/             # Client, handler, media, streaming, chunking
```

---

## 📚 Docs

Full documentation is available at **[faizhasim.github.io/tele-kb-bot](https://faizhasim.github.io/tele-kb-bot)** — built with MkDocs and the Nord theme.

Includes:

| Section | What you'll find |
|---------|-----------------|
| **Getting Started** | Quick start, setup guide, first chat |
| **How-to Guides** | Deployment, development, Nix/home-manager |
| **Reference** | CLI, configuration, architecture, security |
| **Explanation** | Design decisions (ADRs), Homebrew strategy |
| **ADRs** | All 9 architecture decision records promoted into the docs |

To view locally: `pip install -r requirements.txt && zensical serve`

---

## 🚢 Releases

One click in GitHub Actions:

1. Go to **Actions** → **CI** workflow → **Run workflow**
2. Enter the version number (e.g., `0.1.1`)
3. Pipeline builds for macOS, Linux, Windows — creates a GitHub Release and updates the Homebrew formula.

For full details, see the [Development Guide](https://faizhasim.github.io/tele-kb-bot/how-to/development/).

---

<p align="center">
  <sub>Built with <a href="https://effect.website">Effect</a>, <a href="https://bun.sh">Bun</a>, and ☕</sub>
</p>

<p align="center">
  <sub><em>Entirely generated by <a href="https://github.com/mariozechner/pi">pi</a> running on <strong>deepseek-v4-flash</strong> with high reasoning — because the best way to build a bot is to let the bots handle the boilerplate while the human steers. Hat tip to <a href="https://github.com/faizhasim">Mohd Faiz Hasim</a> for knowing exactly when to say "no, do it this way." 🎯</em></sub>
</p>
