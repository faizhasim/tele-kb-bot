/**
 * CLI output helpers for tele-kb-bot.
 *
 * Provides styled, consistent printing for all CLI commands.
 * Uses picocolors for terminal formatting.
 *
 * @module
 */

import pc from 'picocolors';

/** Print a bold heading (e.g. app name). */
export function header(text: string): void {
  console.log(pc.bold(text));
}

/** Print a section heading (e.g. "COMMANDS:", "OPTIONS:"). */
export function section(text: string): void {
  console.log(pc.bold(text));
}

/** Print a dimmed secondary heading (e.g. "USAGE"). */
export function subheading(text: string): void {
  console.log(pc.underline(text));
}

/** Print a command with its description, aligned to column. */
export function command(cmd: string, description: string): void {
  console.log(`  ${pc.cyan(cmd.padEnd(22))}${pc.dim(description)}`);
}

/** Print a key: value pair. */
export function item(label: string, value: string): void {
  console.log(`  ${pc.cyan(label)}  ${value}`);
}

/** Print an informational message. */
export function info(text: string): void {
  console.log(`  ${text}`);
}

/** Print a success indicator. */
export function success(text: string): void {
  console.log(`  ${pc.green('✓')} ${text}`);
}

/** Print an error indicator. */
export function error(text: string): void {
  console.log(`  ${pc.red('✗')} ${text}`);
}

/** Print a dimmed helper line. */
export function dim(text: string): void {
  console.log(pc.dim(text));
}

/** Print an empty line. */
export function blank(): void {
  console.log();
}
