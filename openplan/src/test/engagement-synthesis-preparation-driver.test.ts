import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/engagement/synthesis-generation-plan-server", () => ({ retainSynthesisGenerationPlan: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-context-plan-server", () => ({ retainSynthesisContextPlan: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-generation-selected-results-server", () => ({ readSynthesisContextParentResults: vi.fn(), loadSynthesisGenerationHistory: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-thematic-inputs-server", () => ({ createSynthesisThematicInputPreparer: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-thematic-input-seal-server", () => ({ retainSynthesisThematicInputSeal: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-thematic-plan-server", () => ({ retainSynthesisThematicPlan: vi.fn() }));
import { retainSynthesisGenerationPlan } from "@/lib/engagement/synthesis-generation-plan-server";
import { retainSynthesisContextPlan } from "@/lib/engagement/synthesis-context-plan-server";
import { readSynthesisContextParentResults } from "@/lib/engagement/synthesis-generation-selected-results-server";
import { createSynthesisThematicInputPreparer } from "@/lib/engagement/synthesis-thematic-inputs-server";
import { retainSynthesisThematicInputSeal } from "@/lib/engagement/synthesis-thematic-input-seal-server";
import { retainSynthesisThematicPlan } from "@/lib/engagement/synthesis-thematic-plan-server";
import { createSynthesisContextStagingPlan } from "@/lib/engagement/synthesis-context-plan";
import { prepareSynthesisStage } from "@/lib/engagement/synthesis-preparation-driver";
import { preparationInputsFixture } from "./fixtures/engagement/synthesis-preparation-inputs";
const sealed = { state: { cancelled: false, seal: { receiptSha256: "b".repeat(64) } } };
const segment = vi.mocked(retainSynthesisGenerationPlan), context = vi.mocked(retainSynthesisContextPlan), parent = vi.mocked(readSynthesisContextParentResults);
const thematic = vi.mocked(retainSynthesisThematicPlan), inputSeal = vi.mocked(retainSynthesisThematicInputSeal), inputFactory = vi.mocked(createSynthesisThematicInputPreparer);
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  segment.mockResolvedValue(sealed as Awaited<ReturnType<typeof retainSynthesisGenerationPlan>>);
  context.mockResolvedValue(sealed as Awaited<ReturnType<typeof retainSynthesisContextPlan>>);
  thematic.mockResolvedValue(sealed as Awaited<ReturnType<typeof retainSynthesisThematicPlan>>);
});

describe("original stage preparation driver", () => {
  it("sends the original segment request and source through its native staging driver", async () => {
    const f = preparationInputsFixture(), s = signal();
    expect(await prepareSynthesisStage(f.service, f.lease, s)).toEqual({ sealSha256: "b".repeat(64) });
    expect(segment).toHaveBeenCalledExactlyOnceWith(f.service, { id: f.request.id, intentText: f.request.intent_text, intentSha256: f.request.intent_sha256 },
      f.f.f.args.saved, f.f.f.args.scope, s);
    expect(f.rpc).toHaveBeenCalledTimes(3); expect(context).not.toHaveBeenCalled(); expect(thematic).not.toHaveBeenCalled();
  });
  it("reconstructs context from the child's exact parent selection and original requester", async () => {
    const f = preparationInputsFixture("context"), s = signal();
    parent.mockResolvedValue({ selections: { plan: { taskPlan: f.f.f.args.plan }, selections: f.f.f.args.selections }, inventory: f.f.f.inventory } as Awaited<ReturnType<typeof readSynthesisContextParentResults>>);
    context.mockImplementation(async (_service, args) => {
      const plan = createSynthesisContextStagingPlan(...args);
      expect(plan.continuation.content).toEqual(f.f.content);
      expect(plan.header.requestId).toBe(f.scope.requestId);
      return { ...sealed, plan } as Awaited<ReturnType<typeof retainSynthesisContextPlan>>;
    });
    await expect(prepareSynthesisStage(f.service, f.lease, s)).resolves.toEqual({ sealSha256: "b".repeat(64) });
    expect(parent).toHaveBeenCalledExactlyOnceWith(f.service, f.scope.requestId, { request: { id: f.parent.id, intentText: f.parent.intent_text, intentSha256: f.parent.intent_sha256 },
      actorId: f.parent.actor_id, saved: f.f.f.args.saved, scope: f.f.f.args.scope, throughSequence: f.f.f.sequence }, s);
    expect(context).toHaveBeenCalledTimes(1); expect(segment).not.toHaveBeenCalled(); expect(thematic).not.toHaveBeenCalled(); expect(f.rpc).toHaveBeenCalledTimes(3);
  });
  it("retains every thematic contribution including the tail beyond300 before sealing and planning", async () => {
    const f = preparationInputsFixture("thematic", 301), s = signal(), calls: string[] = [];
    const prepare = vi.fn(async (target: string, inputSignal: AbortSignal) => { expect(inputSignal).toBe(s); calls.push(target); return {} as Awaited<ReturnType<ReturnType<typeof createSynthesisThematicInputPreparer>>>; });
    inputFactory.mockReturnValue(prepare); inputSeal.mockImplementation(async () => { calls.push("seal"); return {} as Awaited<ReturnType<typeof retainSynthesisThematicInputSeal>>; });
    thematic.mockImplementation(async () => { calls.push("plan"); return sealed as Awaited<ReturnType<typeof retainSynthesisThematicPlan>>; });
    expect(await prepareSynthesisStage(f.service, f.lease, s)).toEqual({ sealSha256: "b".repeat(64) });
    const snapshot = JSON.parse(f.source.snapshot_text);
    const targets = [...snapshot.items.map((item: { id: string }) => `item:${item.id}`), ...snapshot.answers.map((answer: { id: string }) => `answer:${answer.id}`)].sort();
    expect(targets).toHaveLength(302); expect(calls).toEqual([...targets, "seal", "plan"]);
    expect(inputFactory).toHaveBeenCalledExactlyOnceWith(f.service, f.scope);
    expect(prepare.mock.calls.every(call => call[0].startsWith("item:") || call[0].startsWith("answer:"))).toBe(true);
    expect(inputSeal).toHaveBeenCalledExactlyOnceWith(f.service, f.scope, s); expect(thematic).toHaveBeenCalledExactlyOnceWith(f.service, f.scope, s);
  });
  it("preserves unconfirmed thematic input failures without sealing a partial inventory", async () => {
    const f = preparationInputsFixture("thematic"); inputFactory.mockReturnValue(vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("input unconfirmed")));
    await expect(prepareSynthesisStage(f.service, f.lease, signal())).rejects.toThrow("input unconfirmed"); expect(inputSeal).not.toHaveBeenCalled(); expect(thematic).not.toHaveBeenCalled();
  });
  it("stops between thematic inputs when interrupted", async () => {
    const f = preparationInputsFixture("thematic"), c = new AbortController(), prepare = vi.fn(async () => { c.abort(); return {} as Awaited<ReturnType<ReturnType<typeof createSynthesisThematicInputPreparer>>>; });
    inputFactory.mockReturnValue(prepare); await expect(prepareSynthesisStage(f.service, f.lease, c.signal)).rejects.toThrow(); expect(prepare).toHaveBeenCalledTimes(1); expect(inputSeal).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "unsealed"])("refuses %s preparation instead of declaring success", async kind => {
    const f = preparationInputsFixture(); segment.mockResolvedValue({ state: { cancelled: kind === "cancelled", seal: kind === "unsealed" ? null : sealed.state.seal } } as Awaited<ReturnType<typeof retainSynthesisGenerationPlan>>);
    await expect(prepareSynthesisStage(f.service, f.lease, signal())).rejects.toThrow("no current completion seal"); expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it("rechecks lease after staging before returning an outcome", async () => {
    const f = preparationInputsFixture(); f.renewal.mockResolvedValueOnce({ data: f.lease, error: null }).mockResolvedValueOnce({ data: f.lease, error: null }).mockResolvedValueOnce({ data: null, error: { message: "cancelled" } });
    await expect(prepareSynthesisStage(f.service, f.lease, signal())).rejects.toThrow("acknowledgement unavailable"); expect(segment).toHaveBeenCalledTimes(1);
  });
  it("leaves a thrown staging result unconfirmed", async () => {
    const f = preparationInputsFixture(); segment.mockRejectedValueOnce(new Error("unknown write")); await expect(prepareSynthesisStage(f.service, f.lease, signal())).rejects.toThrow("unknown write");
  });
});
