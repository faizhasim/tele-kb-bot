/**
 * Opencode Go provider registration for the pi SDK ModelRegistry.
 *
 * Registers the Opencode Go LLM provider as an OpenAI-compatible API
 * with the deepseek-v4-flash model.
 *
 * @module
 */

import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

/**
 * Register the Opencode Go provider with the given ModelRegistry.
 *
 * This configures:
 * - Provider name: "opencode-go"
 * - Base URL: OpenAI-compatible API endpoint
 * - Model: "deepseek-v4-flash" with High reasoning
 * - Zero cost (local/open provider)
 * - 128K context window
 *
 * @param modelRegistry - The ModelRegistry to register with
 */
export function registerProvider(modelRegistry: ModelRegistry): void {
  modelRegistry.registerProvider("opencode-go", {
    baseUrl: "https://api.opencode.go/v1",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        reasoning: true,
        input: ["text"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
  });
}
