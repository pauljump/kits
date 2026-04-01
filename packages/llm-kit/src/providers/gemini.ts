/**
 * Google Gemini provider adapter.
 * Maps our generic types to/from Google's Generative AI SDK.
 */

import {
  GoogleGenerativeAI,
  type Content,
  type GenerateContentRequest,
  type Part,
} from "@google/generative-ai";
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  LLMClient,
  ToolCall,
} from "../types.js";

export function createGeminiClient(
  apiKey: string,
  defaultModel?: string
): LLMClient {
  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    provider: "gemini",

    async chat(
      messages: ChatMessage[],
      options?: ChatOptions
    ): Promise<ChatResult> {
      const modelName = options?.model ?? defaultModel ?? "gemini-2.0-flash";

      const model = genAI.getGenerativeModel({
        model: modelName,
        ...(options?.system
          ? { systemInstruction: options.system }
          : {}),
      });

      // Build Gemini contents from our generic messages
      const contents: Content[] = [];

      for (const msg of messages) {
        if (msg.role === "system") continue; // handled via systemInstruction

        if (msg.role === "tool") {
          // Gemini expects functionResponse in a user turn
          let parsed: object;
          try {
            parsed = JSON.parse(msg.content) as object;
          } catch {
            parsed = { result: msg.content };
          }
          const part: Part = {
            functionResponse: {
              name: msg.toolName,
              response: parsed,
            },
          };
          contents.push({ role: "user", parts: [part] });
          continue;
        }

        const role = msg.role === "assistant" ? "model" : "user";
        const part: Part = { text: msg.content };
        contents.push({ role, parts: [part] });
      }

      // Build tools if provided
      const tools = options?.tools?.length
        ? [
            {
              functionDeclarations: options.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            },
          ]
        : undefined;

      const request: GenerateContentRequest = {
        contents,
        generationConfig: {
          maxOutputTokens: options?.maxTokens ?? 1024,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(tools ? { tools: tools as any } : {}),
      };

      const result = await model.generateContent(request);

      const response = result.response;
      const candidate = response.candidates?.[0];
      if (!candidate) {
        return { text: "", toolCalls: [], stopReason: "error" };
      }

      // Extract text and tool calls from parts
      let text = "";
      const toolCalls: ToolCall[] = [];

      for (const part of candidate.content?.parts ?? []) {
        if ("text" in part && part.text) {
          text += part.text;
        }
        if ("functionCall" in part && part.functionCall) {
          toolCalls.push({
            id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: part.functionCall.name,
            input: (part.functionCall.args ?? {}) as Record<string, unknown>,
          });
        }
      }

      return {
        text,
        toolCalls,
        stopReason: candidate.finishReason ?? "unknown",
      };
    },
  };
}
