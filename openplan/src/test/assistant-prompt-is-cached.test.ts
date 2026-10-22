import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";

import { withAgentModelPolicy } from "@/lib/integrations/anthropic-access";

/**
 * The Planner Agent chat route passes its system prompt as a system message
 * with Anthropic cache control. The route test checks the option is set;
 * this checks the real provider, through the app's policy wrapper, turns it
 * into `cache_control` on the system block of the request body. A live test
 * on 2026-10-11 found every step of a question paying full input price for
 * about 9,000 tokens of tools and prompt.
 */
describe("the Planner Agent's system prompt is cached", () => {
  it("puts cache_control on the system block the provider sends", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const provider = createAnthropic({
      apiKey: "SYNTHETIC-KEY",
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            id: "msg_synthetic", type: "message", role: "assistant", model: "claude-opus-5-5",
            content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
    });

    await generateText({
      model: withAgentModelPolicy(provider("claude-opus-5-5"), "claude-opus-5-5"),
      system: {
        role: "system",
        content: "You are the OpenPlan Planner Agent.",
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      prompt: "Which project is due next?",
      maxOutputTokens: 600,
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0].system).toEqual([
      { type: "text", text: "You are the OpenPlan Planner Agent.", cache_control: { type: "ephemeral" } },
    ]);
  });
});
