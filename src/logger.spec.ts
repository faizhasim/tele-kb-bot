import { describe, expect, it } from "vitest";

describe("createCLILogger", () => {
  it("creates a logger with the given name", async () => {
    // Dynamic import to avoid pino mock issues with bun test
    const { createCLILogger } = await import("./logger");
    const log = createCLILogger("test");
    expect(log).toBeDefined();
    expect(typeof log.info).toBe("function");
    // Smoke test — should not throw
    expect(() => log.info("hello")).not.toThrow();
  });
});
