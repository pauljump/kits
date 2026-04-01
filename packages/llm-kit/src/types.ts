/**
 * Provider-agnostic types for LLM interactions.
 * Every provider adapter maps to/from these types.
 */

export type Provider = "openai" | "anthropic" | "gemini";

export interface LLMClientConfig {
  provider: Provider;
  apiKey: string;
  /** Default model for chat calls. Can be overridden per-call. */
  defaultModel?: string;
}

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "tool"; toolCallId: string; toolName: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  /** Raw stop reason from the provider */
  stopReason: string;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  tools?: ToolDefinition[];
}

export interface LLMClient {
  provider: Provider;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}
