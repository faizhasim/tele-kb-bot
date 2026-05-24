/**
 * CLI command router for tele-kb-bot.
 *
 * Parses command-line arguments, routes to subcommand handlers.
 * Supports subcommands (e.g. "launchd add", "systemd remove").
 *
 * @module
 */

import { BINARY_NAME, VERSION } from '../constants';
import { createCLILogger } from '../logger';
import { helpCommand } from './help';
import { indexCommand } from './index';
import { launchdAddCommand, launchdRemoveCommand } from './launchd';
import { setupCommand } from './setup';
import { statusCommand } from './status';
import { systemdAddCommand, systemdRemoveCommand } from './systemd';

export { BINARY_NAME, VERSION };

export interface CLIOptions {
  command: string;
  subcommand?: string;
  configOverride?: string;
  nonInteractive: boolean;
  rawArgs: string[];
}

/** Commands that accept a subcommand (e.g. "launchd add"). */
const SUBCOMMAND_COMMANDS = new Set(['launchd', 'systemd']);

/**
 * Parse CLI arguments into options.
 */
const parseArgs = (args: Array<string>): CLIOptions => {
  const command = args[0]?.toLowerCase() ?? 'help';

  // Detect subcommand: "launchd add" → command=launchd, subcommand=add
  let subcommand: string | undefined;
  if (SUBCOMMAND_COMMANDS.has(command) && args[1]) {
    subcommand = args[1].toLowerCase();
  }

  const configIndex = args.indexOf('--config');
  const configOverride = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const nonInteractive = args.includes('--non-interactive');
  return { command, subcommand, configOverride, nonInteractive, rawArgs: args };
};

/**
 * Run the CLI with the given arguments.
 */
const runCLI = async (args: Array<string>): Promise<void> => {
  const options = parseArgs(args);
  const log = createCLILogger(BINARY_NAME);
  log.debug(
    { command: options.command, subcommand: options.subcommand, configOverride: options.configOverride },
    'CLI command',
  );

  switch (options.command) {
    case 'setup':
      await setupCommand(options);
      break;
    case 'start': {
      const { startDaemon } = await import('../daemon/main');
      await startDaemon(options.configOverride);
      break;
    }
    case 'status':
      await statusCommand(options);
      break;

    // launchd add|remove
    case 'launchd':
      switch (options.subcommand) {
        case 'add':
          await launchdAddCommand(options);
          break;
        case 'remove':
          await launchdRemoveCommand();
          break;
        default:
          helpCommand();
          break;
      }
      break;

    // systemd add|remove
    case 'systemd':
      switch (options.subcommand) {
        case 'add':
          await systemdAddCommand(options);
          break;
        case 'remove':
          await systemdRemoveCommand();
          break;
        default:
          helpCommand();
          break;
      }
      break;

    // Backward compat alias
    case 'install-launchd':
      await launchdAddCommand(options);
      break;

    case 'index':
      await indexCommand(options);
      break;
    case 'version':
      console.log(`${BINARY_NAME} v${VERSION}`);
      break;
    default:
      helpCommand();
      break;
  }
};

export { parseArgs, runCLI };
