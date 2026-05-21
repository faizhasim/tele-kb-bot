/**
 * tele-kb-bot setup wizard — interactive first-run configuration.
 *
 * Supports both interactive (prompt-based) and non-interactive (env-var) modes.
 * Creates the config directory structure, writes config.yaml, agents/auth.json,
 * and agents/models.json. Validates the Telegram bot token via getMe API.
 *
 * @module
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import yaml from "js-yaml";
import { ensureConfigDirs, resolveConfigDir } from "../config/paths";
import { BINARY_NAME } from "../constants";
import { createCLILogger } from "../logger";
import type { CLIOptions } from "./main";

const CONFIG_FILENAME = "config.yaml";
const AUTH_FILENAME = "auth.json";
const MODELS_FILENAME = "models.json";

// ─── Readline Helpers ────────────────────────────────────────────────

/**
 * Prompt the user for a value via stdin.
 * Prints a prompt and waits for a line of input.
 */
async function prompt(question: string, silent = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  return new Promise<string>((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });

    // If silent mode is requested, hide input
    // Note: full silent input requires raw mode which varies by platform.
    // We use this as best-effort; in compiled binary raw mode may not work.
    if (silent) {
      try {
        const stdin = process.stdin;
        if (stdin.isTTY) {
          stdin.setRawMode?.(true);
        }
      } catch {
        // Non-TTY or raw mode not available — input will be visible
      }
    }
  });
}

/**
 * Confirm a yes/no question. Defaults to yes if the user just presses Enter.
 */
async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await prompt(`${question} ${hint} `);
  if (answer === "") return defaultYes;
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

// ─── Telegram API ────────────────────────────────────────────────────

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface GetMeResponse {
  ok: boolean;
  result?: TelegramUser;
  description?: string;
}

/**
 * Call Telegram's getMe API to validate a bot token.
 * Returns the bot user info on success, or an error message on failure.
 */
async function validateBotToken(token: string): Promise<{
  ok: boolean;
  bot?: TelegramUser;
  error?: string;
}> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const data = (await response.json()) as GetMeResponse;

    if (data.ok && data.result) {
      return { ok: true, bot: data.result };
    }
    return {
      ok: false,
      error: data.description ?? "Unknown error from Telegram API",
    };
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── File Writers ────────────────────────────────────────────────────

/**
 * Write config.yaml with the provided values.
 */
function writeConfigYaml(configDir: string, config: Record<string, unknown>): void {
  const configPath = join(configDir, CONFIG_FILENAME);
  const yamlContent = yaml.dump(config, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  writeFileSync(configPath, yamlContent, { mode: 0o600 });
}

/**
 * Write agents/auth.json for the pi SDK.
 */
function writeAuthJson(configDir: string, apiKey: string): void {
  const authPath = join(configDir, "agents", AUTH_FILENAME);
  const authData = {
    "opencode-go": {
      type: "api_key",
      key: apiKey,
    },
  };
  writeFileSync(authPath, `${JSON.stringify(authData, null, 2)}\n`, {
    mode: 0o600,
  });
}

/**
 * Write agents/models.json for the pi SDK — defines the Opencode Go provider.
 */
function writeModelsJson(configDir: string): void {
  const modelsPath = join(configDir, "agents", MODELS_FILENAME);
  const modelsData = {
    providers: [
      {
        name: "opencode-go",
        baseUrl: "https://api.opencode.go/v1",
        // placeholder: pi SDK resolves from OPENER_GO_API_KEY env var at runtime
        apiKey: "<from-env-var:OPENER_GO_API_KEY>",
        models: [
          {
            id: "deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            reasoning: true,
            contextWindow: 128_000,
            maxTokens: 8192,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
          },
        ],
      },
    ],
  };
  writeFileSync(modelsPath, `${JSON.stringify(modelsData, null, 2)}\n`, {
    mode: 0o644,
  });
}

// ─── Config Builder ──────────────────────────────────────────────────

/**
 * Build the full config object from user-provided values.
 */
function buildConfig(botToken: string, allowedUserIds: number[], apiKey?: string): Record<string, unknown> {
  const config: Record<string, unknown> = {
    telegram: {
      bot_token: botToken,
      allowed_user_ids: allowedUserIds,
    },
    llm: {
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      reasoning: "high",
    },
    memory: {
      enabled: true,
      auto_inject: true,
      search: {
        max_results: 5,
        mode: "keyword",
      },
    },
    bot: {
      max_attachments_per_turn: 10,
      streaming_preview: true,
      text_chunk_size: 4096,
    },
  };

  if (apiKey) {
    (config.llm as Record<string, unknown>).api_key = apiKey;
  }

  return config;
}

// ─── Main Setup Command ──────────────────────────────────────────────

/**
 * Run the setup command.
 *
 * Interactive mode (default): prompts the user for bot token, user IDs, and API key.
 * Non-interactive mode: reads from environment variables.
 */
export async function setupCommand(options: CLIOptions): Promise<void> {
  const log = createCLILogger(BINARY_NAME);
  const configDir = options.configOverride ?? resolveConfigDir();
  const configPath = join(configDir, CONFIG_FILENAME);

  console.log(`\n  ╭──────────────────────────────────────╮`);
  console.log(`  │    tele-kb-bot — Setup Wizard        │`);
  console.log(`  ╰──────────────────────────────────────╯\n`);
  console.log(`  Config directory: ${configDir}\n`);

  // Check if config already exists
  if (existsSync(configPath)) {
    const overwrite = await confirm("Config already exists. Overwrite?", false);
    if (!overwrite) {
      console.log("  Setup cancelled. Existing config preserved.");
      return;
    }
    console.log();
  }

  // Ensure config directory structure
  ensureConfigDirs(configDir);

  // ── Collect values ──────────────────────────────────────────────

  let botToken: string;
  let allowedUserIds: number[];
  let apiKey: string | undefined;

  if (options.nonInteractive) {
    // Non-interactive mode: read from env vars
    botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
    if (!botToken) {
      console.error("  ✗ TELEGRAM_BOT_TOKEN environment variable is required.");
      console.error("    Set it before running: TELEGRAM_BOT_TOKEN=xxx tele-kb-bot setup --non-interactive");
      process.exit(1);
    }

    const userIdsStr = process.env.TELEGRAM_ALLOWED_USER_IDS ?? "";
    if (!userIdsStr) {
      console.error("  ✗ TELEGRAM_ALLOWED_USER_IDS environment variable is required.");
      console.error(
        "    Set it before running: TELEGRAM_ALLOWED_USER_IDS=111111111 tele-kb-bot setup --non-interactive",
      );
      process.exit(1);
    }
    allowedUserIds = userIdsStr
      .split(",")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !Number.isNaN(id));

    if (allowedUserIds.length === 0) {
      console.error("  ✗ TELEGRAM_ALLOWED_USER_IDS must contain at least one valid numeric ID.");
      process.exit(1);
    }

    apiKey = process.env.OPENER_GO_API_KEY ?? undefined;
    if (apiKey && apiKey.length === 0) apiKey = undefined;
  } else {
    // Interactive mode: prompt user
    console.log("  First, let's configure your Telegram bot.\n");

    botToken = await prompt("  Telegram bot token (from @BotFather): ");
    while (!botToken || botToken.length === 0) {
      console.log("  Bot token is required.");
      botToken = await prompt("  Telegram bot token: ");
    }

    const userIdsInput = await prompt("  Allowed Telegram user IDs (comma-separated numbers): ");
    allowedUserIds = userIdsInput
      .split(",")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !Number.isNaN(id));

    while (allowedUserIds.length === 0) {
      console.log("  At least one numeric user ID is required.");
      const retry = await prompt("  Allowed Telegram user IDs (comma-separated): ");
      allowedUserIds = retry
        .split(",")
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !Number.isNaN(id));
    }

    console.log();
    const addKey = await confirm("  Configure LLM API key (OPENER_GO_API_KEY)?", true);
    if (addKey) {
      apiKey = await prompt("  LLM API key: ");
      if (apiKey && apiKey.length === 0) apiKey = undefined;
    }
    console.log();
  }

  // ── Validate bot token ──────────────────────────────────────────

  log.info("Validating Telegram bot token...");
  const validation = await validateBotToken(botToken);

  if (!validation.ok) {
    console.error(`\n  ✗ Bot token validation failed: ${validation.error}`);
    console.error("  Please check your token and try again.");
    console.error("  You can get a new token from https://t.me/BotFather\n");
    process.exit(1);
  }

  const bot = validation.bot;

  // ── Write files ─────────────────────────────────────────────────

  log.info("Writing configuration...");

  // Write config.yaml
  const config = buildConfig(botToken, allowedUserIds, apiKey);
  writeConfigYaml(configDir, config);
  log.info({ configPath }, "Config written");

  // Write agents/auth.json
  if (apiKey) {
    writeAuthJson(configDir, apiKey);
    log.info("Auth credentials written");
  }

  // Write agents/models.json
  writeModelsJson(configDir);
  log.info("Models configuration written");

  // ── Success summary ─────────────────────────────────────────────

  console.log(`\n  ✓ Config written to: ${configPath}`);
  console.log(`  ✓ Telegram bot: ${bot.first_name}${bot.username ? ` (@${bot.username})` : ""}`);
  console.log(`  ✓ Config directory: ${configDir}`);

  if (apiKey) {
    console.log(`  ✓ Agents auth configured`);
  } else {
    console.log(`  ⚠  LLM API key not configured. Set OPENER_GO_API_KEY env var to use the bot.`);
  }

  console.log(`\n`);

  // Offer to install launchd service
  const doInstall = await confirm("  Install launchd service now?", true);
  if (doInstall) {
    // Dynamic import to avoid circular deps — install is a separate module
    const { installCommand } = await import("./install");
    await installCommand(options);
  }

  console.log(`\n  Next steps:`);
  console.log(`    ${BINARY_NAME} install   (set up launchd service)`);
  console.log(`    ${BINARY_NAME} start     (run the bot)`);
  console.log();
}
