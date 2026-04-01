/**
 * OpenAI provider adapter.
 * Maps our generic types to/from OpenAI's SDK.
 */

import OpenAI from "openai";
import type { ChatMessage, ChatOptions, ChatResult, LLMClient, ToolCall } from "../types.js";

export function createOpenAIClient(apiKey: string, defaultModel?: string): LLMClient {
  const client = new OpenAI({ apiKey });

  return {
    provider: "openai",

    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
      const model = options?.model ?? defaultModel ?? "gpt-4o";

      // Build OpenAI messages — system goes as a system message
      const oaiMessages: OpenAI.ChatCompletionMessageParam[] = [];
      if (options?.system) {
        oaiMessages.push({ role: "system", content: options.system });
      }
      for (const msg of messages) {
        if (msg.role === "tool") {
          // Tool result — references a previous assistant tool_call by ID
          oaiMessages.push({
            role: "tool",
            tool_call_id: msg.toolCallId,
            content: msg.content,
          });
        } else {
          oaiMessages.push({ role: msg.role, content: msg.content });
        }
      }

      // Build tools if provided
      const oaiTools: OpenAI.ChatCompletionTool[] | undefined = options?.tools?.map(t => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));

      const response = await client.chat.completions.create({
        model,
        messages: oaiMessages,
        max_tokens: options?.maxTokens ?? 1024,
        ...(oaiTools && oaiTools.length > 0 ? { tools: oaiTools } : {}),
      });

      const choice = response.choices[0];
      if (!choice) {
        return { text: "", toolCalls: [], stopReason: "error" };
      }

      // Extract text
      const text = choice.message?.content ?? "";

      // Extract tool calls (with IDs for tool-result round-trips)
      const toolCalls: ToolCall[] = [];
      if (choice.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          if (tc.type === "function") {
            try {
              toolCalls.push({
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments),
              });
            } catch {
              console.warn(`[llm-kit] Failed to parse tool args for ${tc.function.name}`);
            }
          }
        }
      }

      return {
        text,
        toolCalls,
        stopReason: choice.finish_reason ?? "unknown",
      };
    },
  };
}
