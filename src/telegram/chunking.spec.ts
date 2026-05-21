/**
 * Tests for the Telegram text chunking utility.
 */

import { describe, expect, it } from "vitest";
import { splitIntoChunks, truncateCaption, truncateWithMarker } from "./chunking";

describe("splitIntoChunks", () => {
  it("returns single chunk for short text", () => {
    const result = splitIntoChunks("Hello, world!", 100);
    expect(result).toEqual(["Hello, world!"]);
  });

  it("splits at paragraph boundaries", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const result = splitIntoChunks(text, 30);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toContain("First paragraph");
    expect(result[1]).toContain("Second paragraph");
  });

  it("splits at sentence boundaries when no paragraph break", () => {
    const text = "First sentence here. Second sentence here. Third sentence here.";
    const result = splitIntoChunks(text, 25);
    expect(result.length).toBeGreaterThan(1);
  });

  it("hard-splits when no word boundary found within limit", () => {
    const text = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const result = splitIntoChunks(text, 10);
    expect(result[0]?.length).toBeLessThanOrEqual(12);
  });

  it("handles empty text", () => {
    const result = splitIntoChunks("", 100);
    expect(result).toEqual([""]);
  });

  it("handles text at exact limit", () => {
    const text = "A".repeat(100);
    const result = splitIntoChunks(text, 100);
    expect(result).toEqual([text]);
  });

  it("preserves total content across chunks", () => {
    const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.\n\nParagraph four.";
    const result = splitIntoChunks(text, 20);
    const combined = result.join(" ");
    expect(combined.length).toBeGreaterThan(0);
    expect(combined).toContain("Paragraph one");
    expect(combined).toContain("Paragraph four");
  });
});

describe("truncateWithMarker", () => {
  it("returns text unchanged if within limit", () => {
    const result = truncateWithMarker("Short text", 100);
    expect(result).toBe("Short text");
  });

  it("truncates and appends marker", () => {
    const text = "First sentence here. Second sentence here. Third sentence.";
    const result = truncateWithMarker(text, 30);
    expect(result).toContain("First sentence");
    expect(result).toContain("[continued]");
    expect(result.length).toBeLessThanOrEqual(33);
  });
});

describe("truncateCaption", () => {
  it("returns text unchanged if within limit", () => {
    const result = truncateCaption("Short caption", 100);
    expect(result).toBe("Short caption");
  });

  it("truncates long captions with ellipsis", () => {
    const text = "A".repeat(200);
    const result = truncateCaption(text, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith("...")).toBe(true);
  });
});
