import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";

import {
  AGENT_MODEL_POLICY,
  claudeEffortFor,
  defaultClaudeModelId,
  plannerAgentDefaultModelId,
} from "@/lib/ai/model-policy";
import { CLAUDE_THINKING_ALLOWANCE_TOKENS, withAgentModelPolicy } from "@/lib/integrations/anthropic-access";

/** Send one call through the real Anthropic provider and return the request body it built. */
async function requestBodyFor(modelId: string, maxOutputTokens: number) {
  const bodies: Record<string, unknown>[] = [];
  const provider = createAnthropic({
    apiKey: "SYNTHETIC-KEY",
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: "msg_synthetic", type: "message", role: "assistant", model: modelId,
        content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await generateText({ model: withAgentModelPolicy(provider(modelId), modelId), prompt: "Say ok.", maxOutputTokens, temperature: 0.2 });
  expect(bodies).toHaveLength(1);
  return bodies[0];
}

describe("agent model policy (Nathaniel, 2026-10-10)", () => {
  it("names the directed models, all at high effort", () => {
    expect(AGENT_MODEL_POLICY).toEqual({
      orchestrator: { anthropic: { modelId: "claude-opus-5-5", effort: "high" }, openai: { modelId: "gpt-6.1-sol", effort: "high" } },
      quick: { anthropic: { modelId: "claude-haiku-5-5", effort: "high" }, openai: { modelId: "gpt-6-luna", effort: "high" } },
      mapping: { anthropic: { modelId: "claude-fable-5-1", effort: "high" }, openai: { modelId: "gpt-6-astra", effort: "high" } },
    });
    expect(defaultClaudeModelId("orchestrator")).toBe("claude-opus-5-5");
    expect(defaultClaudeModelId("quick")).toBe("claude-haiku-5-5");
  });

  it("sends effort only for a model the policy names", () => {
    expect(claudeEffortFor("claude-opus-5-5")).toBe("high");
    expect(claudeEffortFor("claude-haiku-5-5")).toBe("high");
    expect(claudeEffortFor("claude-fable-5-1")).toBe("high");
    // Haiku 4.5 rejects the effort parameter; an env override to it must not carry one.
    expect(claudeEffortFor("claude-haiku-4-5")).toBeNull();
    expect(claudeEffortFor("claude-opus-4-8")).toBeNull();
  });

  it("puts high effort and the thinking allowance into the real request body for a policy model", async () => {
    const body = await requestBodyFor("claude-opus-5-5", 600);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body.max_tokens).toBe(600 + CLAUDE_THINKING_ALLOWANCE_TOKENS);
    // Opus 5.5 rejects sampling parameters; the provider strips them.
    expect(body).not.toHaveProperty("temperature");
  });

  it("leaves an overridden model outside the policy exactly as the caller asked", async () => {
    const body = await requestBodyFor("claude-haiku-4-5", 600);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body).not.toHaveProperty("output_config");
    expect(body.max_tokens).toBe(600);
  });

  it("starts a Planner Agent task on the orchestrator model of the provider's family", () => {
    expect(plannerAgentDefaultModelId("codex")).toBe("gpt-6.1-sol");
    expect(plannerAgentDefaultModelId("opencode")).toBe("gpt-6.1-sol");
    expect(plannerAgentDefaultModelId("claude")).toBe("claude-opus-5-5");
    expect(plannerAgentDefaultModelId("anthropic")).toBe("claude-opus-5-5");
    expect(plannerAgentDefaultModelId("api_connection")).toBe("");
  });
});
