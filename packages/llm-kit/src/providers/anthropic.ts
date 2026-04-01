/**
 * Anthropic provider adapter.
 * Maps our generic types to/from Anthropic's SDK.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatOptions, ChatResult, LLMClient, ToolCall } from "../types.js";

export function createAnthropicClient(apiKey: string, defaultModel?: string): LLMClient {
  const client = new Anthropic({ apiKey });

  return {
    provider: "anthropic",

    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
      const model = options?.model ?? defaultModel ?? "claude-sonnet-4-6";

      // Anthropic: system is a top-level param, not a message.
      // Build message array, handling tool results specially.
      const apiMessages: Anthropic.MessageParam[] = [];

      // Batch consecutive tool-result messages into a single user message
      // (Anthropic requires tool_result blocks inside a user turn)
      let pendingToolResults: Array<{ toolCallId: string; content: string }> = [];

      const flushToolResults = () => {
        if (pendingToolResults.length === 0) return;
        apiMessages.push({
          role: "user",
          content: pendingToolResults.map(tr => ({
            type: "tool_result" as const,
            tool_use_id: tr.toolCallId,
            content: tr.content,
          })),
        });
        pendingToolResults = [];
      };

      for (const msg of messages) {
        if (msg.role === "system") continue;

        if (msg.role === "tool") {
          pendingToolResults.push({ toolCallId: msg.toolCallId, content: msg.content });
          continue;
        }

        // Flush any pending tool results before a non-tool message
        flushToolResults();
        apiMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
      }

      // Flush any trailing tool results
      flushToolResults();

      // Build tools if provided
      const tools: Anthropic.Tool[] | undefined = options?.tools?.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool.InputSchema,
      }));

      const response = await client.messages.create({
        model,
        max_tokens: options?.maxTokens ?? 1024,
        ...(options?.system ? { system: options.system } : {}),
        messages: apiMessages,
        ...(tools && tools.length > 0 ? { tools } : {}),
      });

      // Extract text and tool calls
      let text = "";
      const toolCalls: ToolCall[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          text += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      return {
        text,
        toolCalls,
        stopReason: response.stop_reason ?? "unknown",
      };
    },
  };
}
