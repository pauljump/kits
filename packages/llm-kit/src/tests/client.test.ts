import { describe, it, expect } from "vitest";
import { createLLMClient } from "../client.js";
import type { LLMClient, Provider } from "../types.js";

/**
 * Structural tests for llm-kit's factory function.
 * These verify the wiring — provider dispatch, returned shape,
 * and error handling — without hitting any real APIs.
 */

const FAKE_KEY = "fake-api-key-for-structural-tests";

describe("createLLMClient", () => {
  // --- Provider dispatch ---

  it("creates an openai client with correct provider property", () => {
    const client = createLLMClient({ provider: "openai", apiKey: FAKE_KEY });
    expect(client.provider).toBe("openai");
  });

  it("creates an anthropic client with correct provider property", () => {
    const client = createLLMClient({ provider: "anthropic", apiKey: FAKE_KEY });
    expect(client.provider).toBe("anthropic");
  });

  it("creates a gemini client with correct provider property", () => {
    const client = createLLMClient({ provider: "gemini", apiKey: FAKE_KEY });
    expect(client.provider).toBe("gemini");
  });

  it("throws on unknown provider", () => {
    expect(() =>
      // @ts-expect-error — intentionally passing invalid provider
      createLLMClient({ provider: "llama", apiKey: FAKE_KEY })
    ).toThrow("Unsupported LLM provider: llama");
  });

  // --- Returned shape (LLMClient interface) ---

  describe.each<Provider>(["openai", "anthropic", "gemini"])(
    "%s client shape",
    (provider) => {
      let client: LLMClient;

      // Create once per provider — no API calls, just object construction
      client = createLLMClient({ provider, apiKey: FAKE_KEY });

      it("has a provider property that is a string", () => {
        expect(typeof client.provider).toBe("string");
        expect(client.provider).toBe(provider);
      });

      it("has a chat method", () => {
        expect(typeof client.chat).toBe("function");
      });

      it("chat method accepts messages array (arity check)", () => {
        // chat(messages, options?) — should accept at least 1 argument
        expect(client.chat.length).toBeGreaterThanOrEqual(1);
      });
    }
  );

  // --- Config forwarding ---

  it("accepts defaultModel without throwing for openai", () => {
    const client = createLLMClient({
      provider: "openai",
      apiKey: FAKE_KEY,
      defaultModel: "gpt-4o-mini",
    });
    expect(client.provider).toBe("openai");
  });

  it("accepts defaultModel without throwing for anthropic", () => {
    const client = createLLMClient({
      provider: "anthropic",
      apiKey: FAKE_KEY,
      defaultModel: "claude-sonnet-4-6",
    });
    expect(client.provider).toBe("anthropic");
  });

  it("accepts defaultModel without throwing for gemini", () => {
    const client = createLLMClient({
      provider: "gemini",
      apiKey: FAKE_KEY,
      defaultModel: "gemini-2.0-flash",
    });
    expect(client.provider).toBe("gemini");
  });

  // --- Edge cases ---

  it("throws a descriptive error message that includes the bad provider name", () => {
    try {
      // @ts-expect-error — intentionally invalid
      createLLMClient({ provider: "mistral", apiKey: FAKE_KEY });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("mistral");
    }
  });

  it("each provider returns a distinct object", () => {
    const openai = createLLMClient({ provider: "openai", apiKey: FAKE_KEY });
    const anthropic = createLLMClient({ provider: "anthropic", apiKey: FAKE_KEY });
    const gemini = createLLMClient({ provider: "gemini", apiKey: FAKE_KEY });

    expect(openai).not.toBe(anthropic);
    expect(anthropic).not.toBe(gemini);
    expect(openai).not.toBe(gemini);
  });

  it("two calls with same config return separate instances", () => {
    const a = createLLMClient({ provider: "openai", apiKey: FAKE_KEY });
    const b = createLLMClient({ provider: "openai", apiKey: FAKE_KEY });
    expect(a).not.toBe(b);
  });
});
