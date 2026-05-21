import { describe, expect, it } from "vitest";
import { buildMemoryContext } from "./context";

describe("buildMemoryContext", () => {
  it("returns sections for provided inputs", () => {
    const ctx = buildMemoryContext({
      scratchpad: "- [ ] fix auth\n- [x] deploy",
      todayLog: "worked on memory system",
      searchResults: [{ filePath: "MEMORY.md", score: 1.2, snippet: "model-choice" }],
      longTermMemory: "#decisions model-choice",
    });
    expect(ctx).toContain("SCRATCHPAD");
    expect(ctx).toContain("fix auth");
    expect(ctx).toContain("Daily log (today)");
    expect(ctx).toContain("Relevant memories");
    expect(ctx).toContain("MEMORY.md (long-term)");
  });

  it("handles empty input gracefully", () => {
    const ctx = buildMemoryContext({});
    expect(ctx).toBe("");
  });

  it("handles empty search results", () => {
    const ctx = buildMemoryContext({
      scratchpad: "- [ ] test",
      searchResults: [],
    });
    expect(ctx).toContain("test");
    expect(ctx).not.toContain("Relevant memories");
  });

  it("caps output at ~16K chars", () => {
    const big = "x".repeat(20_000);
    const ctx = buildMemoryContext({ longTermMemory: big });
    expect(ctx.length).toBeLessThanOrEqual(17_000);
  });
});
