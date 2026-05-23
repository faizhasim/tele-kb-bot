---
status: accepted
date: 2026-05-21
decision-makers: Mohd Faiz Hasim
---

# CLI Command Structure and Design

## Context and Problem Statement

tele-kb-bot needs a CLI for setup, operation, and management. What commands should it expose, how should arguments be parsed, and how do we handle interactive vs non-interactive modes?

The CLI is the primary user-facing interface — it must be discoverable (`--help`), shell-friendly (exit codes, non-interactive mode for Nix), and secure (never leak secrets in process listings).

## Decision Drivers

- First-run experience must be guided (wizard-style `setup` command)
- Nix/home-manager users need non-interactive mode (env-var-based)
- The daemon needs a `start` foreground command for both testing and launchd
- launchd lifecycle requires `install/uninstall` commands
- Health checking needs a `status` command
- Help and version must always work

## Considered Options

- **Minimal CLI with manual argv parsing** — No framework, parse `process.argv` directly
- **commander/yargs** — Full-featured CLI frameworks with subcommand support
- **Bun's built-in argparse** — `Bun.argv` with minimal helpers

## Decision Outcome

Chosen option: **Minimal CLI with manual argv parsing**, because:

- We only have ~6 subcommands — a framework is overkill for this scope
- No additional dependency = smaller binary, no security surface
- Bun's `process.argv` + simple switch/case is straightforward and traceable
- The `--help` flag is handled explicitly with a help text template
- Non-interactive mode uses env vars, not flags, which keeps the parsing simple

### Consequences

- Good, because the CLI code is trivial (~100 lines for the router) with zero dependencies
- Good, because the help text is a template string that's easy to update
- Good, because every command is a standalone exported function expression — easy to test and compose
- Good, because `start` uses dynamic import to break a circular dependency between `cli/main.ts` and `daemon/main.ts`
- Bad, because no automatic flag validation (we validate manually in each command)
- Bad, because no auto-generated help from option definitions

### Confirmation

The entry point `src/index.ts` routes to subcommand modules in `src/cli/`. Each module is tested with `bun test`. The compiled binary's `--help` output is verified in CI.

## Pros and Cons of the Options

### Minimal CLI with manual argv parsing

- Good, because zero dependencies and full control
- Good, because the command set is small and stable
- Good, because `process.argv` is universally available in Bun and Node
- Bad, because no automatic `--help` generation for subcommands
- Bad, because flag parsing (e.g., `--config`) requires manual handling

### commander/yargs

- Good, because declarative command definitions with auto-generated help
- Good, because built-in flag parsing, validation, and error messages
- Bad, because adds ~200KB to the binary (commander) or ~500KB (yargs)
- Bad, because both have occasional compatibility issues with `bun build --compile`
- Bad, because overkill for 6 subcommands

### Bun's built-in argparse

- Good, because it's built into Bun (no dependency)
- Bad, because it's experimental and API is unstable
- Bad, because it lacks subcommand routing support
- Bad, because it's not well-documented for CLI app use

## More Information

CLI structure:

```
tele-kb-bot setup          Interactive wizard (or --non-interactive with env vars)
tele-kb-bot start          Run daemon in foreground
tele-kb-bot status         Show health and config status
tele-kb-bot install        Create + load launchd plist
tele-kb-bot version        Print version
tele-kb-bot help           Print help
```

Global flags (parsed before command routing):

- `--config <path>`: Override config directory
- `--non-interactive`: Skip prompts (for `setup`)

Exit codes:

- 0: Success
- 1: General error
- 2: Config validation error

### Implementation Details

- All CLI modules use `const fn = (...) => ...` (function expressions), not `function` declarations
- Logger uses `createCLILogger` for synchronous CLI logging (wraps pino)
- Shared constants (`BINARY_NAME`, `VERSION`) extracted to `src/constants.ts` to break circular imports
- The `start` command uses `await import("../daemon/main")` (dynamic import) since `daemon/main.ts` imports from `constants`, avoiding a circular reference with `cli/main.ts`

### Related Decisions

- [ADR-0007](0007-distribution-strategy-homebrew.md): Distribution strategy — `tele-kb-bot install` creates the launchd plist for brew-installed binaries
- [ADR-0004](0004-pi-sdk-integration.md): pi SDK integration — `tele-kb-bot start` initializes the daemon that creates AgentSessions
