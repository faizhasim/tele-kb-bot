/**
 * Text chunking utility for Telegram messages.
 *
 * Telegram has a 4096-character limit per message. This module
 * splits long text at paragraph boundaries while preserving readability.
 *
 * @module
 */

/** Maximum characters per Telegram message (including formatting) */
export const TELEGRAM_CHAR_LIMIT = 4096;

/** Maximum characters for caption on media */
export const TELEGRAM_CAPTION_LIMIT = 1024;

/**
 * Split text into chunks that fit within Telegram's character limit.
 * Splits at paragraph boundaries first, then sentence boundaries as fallback.
 *
 * @param text - The text to split
 * @param maxLength - Maximum characters per chunk (default: 4096)
 * @returns Array of text chunks
 */
export function splitIntoChunks(text: string, maxLength: number = TELEGRAM_CHAR_LIMIT): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph boundary (double newline)
    const paragraphSplit = findSplitPoint(remaining, maxLength, "\n\n");

    // Try to split at sentence boundary (period + space or newline)
    const sentenceSplit = paragraphSplit > 0 ? paragraphSplit : findSplitPoint(remaining, maxLength, /[.!?]\s/g);

    // Try to split at word boundary (space or newline)
    const wordSplit = sentenceSplit > 0 ? sentenceSplit : findSplitPoint(remaining, maxLength, /[\s\n]/g);

    if (wordSplit > 0) {
      chunks.push(remaining.substring(0, wordSplit).trim());
      remaining = remaining.substring(wordSplit).trim();
    } else {
      // Hard split at maxLength
      chunks.push(remaining.substring(0, maxLength));
      remaining = remaining.substring(maxLength);
    }
  }

  return chunks;
}

/**
 * Find the best split point at or before maxLength.
 * Searches for the delimiter and returns the position right after it.
 * Returns 0 if no delimiter found.
 */
function findSplitPoint(text: string, maxLength: number, delimiter: string | RegExp): number {
  const searchText = text.substring(0, maxLength);

  if (typeof delimiter === "string") {
    const lastIndex = searchText.lastIndexOf(delimiter);
    if (lastIndex > 0) {
      return lastIndex + delimiter.length;
    }
  } else {
    // RegExp — find last match
    let lastIndex = -1;
    let match: RegExpExecArray | null;
    const regex = new RegExp(delimiter.source, `g${delimiter.flags.includes("m") ? "m" : ""}`);
    for (match = regex.exec(searchText); match; match = regex.exec(searchText)) {
      if (match.index > 0 && match.index <= maxLength) {
        lastIndex = match.index + match[0].length;
      }
    }
    if (lastIndex > 0) {
      return lastIndex;
    }
  }

  return 0;
}

/**
 * Truncate a string to fit within the limit, appending a continuation marker.
 * Attempts to break at a sentence boundary.
 */
export function truncateWithMarker(
  text: string,
  maxLength: number = TELEGRAM_CHAR_LIMIT,
  marker: string = "\n\n_[continued]_",
): string {
  if (text.length <= maxLength) return text;

  const available = maxLength - marker.length;
  if (available <= 0) return text.substring(0, maxLength);

  const split = findSplitPoint(text, available, /[.!?\n]\s/g);
  const cutPoint = split > 0 ? split : available;
  return text.substring(0, cutPoint).trim() + marker;
}

/**
 * Truncate a caption to fit within Telegram's caption limit.
 */
export function truncateCaption(text: string, maxLength: number = TELEGRAM_CAPTION_LIMIT): string {
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength - 3)}...`;
}
