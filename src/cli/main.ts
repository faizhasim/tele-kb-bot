/**
 * CLI command router for tele-kb-bot.
 *
 * Parses command-line arguments, routes to subcommand handlers.
 *
 * @module
 */

import { BINARY_NAME, VERSION } from "../constants";
import { createCLILogger } from "../logger";
import { helpCommand } from "./help";
import { installCommand } from "./install";
import { setupCommand } from "./setup";
import { statusCommand } from "./status";

export { BINARY_NAME, VERSION };

export interface CLIOptions {
  command: string;
  configOverride?: string;
  nonInteractive: boolean;
  rawArgs: string[];
}

/**
 * Parse CLI arguments into options.
 */
const parseArgs = (args: Array<string>): CLIOptions => {
  const command = args[0]?.toLowerCase() ?? "help";
  const configIndex = args.indexOf("--config");
  const configOverride = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const nonInteractive = args.includes("--non-interactive");
  return { command, configOverride, nonInteractive, rawArgs: args };
};

/**
 * Run the CLI with the given arguments.
 */
const runCLI = async (args: Array<string>): Promise<void> => {
  const options = parseArgs(args);
  const log = createCLILogger(BINARY_NAME);
  log.debug({ command: options.command, configOverride: options.configOverride }, "CLI command");

  switch (options.command) {
    case "setup":
      await setupCommand(options);
      break;
    case "start": {
      const { startDaemon } = await import("../daemon/main");
      await startDaemon(options.configOverride);
      break;
    }
    case "status":
      await statusCommand(options);
      break;
    case "install":
      await installCommand(options);
      break;
    case "version":
      console.log(`${BINARY_NAME} v${VERSION}`);
      break;
    default:
      helpCommand();
      break;
  }
};

export { parseArgs, runCLI };
