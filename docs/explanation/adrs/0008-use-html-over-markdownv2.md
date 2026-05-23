---
status: accepted
date: 2026-05-21
decision-makers: Mohd Faiz Hasim
---

# Use HTML parse_mode over MarkdownV2 for Telegram Messages

## Context and Problem Statement

tele-kb-bot sends LLM-generated responses to Telegram via the `sendMessage` API. Telegram supports two rich-text parsing modes: MarkdownV2 and HTML. The bot started with MarkdownV2 but hit repeated `"can't parse entities"` errors because the LLM output unescaped special characters like `(` and `)` in link text and file paths.

Which parse mode should the bot use to reliably render rich text without crashing on LLM-generated content?

## Decision Drivers

- LLM output is unpredictable — the agent may include special characters without escaping them
- Obsidian URIs use `obsidian://` custom protocol — Telegram blocks custom protocols in both `<a>` tags and `InlineKeyboard.url()` buttons
- Fallback on parse failure should preserve as much content as possible
- The formatting syntax must be easy for the LLM to generate correctly (LLMs are trained on massive HTML corpora)

## Considered Options

- **MarkdownV2 with character escaping fallback** — Send with `parse_mode: 'MarkdownV2'`; on failure, strip all Markdown special characters via regex and retry as plain text
- **HTML with tag-stripping fallback** — Send with `parse_mode: 'HTML'`; on failure, strip HTML tags via regex and retry as plain text
- **Plain text only** — No parsing mode; no formatting, no clickable links

## Decision Outcome

Chosen option: **HTML with tag-stripping fallback**, because HTML is more forgiving of malformed input, LLMs are fluent in HTML syntax from web training data, and the fallback path is simpler and more content-preserving.

### Consequences

- Good, because Telegram's HTML parser is lenient — stray unclosed tags don't crash, they just don't render
- Good, because the only characters that need escaping in HTML are `<`, `>`, and `&` — far fewer than MarkdownV2's `_ * [ ] ( ) ~ \` > # + - = | { } . !`
- Good, because the fallback (`<[^>]*>` regex) strips only tags, preserving all text content — unlike the MarkdownV2 fallback which strips formatting chars mixed with content
- Neutral, because Obsidian URIs cannot be made clickable — Telegram blocks custom protocol URLs (`obsidian://`) in both inline `<a>` tags and `InlineKeyboard.url()` buttons. The LLM is instructed to render them as `<code>` blocks for manual copy-paste
- Good, because LLMs (especially GPT/DeepSeek families) are trained on massive HTML corpora and naturally generate valid HTML
- Bad, because HTML is slightly more verbose than MarkdownV2 (`<b>bold</b>` vs `**bold**`)
- Bad, because HTML tags add noise to the prompt response (though this is negligible)

### Confirmation

The `sendChunked` function in `src/daemon/bot.ts` uses `parse_mode: 'HTML'` and falls back to HTML tag stripping on error. Obsidian URIs are rendered as `<code>` blocks (not `<a>` links) after confirming Telegram blocks custom protocols everywhere. The system prompt in `src/constants/system-prompt.ts` documents the HTML formatting tags and the Obsidian URI copy-paste workflow.

## Pros and Cons of the Options

### HTML with tag-stripping fallback

- Good, because Telegram's HTML parser is resilient — it handles malformed, nested, or truncated tags gracefully
- Good, because only three characters need escaping (`<`, `>`, `&`), making it far less error-prone for LLM output
- Good, because the fallback regex `<[^>]*>` cleanly removes HTML tags without affecting the text content
- Good, because LLMs have extensive HTML knowledge from web training data
- Good, because `<a href="...">` links work naturally for Obsidian URIs with parentheses in the path
- Bad, because HTML is more verbose per unit of formatting

### MarkdownV2 with character escaping fallback

- Good, because MarkdownV2 is more compact than HTML
- Good, because triple backticks for code blocks are intuitive
- Bad, because MarkdownV2 has 15+ special characters that must be escaped when literal: `_ * [ ] ( ) ~ \` > # + - = | { } . !`
- Bad, because the LLM cannot reliably predict which characters need escaping in context — especially parentheses in link text `[Stage 2(a)]`
- Bad, because the fallback regex strips all formatting characters from the text, losing content (parentheses, asterisks, brackets used in normal writing)
- Bad, because Telegram's MarkdownV2 parser rejects the entire message on the first unescaped character — no partial rendering

### Plain text only

- Good, because zero parse errors — always works
- Bad, because no bold, italic, code blocks, or clickable links
- Bad, because Obsidian URIs appear as raw unclickable text
- Bad, because readability suffers significantly for structured responses

## Caveats: Custom Protocol URIs (Obsidian)

Telegram's API enforces a strict security policy on URLs:

- **Inline `<a href="...">` links**: Only `http://`, `https://`, and `tg://` protocols are allowed. Custom schemes like `obsidian://` are rejected with `"Unsupported URL protocol"`.
- **`InlineKeyboard.url()` buttons**: Same restriction — Telegram validates the URL server-side. Custom protocol buttons are rejected with the same error.

The bot initially tried:
1. `<a href="obsidian://...">` links in HTML text — rejected by Telegram's parser
2. `InlineKeyboard.url()` buttons — rejected server-side with "Unsupported URL protocol"

The final approach is to render Obsidian URIs as `<code>` blocks for easy copy-paste:

```
<code>obsidian://open?vault=Main&file=Projects/Idea.md</code>
```

The system prompt instructs the LLM to always include the full URI as a `<code>` block so the user can copy it into Obsidian's Quick Open (Cmd+O on desktop, or long-press on mobile).

## More Information

Telegram's supported HTML tags are documented at https://core.telegram.org/bots/api#html-style

The system prompt explicitly tells the LLM which HTML tags are available and how to use them. The fallback path is triggered only when the LLM generates malformed HTML (rare with modern models).

### Related Decisions

- [ADR-0005](0005-telegram-bot-design.md): Telegram bot design — `sendChunked` handles message delivery and chunking
- [ADR-0007](0007-distribution-strategy-homebrew.md): Distribution strategy — the agent's formatting instructions live in compiled-in system prompt constants
