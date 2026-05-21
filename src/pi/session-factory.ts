/**
 * pi SDK session factory for tele-kb-bot.
 *
 * Creates isolated AgentSession instances per Telegram chat, with
 * all paths explicitly pointed at <config_dir>/agents/.
 *
 * @module
 */

import { join } from "node:path";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import {
  AuthStorage,
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "../config/schema";
import { getLogger } from "../logger";
import { createExtensionFactories } from "./extensions";
import { registerProvider } from "./provider";

/**
 * Create an AgentSession for a specific Telegram chat.
 *
 * Each call creates a fresh, independent session. All paths are explicitly
 * set to use <config_dir>/agents/ — nothing touches ~/.pi/.
 *
 * @param config - Loaded bot config
 * @param configDir - Resolved config directory path
 * @param cwd - Working directory for tool scoping (defaults to configDir)
 * @returns A configured AgentSession
 */
export async function createPiSession(
  config: Config,
  configDir: string,
  cwd: string = configDir,
): Promise<AgentSession> {
  const log = getLogger();
  const agentDir = join(configDir, "agents");

  // 1. Auth storage — API keys from <config_dir>/agents/auth.json
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  authStorage.reload();

  // 2. Model registry — custom models from <config_dir>/agents/models.json
  const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  modelRegistry.refresh();

  // 3. Register Opencode Go provider
  registerProvider(modelRegistry);

  // 4. Settings manager
  const settingsManager = SettingsManager.create(cwd, agentDir);

  // 5. Create runtime services with compiled-in extensions
  log.debug({ agentDir }, "Creating pi SDK services");
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoaderOptions: {
      extensionFactories: createExtensionFactories(),
      noExtensions: true, // Don't auto-discover extensions from filesystem
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    },
  });

  // 6. Resolve the model
  const modelId = config.llm.model;
  const model = modelRegistry.find("opencode-go", modelId);

  if (!model) {
    throw new Error(
      `Model "${modelId}" not found for provider "opencode-go". ` +
        "Make sure the provider is registered and models.json is correct. " +
        "Run 'tele-kb-bot setup' to configure.",
    );
  }

  log.info({ model: `${modelId}`, thinking: config.llm.reasoning }, "Creating pi session");

  // 7. Session manager for persistence
  const sessionManager = SessionManager.create(join(agentDir, "sessions/"));

  // 8. Create the AgentSession
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    model,
    thinkingLevel: (config.llm.reasoning as never) ?? "high",
  });

  return session;
}
