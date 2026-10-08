import { describe, expect, it } from "vitest";
import { SynthesisTaskResourceError } from "../lib/engagement/synthesis-task-resource-error";
describe("safe task byte diagnostic", () => {
  it("retains measured whole bytes without source material", () => {
    expect(new SynthesisTaskResourceError(0, 68699, 65536)).toMatchObject({ taskIndex: 0, requiredTaskBytes: 68699, taskByteLimit: 65536 });
  });
  it.each([[-1, 68699, 65536], [0, 65536, 65536], [0, 4096, 4095], [0, 1048578, 1048577], [0.5, 68699, 65536], [0, Infinity, 65536], [0, 68699, NaN]])(
    "rejects invalid numeric diagnosis %s %s %s", (index, required, limit) => {
      expect(() => new SynthesisTaskResourceError(index, required, limit)).toThrow("Invalid synthesis resource diagnostic");
    });
});
