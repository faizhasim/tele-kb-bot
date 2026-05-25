# Known Issues

This page documents quirks, limitations, and edge cases you may encounter when running tele-kb-bot. These are not necessarily bugs — some are by design, others reflect the trade-offs of a single-person side project.

---

## launchd Plist Path Resolution

The `tele-kb-bot launchd add` command generates a LaunchAgent plist and loads it with `launchctl bootstrap`. The plist encodes two important paths:

- The **binary path** (the `tele-kb-bot` executable itself)
- The **`PATH` environment variable** for the launchd context, which must include directories for `node`, `qmd`, and any other tools the process needs at runtime

The installer attempts to resolve these automatically:

- The binary path is resolved by looking at `argv[0]` first, then falling back to common Homebrew locations under `/opt/homebrew/bin` and `/usr/local/bin`.
- The Node.js path is detected via `which node`, and the resulting `bin/` directory is prepended to the `PATH` in the plist.

This heuristic works for the common case (Homebrew-installed tools), but it is **not foolproof**:

- If you use a version manager (`fnm`, `nvm`, `nodenv`, `asdf`) that installs Node.js outside standard paths, the detected `node` binary may differ from the one in your interactive shell.
- If `qmd` or other binaries are installed via a non-standard method (standalone script, manual tarball, Nix), they may not be on the launchd `PATH` at all.
- Launchd runs in a minimal environment — unlike your terminal, it does **not** source shell rc files. The `PATH` in the plist is the only PATH the service sees.

### What to do

If the service fails to start (check with `launchctl list`), inspect the generated plist:

```bash
cat ~/Library/LaunchAgents/com.tele-kb-bot.plist
```

Look at the `ProgramArguments` and `EnvironmentVariables` sections. If paths are missing or wrong, you have two options:

1. **Re-run `tele-kb-bot launchd add`** after making the tools available via Homebrew or standard paths.
2. **Edit the plist manually** and reload with:
   ```bash
   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.tele-kb-bot.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tele-kb-bot.plist
   ```

If you run into path resolution issues, consider making a `launchctl setenv PATH …` call in your shell startup, or symlinking your tools into `/opt/homebrew/bin`.

---

## LLM Provider Support

The pi SDK that powers tele-kb-bot's agent sessions supports a wide range of LLM providers through its model registry. In principle, **any provider the pi SDK supports should work** — there is no hard-coded provider whitelist in tele-kb-bot.

In practice, the bot has been tested primarily with:

- **Provider:** `opencode-go`
- **Model:** `deepseek-v4-flash`

This is what the author runs day-to-day. Other provider/model combinations may work but have not been exercised in production-like conditions. If you encounter issues with a different provider, here are some things to check:

- Is the provider registered in the pi SDK's model registry? Run `tele-kb-bot status` to verify the SDK version and model count.
- Does the provider require additional environment variables or authentication that tele-kb-bot's config schema doesn't expose? The config supports `provider`, `model`, `api_key`, and `reasoning` — if your provider needs extra params, you may need to extend the schema or wire them through the pi SDK directly.

!!! tip "Interested in a different provider?"
    Reach out via [GitHub](https://github.com/faizhasim/tele-kb-bot) if you'd like to help test or contribute support for a specific provider. Contributions are welcome.

---

## Memory Backend Options

tele-kb-bot ships with two memory search backends for its knowledge base:

### qmd (default in production)

The **qmd** backend is the primary recommendation and what the author uses. It provides keyword + vector search over markdown knowledge bases and supports incremental indexing. To enable it, set `memory.qmd.enabled: true` in your config.

The `tele-kb-bot launchd add` installer attempts to detect the `qmd` binary path and include it on the launchd `PATH`. See [launchd](#launchd-plist-path-resolution) above for caveats.

### BM25 (in-memory)

The built-in BM25 backend runs entirely in-process — no external binary needed. It uses a keyword-based ranking algorithm over your vault directories. To use it, leave `memory.qmd.enabled: false` (the default).

!!! question "How does it compare to qmd?"
    BM25 is simpler, faster to index (no vectorisation step), and has zero external dependencies. However, it only does keyword matching — it won't find semantically related content the way qmd's hybrid search does.

    If you're running BM25 in-memory, [let the author know](https://github.com/faizhasim/tele-kb-bot) how it works for your use case. Real-world feedback helps prioritise improvements.

### BM25 (on-disk)

A persistent/on-disk BM25 backend is technically feasible — the scoring algorithm is the same, just backed by a disk-resident index instead of holding everything in memory. This has not been prioritised because the author uses qmd, which already handles persistence and incremental updates.

If you need on-disk BM25 (for example, to reduce memory usage with a very large knowledge base without depending on qmd), open an issue or reach out. The building blocks are there; it mainly needs a serialisation format and lifecycle wiring.

---

## Text-Only Chat

tele-kb-bot currently only processes **text messages**. Voice messages, images, videos, stickers, and other non-text media are silently ignored — the bot does not transcribe, caption, or analyse them.

This is a deliberate scope limitation rather than a technical blocker. Adding media processing would require:

- Voice transcription (via Whisper or a provider API)
- Image understanding (vision-capable models, image attachment handling in GrammY)
- Media type detection and routing in the message handler

None of these are on the immediate roadmap. If media support is important for your use case, contributions or feature requests are welcome on [GitHub](https://github.com/faizhasim/tele-kb-bot).
