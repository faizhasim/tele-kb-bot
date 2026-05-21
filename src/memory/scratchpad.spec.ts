import { describe, expect, it } from "vitest";
import { addItem, clearDone, markDone, parseScratchpad, renderScratchpad } from "./scratchpad";

describe("parseScratchpad", () => {
  it("parses open items", () => {
    const items = parseScratchpad("- [ ] fix login bug\n- [ ] write tests\n");
    expect(items).toHaveLength(2);
    expect(items[0]?.done).toBe(false);
    expect(items[0]?.text).toBe("fix login bug");
  });

  it("parses done items", () => {
    const items = parseScratchpad("- [x] deploy\n- [X] logout\n");
    expect(items[0]?.done).toBe(true);
    expect(items[1]?.done).toBe(true);
  });

  it("ignores non-checklist lines", () => {
    const items = parseScratchpad("# Header\n- [ ] real item\nsome text\n");
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe("real item");
  });

  it("returns empty array for empty content", () => {
    expect(parseScratchpad("")).toEqual([]);
  });
});

describe("renderScratchpad", () => {
  it("renders items to markdown", () => {
    const rendered = renderScratchpad([
      { text: "a", done: false },
      { text: "b", done: true },
    ]);
    expect(rendered).toBe("- [ ] a\n- [x] b\n");
  });
});

describe("addItem", () => {
  it("adds item at front by default", () => {
    const result = addItem([{ text: "existing", done: false }], "new");
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe("new");
  });
});

describe("markDone", () => {
  it("marks an item done", () => {
    const result = markDone([{ text: "x", done: false }], 0);
    expect(result[0]?.done).toBe(true);
  });

  it("no-ops on out-of-range index", () => {
    const result = markDone([{ text: "x", done: false }], 99);
    expect(result[0]?.done).toBe(false);
  });
});

describe("clearDone", () => {
  it("removes done items", () => {
    const result = clearDone([
      { text: "open", done: false },
      { text: "done", done: true },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe("open");
  });
});
