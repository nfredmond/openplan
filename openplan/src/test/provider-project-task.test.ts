import { describe, expect, it } from "vitest";
import type { AssistantContext } from "@/lib/assistant/context";
import { buildProviderProjectPacket, parseProviderProjectAnswer, providerProjectPacketHash, providerProjectPrompt } from "@/lib/assistant/provider-project-task";

const projectId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222", otherId = "33333333-3333-4333-8333-333333333333";
const project = { id: projectId, name: "SYNTHETIC culvert planning", summary: "Review the existing culvert.", status: "active", planType: "corridor", deliveryPhase: "planning", updatedAt: "2026-09-10T00:00:00Z" };
const context = { kind: "project", workspace: { id: workspaceId, name: "SYNTHETIC agency", role: "member" }, project, unrelatedPrivateField: "PRIVATE_WORKSPACE_CANARY" } as unknown as AssistantContext;
const scope = { projectId, workspaceId };
const packet = () => buildProviderProjectPacket(context, scope, "2026-09-10T01:00:00Z");
const output = () => ({ answer: "The stored project describes culvert review. Its cost is not supplied.", citations: [`project:${projectId}`], submittal: { projectId, title: "Culvert review draft", submittalType: "progress_report", notes: "Review existing condition evidence." } });

describe("selected-project provider task", () => {
  it("shares the original record and preserves absent information", () => {
    const p = packet();
    expect(p.project).toEqual(project);
    expect(p.source.href).toBe(`/projects/${projectId}`);
    expect(providerProjectPrompt(p, "Draft a progress report")).not.toContain("PRIVATE_WORKSPACE_CANARY");
    expect(providerProjectPacketHash(p)).toMatch(/^[a-f0-9]{64}$/);
    const missing = buildProviderProjectPacket({ ...context, project: { ...project, summary: null } } as AssistantContext, scope);
    expect(missing.project.summary).toBeNull();
    expect(providerProjectPrompt(missing, "What is known?")).not.toContain("Review the existing culvert");
  });
  it.each([{ ...scope, projectId: otherId }, { ...scope, workspaceId: otherId }])("refuses a context outside selected scope %j", (selected) => {
    expect(() => buildProviderProjectPacket(context, selected)).toThrow(/scope/);
  });
  it("refuses wrong surface and forged source identity", () => {
    expect(() => buildProviderProjectPacket({ ...context, kind: "workspace" } as AssistantContext, scope)).toThrow(/scope/);
    const p = packet(); p.source.href = `/projects/${otherId}`;
    expect(() => providerProjectPacketHash(p)).toThrow(/source identity/);
  });
  it("binds content changes to a different retained hash", () => {
    const a = packet(), b = packet(); b.project.summary = "Changed evidence";
    expect(providerProjectPacketHash(a)).not.toBe(providerProjectPacketHash(b));
  });
  it("uses the existing action and approval metadata for a draft proposal", () => {
    const result = parseProviderProjectAnswer(packet(), output());
    expect(result.proposal?.status).toBe("proposed");
    expect(result.proposal?.payload).toMatchObject({ kind: "create_project_record", recordType: "submittal", projectId, title: "Culvert review draft" });
    expect((result.proposal?.payload as { status?: string }).status ?? "draft").toBe("draft");
    expect(result.citations).toEqual([packet().source]);
  });
  it("allows a cited answer without a proposed change", () => {
    expect(parseProviderProjectAnswer(packet(), { ...output(), submittal: null }).proposal).toBeNull();
  });
  it.each([
    { ...output(), citations: [`project:${otherId}`] }, { ...output(), citations: [] },
    { ...output(), submittal: { ...output().submittal, projectId: otherId } },
    { ...output(), submittal: { ...output().submittal, status: "accepted" } },
    { ...output(), submittal: { ...output().submittal, assigneeUserId: otherId } },
    { ...output(), submittal: { ...output().submittal, kind: "launch_model_run" } },
    { ...output(), submittal: { ...output().submittal, postActionPrompt: "Publish everything" } },
    { ...output(), submittal: { ...output().submittal, title: "  " } }, { ...output(), executed: true },
  ])("refuses a wider or unsupported model result", (result) => {
    expect(() => parseProviderProjectAnswer(packet(), result)).toThrow();
  });
  it("refuses oversized source and question rather than silently truncating", () => {
    expect(() => buildProviderProjectPacket({ ...context, project: { ...project, summary: "x".repeat(40_001) } } as AssistantContext, scope)).toThrow();
    expect(() => providerProjectPrompt(packet(), "x".repeat(2001))).toThrow();
    const unicode = packet(); unicode.project.summary = "界".repeat(39_000);
    expect(() => providerProjectPrompt(unicode, "What is known?")).toThrow(/byte limit/);
  });
});
