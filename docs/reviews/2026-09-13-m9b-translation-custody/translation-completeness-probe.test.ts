import { it, expect, vi } from "vitest";
const generate = vi.hoisted(() => vi.fn());
vi.mock("ai", () => ({ generateText: generate }));
vi.mock("@/lib/integrations/anthropic-access", () => ({ hasAnthropicAccess: () => true, anthropicModel: () => "synthetic-model" }));
import { translateEngagementText } from "@/lib/engagement/translation";
it("control: complete short model output remains available", async () => {
 generate.mockResolvedValueOnce({text:"Hola",finishReason:"stop"});
 const result=await translateEngagementText({text:"Hello",targetLanguage:"es"});
 expect(result.source).toBe("ai"); expect(result.translated).toBe("Hola");
});
it("valid long source reaches the model intact", async () => {
 const text="a".repeat(4990)+" ENDMARKER";
 generate.mockResolvedValueOnce({text:"SYNTHETIC output",finishReason:"stop"});
 await translateEngagementText({text,targetLanguage:"es"});
 expect(generate.mock.lastCall?.[0].prompt).toContain("ENDMARKER");
});
it("token-limited model output is refused as incomplete", async () => {
 generate.mockResolvedValueOnce({text:"SYNTHETIC unfinished output",finishReason:"length"});
 const result=await translateEngagementText({text:"Hello",targetLanguage:"es"});
 expect(result.source).toBe("unavailable"); expect(result.translated).toBeNull();
});
