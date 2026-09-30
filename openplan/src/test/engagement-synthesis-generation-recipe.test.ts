import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// A future schema converter must not rewrite the wire format of retained work.
vi.mock("zod", async importOriginal => {
  const actual = await importOriginal<typeof import("zod")>();
  return { ...actual, z: { ...actual.z, toJSONSchema: () => ({ futureRuntimeShape: true }) } };
});
import { synthesisGenerationSegmentRecipe } from "@/lib/engagement/synthesis-generation-recipe";
import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationRecords } from "@/lib/engagement/synthesis-generation-records";
import { createSynthesisGenerationTasks } from "@/lib/engagement/synthesis-generation-tasks";
import { makeSourceSnapshot, savedSource, sourceScope } from "./fixtures/engagement/synthesis-source";

const retainedHash = "bc91bcf4ca0a31468a8a9c7aa4b383855382f7888eeb70ed7bb143ff2f8a473b";
describe("retained synthesis segment recipe", () => {
  it("pins the version1 instructions and output schema independently of the current converter", () => {
    const { sha256, ...recipe } = synthesisGenerationSegmentRecipe();
    expect(recipe.id).toBe("openplan.engagement.synthesis.segment.v1");
    expect(recipe.schemaVersion).toBe(1);
    expect(recipe.taskSchemaVersion).toBe(1);
    expect(sha256).toBe(retainedHash);
    expect(createHash("sha256").update(JSON.stringify(recipe)).digest("hex")).toBe(retainedHash);
    const saved = savedSource(makeSourceSnapshot(1));
    const input = createSynthesisGenerationInput(saved, sourceScope);
    const records = createSynthesisGenerationRecords(input, saved, sourceScope);
    const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
    for (const task of plan.tasks) {
      const packet = JSON.parse(task.canonical);
      expect(packet.schemaVersion).toBe(recipe.taskSchemaVersion);
      expect(packet.instructions).toBe(recipe.instructions);
      expect(packet.outputSchema).toEqual(recipe.outputSchema);
      expect(packet.outputSchema).not.toHaveProperty("futureRuntimeShape");
    }
  });
  it("does not let a consumer mutate a later recipe or its claimed checksum", () => {
    const first = synthesisGenerationSegmentRecipe();
    first.instructions = "SYNTHETIC consumer change";
    first.outputSchema.properties.status.enum.push("SYNTHETIC different status");
    const { sha256, ...second } = synthesisGenerationSegmentRecipe();
    expect(sha256).toBe(retainedHash);
    expect(createHash("sha256").update(JSON.stringify(second)).digest("hex")).toBe(retainedHash);
    expect(second.outputSchema.properties.status.enum).toEqual(["complete", "incomplete"]);
  });
});
