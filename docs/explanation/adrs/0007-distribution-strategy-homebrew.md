---
status: accepted
date: 2026-05-21
decision-makers: faizhasim
---

# Distribution Strategy — Homebrew Tap

## Context and Problem Statement

tele-kb-bot targets macOS users (macOS and Linux machines). How should we distribute the compiled binary so users can install, update, and manage it with standard macOS tooling?

The bot must be easy to install, update automatically, and integrate with macOS launchd for background operation.

## Decision Drivers

- Simple installation — one command to install, one command to update
- Automatic updates — Homebrew `brew upgrade` should update the bot
- macOS-native — launchd for lifecycle management, not Docker or systemd
- Zero secrets in the binary — the distributed binary must be publishable to a public GitHub repo
- Developer-friendly — easy to build from source for contributors

## Considered Options

- **Homebrew tap** — This repo (faizhasim/tele-kb-bot) is the tap, pre-built binaries on GitHub Releases
- **npm/gem/pip** — Install via package manager with JS ecosystem
- **curl-pipe-bash** — Traditional install.sh script
- **Mac App Store** — Sandboxed distribution
- **Manual download** — User downloads tarball from GitHub Releases

## Decision Outcome

Chosen option: **Homebrew tap with GoReleaser automation**, because it's the standard macOS package manager, supports automatic updates via `brew upgrade`, integrates naturally with launchd, and GoReleaser handles the full release pipeline (build → archive → checksum → GitHub Release → Homebrew formula update) with native Bun builder support.

### Consequences

- Good, because `brew install tele-kb-bot` is a single command familiar to all macOS developers
- Good, because `brew upgrade tele-kb-bot` provides automatic updates
- Good, because Homebrew handles binary integrity via SHA256 checksums
- Good, because the formula can specify the correct binary for each architecture (arm64 / x64)
- Good, because GoReleaser auto-updates the formula SHA256 on each release — no manual edits
- Good, because the same config also builds for Linux (amd64 + arm64) and Windows (amd64 via Scoop)
- Bad, because Homebrew taps require GitHub-managed formula updates for each release
- Bad, because the binary (~40-70MB depending on platform) must be uploaded to GitHub Releases

### Confirmation

The release workflow is triggered by a `workflow_dispatch` event in GitHub Actions (one click in the UI) or by pushing a `v*` tag. GoReleaser (`goreleaser release --clean`) builds all targets, generates archives and checksums, creates the GitHub Release, and pushes the updated Homebrew formula to the `Formula/` directory.

## Pros and Cons of the Options

### Homebrew tap

- Good, because one-command install and update via standard macOS tooling
- Good, because SHA256 verification ensures binary integrity
- Good, because GoReleaser auto-updates the formula — no manual SHA256 management
- Bad, because we maintain the formula and must keep it in sync with GoReleaser config
- Bad, because the formula requires separate entries for arm64 and x64 (auto-generated)

### npm/gem/pip

- Good, because these are also familiar package managers
- Bad, because they're not macOS-native — require Node.js/Ruby/Python runtime
- Bad, because the binary still needs to be distributed outside the package
- Bad, because launchd integration is non-standard

### curl-pipe-bash

- Good, because it's the simplest possible distribution — no package manager needed
- Bad, because curl-pipe-bash is an anti-pattern for security (no integrity verification)
- Bad, because no automatic update mechanism
- Bad, because users must manually manage the binary location and permissions

### Mac App Store

- Good, because it's the most official macOS distribution channel
- Bad, because Apple requires sandboxing — incompatible with bash execution, filesystem access, etc.
- Bad, because App Store review process delays releases
- Bad, because the bot uses Telelgram API (network access needs justification)

### Manual download

- Good, because users have full control over version and installation location
- Bad, because there's no update mechanism — users must manually check for new versions
- Bad, because installation requires manual steps (downloading, extracting, placing in PATH)

## More Information

### Release Pipeline (Current)

Releases are triggered via GitHub Actions `workflow_dispatch` (one click in the UI) or by pushing a `v*` tag:

```bash
# Option A: Go to Actions → CI → Run workflow → enter version
# Option B (alternative):
git tag v0.1.0
git push origin v0.1.0
```

The pipeline uses [GoReleaser](https://goreleaser.com) with native `builder: bun`:

```yaml
# .goreleaser.yaml (simplified)
builds:
  - builder: bun
    targets:
      - darwin-arm64
      - darwin-x64
      - linux-arm64
      - linux-x64-modern
      - windows-x64-modern
```

GoReleaser handles:

1. `bun build --compile` for each target
2. Archiving into `.tar.gz` (macOS/Linux) and `.zip` (Windows)
3. SHA256 checksums
4. GitHub Release creation
5. Homebrew formula update (`Formula/tele-kb-bot.rb`)
6. Scoop manifest for Windows (`Scoop/tele-kb-bot.json`)

### Formula Location

`Formula/tele-kb-bot.rb` — auto-generated by GoReleaser, not maintained by hand.

### User Installation

```bash
brew tap faizhasim/tele-kb-bot https://github.com/faizhasim/tele-kb-bot.git
brew install tele-kb-bot
tele-kb-bot setup
tele-kb-bot install
```

Windows users can install via [Scoop](https://scoop.sh) from the generated manifest.

### Binary Size

The compiled binary is ~40-70MB depending on platform and architecture (includes Bun runtime + pi SDK + grammY + Effect + application code). This is typical for Bun-compiled binaries.

### Build Machine

GoReleaser runs on `macos-latest` in GitHub Actions. All targets (arm64, x64, linux, windows) are cross-compiled by Bun's `--target` flag — no separate build machines needed.

### Platform Support

| Platform | Architectures | Package Manager |
|----------|---------------|----------------|
| macOS    | arm64, amd64  | Homebrew       |
| Linux    | arm64, amd64  | Homebrew       |
| Windows  | amd64         | Scoop          |

### Related Decisions

- [ADR-0002](0002-config-directory-and-schema.md): Config directory — zero-secrets model makes the binary publishable to a public tap
- [ADR-0005](0005-telegram-bot-design.md): Telegram bot design — the binary exists to run this bot
