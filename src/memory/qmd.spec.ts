import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detect, reset, search } from "./qmd";

describe("detect", () => {
  beforeEach(() => reset());
  afterEach(() => reset());

  it("returns false when qmd is not in PATH", () => {
    vi.stubGlobal("process", { ...process, env: { ...process.env, PATH: "/dev/null" } });
    // Re-import with mocked PATH to verify detection fails
    expect(detect()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("parseOutput", () => {
  it("handles empty string gracefully", () => {
    expect(search("", 5)).toBeNull();
  });
});
