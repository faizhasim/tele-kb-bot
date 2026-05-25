---
status: accepted
date: 2026-05-21
decision-makers: faizhasim
---

# Config Directory Location and Schema

## Context and Problem Statement

The tele-kb-bot daemon needs a well-defined config directory for storing user settings, API credentials, and runtime state. How should the config directory be resolved, what format should the config file use, and how do we handle secret material (API keys, bot tokens)?

Config decisions have broad implications: security (secrets must not leak into the binary), portability (env var override for Nix users), and tooling (schema validation for fast error feedback).

## Decision Drivers

- Zero secrets must be embedded in the compiled binary — the binary must be publishable to a public GitHub repo
- Config directory must be completely isolated from `~/.pi/` and `$XDG_CONFIG_HOME/pi/`
- Nix/home-manager users need env-var-based config (no filesystem writes)
- Config should be human-readable with comments for self-documentation
- Schema validation catches misconfigurations early with helpful error messages

## Considered Options

- **YAML with Effect Schema validation** — User-facing config.yaml with runtime schema validation via `@effect/schema`
- **YAML with TypeBox validation** — Original approach using @sinclair/typebox (replaced during Effect TS refactoring)
- **JSON config** — Built into Node/Bun, no extra deps, but no comments or user-friendly editing
- **TOML** — Structured, Rust-ecosystem familiar, but less common in JS/TS and no built-in Bun support
- **Env vars only** — All config from environment, no config file at all

## Decision Outcome

Chosen option: **YAML with Effect Schema validation**, because:

- Effect Schema (`@effect/schema/Schema`) integrates naturally with our functional programming stack (Effect TS)
- `Struct.decodeUnknownEither` provides detailed error paths for misconfigurations
- js-yaml handles YAML parsing; Effect Schema validates the shape at runtime
- The env var override mechanism satisfies Nix users without sacrificing user-friendliness
- Schema serves as living documentation — the schema types are the single source of truth

### Consequences

- Good, because users get a commented config file that explains each option
- Good, because TypeBox validation catches typos and type mismatches before the daemon starts
- Good, because env var overrides enable fully declarative setup for Nix/immutable infrastructure
- Bad, because js-yaml adds ~100KB to the binary (negligible for a 58MB target)
- Bad, because we maintain two config sources (YAML files + env vars) that must be merged consistently
- Neutral, because TypeBox remains a dependency (kept for backward compat during transition) but all new validation uses Effect Schema

### Confirmation

The `tele-kb-bot setup` command writes the config file. The `tele-kb-bot start` command validates it on startup and exits with a descriptive error on invalid config. A unit test covers the merge logic for all env var overrides.

## Pros and Cons of the Options

### YAML with TypeBox validation

- Good, because YAML supports comments for inline documentation
- Good, because TypeBox provides structural validation at the type level
- Good, because js-yaml is a pure JS dependency (zero native modules, works with `bun build --compile`)
- Good, because YAML is familiar to DevOps and Kubernetes users
- Neutral, because YAML's significant whitespace can cause subtle parsing errors (handled by detailed error messages)
- Bad, because YAML parsing adds a dependency vs raw JSON

### JSON config

- Good, because JSON is natively supported by Bun/Node with no dependencies
- Good, because it's the simplest possible format
- Bad, because JSON has no comment support — users can't annotate their config
- Bad, because trailing commas are errors, making manual editing error-prone
- Bad, because JSON feels less approachable for a user-facing config file

### TOML

- Good, because TOML is precise and unambiguous
- Good, because it's standard in the Rust ecosystem (Homebrew, Cargo)
- Bad, because Bun has no built-in TOML parser — requires an additional dependency
- Bad, because TOML is less familiar than YAML for many users
- Neutral, because TOML supports comments and inline tables

### Env vars only

- Good, because there's no config file to manage or parse
- Good, because it integrates perfectly with Nix/home-manager
- Bad, because managing 15+ env vars is unwieldy for end users
- Bad, because there's no single file to inspect or edit
- Bad, because long-running daemons (launchd) need all vars in the plist

## More Information

The config system uses these files under `<config_dir>/`:

| Path                   | Purpose                                                    | Permissions |
| ---------------------- | ---------------------------------------------------------- | ----------- |
| `config.yaml`          | User-facing config (all non-secret options)                | 0600        |
| `agents/auth.json`     | API keys (written by setup, managed by pi SDK AuthStorage) | 0600        |
| `agents/models.json`   | Custom provider + model definitions for pi SDK             | 0644        |
| `agents/settings.json` | pi SDK settings (managed by SettingsManager)               | 0644        |
| `agents/sessions/`     | Per-chat session persistence (JSONL)                       | 0700        |
| `memory/`              | Knowledge base (markdown files)                            | 0700        |
| `telegram-tmp/`        | Downloaded Telegram files (auto-cleaned)                   | 0700        |

Secret keys follow a strict hygiene protocol:

1. Config file has `0600` permissions (user-only read/write)
2. `auth.json` has `0600` permissions
3. API keys are never logged, printed, or exposed in error messages
4. Env var overrides (`TELEGRAM_BOT_TOKEN`, `OPENER_GO_API_KEY`) are loaded at runtime, not stored in the binary
5. All critical env vars are documented in the `--help` output

### Related Decisions

- [ADR-0004](0004-pi-sdk-integration.md): pi SDK integration — all agent state uses the config directory structure defined here
- [ADR-0007](0007-distribution-strategy-homebrew.md): Distribution strategy — config isolation is a prerequisite for zero-secrets binary distribution
