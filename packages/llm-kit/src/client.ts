/**
 * Create an LLM client for any supported provider.
 *
 * Usage:
 *   const llm = createLLMClient({ provider: "openai", apiKey: "sk-..." });
 *   const result = await llm.chat(messages, { model: "gpt-4o", system: "You are helpful." });
 */

import type { LLMClient, LLMClientConfig } from "./types.js";
import { createOpenAIClient } from "./providers/openai.js";
import { createAnthropicClient } from "./providers/anthropic.js";
import { createGeminiClient } from "./providers/gemini.js";

export function createLLMClient(config: LLMClientConfig): LLMClient {
  switch (config.provider) {
    case "openai":
      return createOpenAIClient(config.apiKey, config.defaultModel);
    case "anthropic":
      return createAnthropicClient(config.apiKey, config.defaultModel);
    case "gemini":
      return createGeminiClient(config.apiKey, config.defaultModel);
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}
