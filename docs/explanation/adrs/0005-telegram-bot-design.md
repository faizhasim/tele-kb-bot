---
status: accepted
date: 2026-05-21
decision-makers: faizhasim
---

# Telegram Bot Design and Message Flow

## Context and Problem Statement

tele-kb-bot needs to receive messages from Telegram, convert them into pi session prompts, and send responses back. How should we structure the Telegram integration — polling method, message handling, media processing, streaming, and error recovery?

The bot is a user-facing service running on a machine at home. It must handle text, photos, documents, and voice messages; debounce media groups; show typing indicators during processing; and chunk long responses at Telegram's 4096-character limit.

## Decision Drivers

- Long-polling (not webhook) — the machine is behind NAT with no static IP for webhook callbacks
- GrammY framework — mature, pure JS, compiles well with `bun build --compile`
- Media handling must be robust — photos, documents, and voice messages downloaded and cleaned up after processing
- Streaming preview via `sendChatAction("typing")` — users need feedback that the bot is working
- Response chunking at Telegram's 4096-character limit
- Graceful degradation on network errors with exponential backoff

## Considered Options

- **GrammY with long-polling** — Full-featured Telegram bot framework
- **Bare Telegram API calls via `fetch()`** — No framework, direct HTTP calls
- **GrammY with webhook** — Webhook-based receiving (requires public HTTPS endpoint)
- **Custom polling with grammY** — Using grammY's `Bot` class but customizing the polling loop

## Decision Outcome

Chosen option: **GrammY with long-polling**, because it provides the best balance of features, reliability, and binary size. GrammY's built-in polling handles timeouts, reconnection, and concurrent message processing.

### Consequences

- Good, because grammY's built-in polling handles connection management, timeouts (30s), and error recovery with minimal code
- Good, because grammY's type-safe API for file downloads, message sending, and chat actions reduces boilerplate
- Good, because grammY compiles cleanly with `bun build --compile` (pure JS, no native modules)
- Bad, because grammY adds ~200KB to the binary (acceptable for a 58MB target)
- Bad, because grammY's middleware model is overkill for our simple filter → forward → reply pattern

### Confirmation

1. `tele-kb-bot start` connects to Telegram and appears as online to authorized users
2. Text message → pi session prompt → response sent back (chunked if > 4096 chars)
3. Photo/document/voice → file downloaded to `telegram-tmp/` → included in prompt → cleaned up after reply
4. Typing indicator fires every 4s during processing
5. `/stop` aborts the current agent turn
6. Unauthorized user IDs are silently dropped

Verified by sending messages from an authorized Telegram account and inspecting logs.

## Pros and Cons of the Options

### GrammY with long-polling

- Good, because built-in `getUpdates` polling with configurable timeout and error handling
- Good, because `bot.on("message:text")`, `bot.on("message:photo")`, etc. provide clean message filtering
- Good, because `api.sendChatAction()` and `api.sendMessage()` are straightforward
- Good, because file downloading via `getFile()` and file URL construction is built-in
- Bad, because grammY's middleware pipeline adds unnecessary abstraction for our simple routing

### Bare Telegram API calls via `fetch()`

- Good, because zero dependencies — purely uses Bun's built-in `fetch()`
- Good, because full control over polling loop, retry, and error handling
- Bad, because we'd need to implement polling loop, timeout handling, reconnection, and error backoff ourselves
- Bad, because no built-in file download URL construction — we'd parse Telegram API responses manually
- Bad, because more code to write and test for the same functionality

### GrammY with webhook

- Good, because webhooks are more efficient than polling (no constant polling requests)
- Good, because grammY supports webhook mode natively
- Bad, because webhooks require a public HTTPS endpoint — the machine is on a home network behind NAT
- Bad, because webhooks need HTTPS certificate management and a tunnel (ngrok/Cloudflare Tunnel)
- Bad, because adds operational complexity that polling doesn't need

## More Information

### Message Flow

```
Telegram Client
    │
    │  getUpdates (long-poll, 30s timeout)
    ▼
GrammY Bot
    │
    ├── message:text ──→ Handler: inject as "[telegram-kb] <text>"
    ├── message:photo ─→ Handler: download file → include path + image data
    ├── message:document → Handler: download file → include path
    ├── message:voice ──→ Handler: download file → include path
    ├── message:media_group ─→ Debounce 1.2s → send as one prompt
    │
    ├── /stop ──────────→ Abort current turn
    ├── /start ─────────→ Welcome message + pair user
    │
    ▼
Allowed user check (filter by allowed_user_ids)
    │
    ▼
SessionRegistry.get(chatId) → PiSessionService
    │
    ├── prompt() → AgentSession.prompt()
    ├── On stream events → sendChatAction("typing") every 4s
    └── On agent_end → Send final response (chunked)
```

### Media Download Strategy

1. On photo/document/voice message, call `bot.api.getFile(fileId)` to get file path
2. Download file from `https://api.telegram.org/file/bot<token>/<file_path>`
3. Save to `<config_dir>/telegram-tmp/<uuid>.<ext>`
4. Include local path in the pi session prompt
5. Clean up temp file after response is sent

### Chunking Strategy

Telegram messages are limited to 4096 characters. The chunking utility:

1. Splits response text at paragraph boundaries (`\n\n`)
2. Reassembles paragraphs into chunks ≤ 4096 chars
3. Falls back to sentence splitting if a single paragraph exceeds 4096 chars
4. Sends chunks sequentially with typing indicator between chunks

### Error Recovery

- On network error (polling): exponential backoff 1s → 3s → 10s → 30s cap
- On Telegram API error (sending): retry once, then log and notify user
- On session error (LLM API down): queue message, return "Bot is thinking…" with backoff
- All errors logged via pino with structured error data

### Related Decisions

- [ADR-0004](0004-pi-sdk-integration.md): pi SDK integration — each message dispatches to a per-chat AgentSession created by the session registry
- [ADR-0002](0002-config-directory-and-schema.md): Config directory — `telegram-tmp/` and session paths live under `<config_dir>`
