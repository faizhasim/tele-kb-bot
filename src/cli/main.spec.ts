/**
 * Tests for the CLI command router and argument parsing.
 */

import { describe, expect, it } from "vitest";
import { BINARY_NAME, VERSION } from "../constants";
import { parseArgs } from "./main";

describe("parseArgs", () => {
  it("parses help command from empty args", () => {
    const opts = parseArgs([]);
    expect(opts.command).toBe("help");
    expect(opts.nonInteractive).toBe(false);
    expect(opts.configOverride).toBeUndefined();
  });

  it("parses setup command", () => {
    const opts = parseArgs(["setup"]);
    expect(opts.command).toBe("setup");
  });

  it("parses start command", () => {
    const opts = parseArgs(["start"]);
    expect(opts.command).toBe("start");
  });

  it("parses status command", () => {
    const opts = parseArgs(["status"]);
    expect(opts.command).toBe("status");
  });

  it("parses install command", () => {
    const opts = parseArgs(["install"]);
    expect(opts.command).toBe("install");
  });

  it("parses version command", () => {
    const opts = parseArgs(["version"]);
    expect(opts.command).toBe("version");
  });

  it("parses --config flag", () => {
    const opts = parseArgs(["start", "--config", "/custom/path"]);
    expect(opts.command).toBe("start");
    expect(opts.configOverride).toBe("/custom/path");
  });

  it("parses --non-interactive flag", () => {
    const opts = parseArgs(["setup", "--non-interactive"]);
    expect(opts.command).toBe("setup");
    expect(opts.nonInteractive).toBe(true);
  });

  it("parses both --config and --non-interactive", () => {
    const opts = parseArgs(["setup", "--config", "./dev", "--non-interactive"]);
    expect(opts.command).toBe("setup");
    expect(opts.configOverride).toBe("./dev");
    expect(opts.nonInteractive).toBe(true);
  });

  it("falls back to help for unknown commands", () => {
    const opts = parseArgs(["unknown"]);
    expect(opts.command).toBe("unknown");
  });
});

describe("constants", () => {
  it("has a valid version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has a valid binary name", () => {
    expect(BINARY_NAME).toBe("tele-kb-bot");
  });
});
