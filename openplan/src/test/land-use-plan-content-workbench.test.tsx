import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readPlanContextRecovery } from "@/lib/land-use-plans/plan-context-recovery";
import { LandUsePlanWorkbench } from "@/components/land-use-plans/land-use-plan-workbench";
import { syntheticPlanContext } from "./fixtures/land-use-plans/plan-context";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: () => <div>Study area picker</div> }));

const WORKBENCH = {
  actorId: "55555555-5555-4555-8555-555555555555", descriptorHash: "a".repeat(64),
  plan: {
    descriptor_id: "local-unconfigured", workspace_id: "66666666-6666-4666-8666-666666666666", plan_kind_key: "general",
    id: "11111111-1111-4111-8111-111111111111",
    title: "County plan",
    authority_label: "County planning agency",
    geography_label: "Benton County, Oregon",
    geography_geojson: { type: "Polygon", coordinates: [] },
    current_working_version_id: "22222222-2222-4222-8222-222222222222",
    current_adopted_version_id: null,
  },
  descriptor: {
    id: "local-unconfigured",
    configured: false,
    disclosure: "Local legal requirements are not configured.",
    verifiedAt: "2026-08-23",
    reviewDueAt: "2027-01-15",
    terminology: { plan: "land use plan", section: "section", adoptionInstrument: "instrument", implementationReport: "report" },
    requirements: [{ key: "locally_defined", label: "Locally defined content", applicability: "locally_defined", sourceUrls: [] }],
    processSteps: [],
    sourceUrls: [],
  },
  canWrite: true,
  isHistoricalVersion: false,
  versions: [{ id: "22222222-2222-4222-8222-222222222222", version_number: 1, version_kind: "original", draft_revision: 7, state: "working", applicable_requirement_keys: [], content_hash: null, frozen_at: null, published_report_id: null }],
  activeVersion: { id: "22222222-2222-4222-8222-222222222222", version_number: 1, version_kind: "original", draft_revision: 7, state: "working", applicable_requirement_keys: [], content_hash: null, frozen_at: null, published_report_id: null },
  nodes: [
    { id: "33333333-3333-4333-8333-333333333333", parent_node_id: null, node_kind: "section", requirement_key: "locally_defined", title: "Locally defined content", body: null, sort_order: 0, evidence_document_id: null, evidence_url: null },
    { id: "44444444-4444-4444-8444-444444444444", parent_node_id: null, node_kind: "policy", requirement_key: null, title: "Maintain a clear record", body: "Original policy text", sort_order: 1, evidence_document_id: null, evidence_url: null },
  ],
  relationships: [], designations: [], actions: [], reviews: [], decisions: [], reports: [],
  consultations: [], processRecords: [], reviewReleases: [], layers: [], layerVersions: [],
  documents: [], campaigns: [], projects: [], programs: [],
};

describe("LandUsePlanWorkbench content editing", () => {
  const writes: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    writes.length = 0; localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify(WORKBENCH), { status: 200 });
      if (typeof init.body === "string") writes.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ updated: true }), { status: 200 });
    }));
  });

  it("keeps neutral sections editable and lets a planner read and revise saved policy text", async () => {
    render(<LandUsePlanWorkbench planId={WORKBENCH.plan.id} />);

    const section = await screen.findByPlaceholderText("Author the plan text, with evidence links and policy details.");
    expect(section).not.toBeDisabled();
    fireEvent.change(section, { target: { value: "Locally authored section" } });
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
    await waitFor(() => expect(writes).toContainEqual(expect.objectContaining({
      operation: "update",
      nodeId: "33333333-3333-4333-8333-333333333333",
      body: "Locally authored section",
    })));

    expect(screen.getByText(/Edit content node · policy/i)).toBeVisible();
    const policyBody = screen.getByLabelText("Draft text");
    expect(policyBody).toHaveValue("Original policy text");
    fireEvent.change(policyBody, { target: { value: "Revised policy text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save content node" }));
    await waitFor(() => expect(writes).toContainEqual({
      operation: "update",
      nodeId: "44444444-4444-4444-8444-444444444444",
      title: "Maintain a clear record",
      body: "Revised policy text",
    }));
  });

  it("joins context edits, pending recovery and refreshed revisions to the actual freeze control", async () => {
    const scope={actorId:WORKBENCH.actorId,workspaceId:WORKBENCH.plan.workspace_id,planId:WORKBENCH.plan.id};
    const context={schemaVersion:1,savedBy:scope.actorId,savedAt:"2026-10-07T00:00:00Z",place:{source:"drawn",kind:null,ref:null,label:"Synthetic area",countryCode:null,subdivisionCode:null,bbox:{minLon:0,minLat:0,maxLon:1,maxLat:1},geometry:{type:"Polygon",coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}},assessment:{authorities:[{id:WORKBENCH.nodes[0].id,label:"Synthetic body",role:"Study sponsor",kind:"unassessed",jurisdiction:null,sourceUrls:[]}],applicability:{status:"unresolved",explanation:"Unassessed scope"}}};
    let saved={...scope,contextState:{status:"retained",context},contextHash:"a".repeat(64),descriptorId:WORKBENCH.descriptor.id,planKindKey:WORKBENCH.plan.plan_kind_key,versionId:WORKBENCH.activeVersion.id,canWrite:true};
    let revision=7;
    const readyPlan={...WORKBENCH,nodes:WORKBENCH.nodes.map(node=>({...node,body:"Saved content"})),designations:[{id:"map",designation_set_label:"Synthetic map",public_field_keys:[]}],actions:[{id:"action",title:"Synthetic action",status:"not_started"}]};
    vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
      if(url.endsWith("/context")) {
        if(init?.method==="POST") {
          const command=JSON.parse(String(init.body));revision++;
          saved={...saved,contextHash:"b".repeat(64),contextState:{status:"retained",context:{...context,assessment:command.assessment}}};
          return Response.json({replayed:false,commandId:command.commandId,versionId:command.versionId,context:saved.contextState.context,contextHash:saved.contextHash},{status:201});
        }
        return Response.json(saved);
      }
      return Response.json({...readyPlan,activeVersion:{...readyPlan.activeVersion,draft_revision:revision}});
    }));
    render(<LandUsePlanWorkbench planId={scope.planId}/>);
    const freeze=await screen.findByRole("button",{name:"Freeze public draft"});await waitFor(()=>expect(freeze).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Body name"),{target:{value:"Revised synthetic body"}});expect(freeze).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Save plan context"}));await screen.findByText("Plan context saved and refreshed.");await waitFor(()=>expect(freeze).toBeEnabled());
    expect(readPlanContextRecovery(localStorage,scope)).toEqual([]);expect(revision).toBe(8);
    act(()=>{localStorage.setItem(`openplan:plan-context:${scope.actorId}:${scope.workspaceId}:${scope.planId}:pending:unreadable`,"{unknown");window.dispatchEvent(new StorageEvent("storage"));});
    expect(freeze).toBeDisabled();expect(screen.getByText("Unreadable copy")).toBeVisible();
  });

  it("does not turn an unsourced descriptor date into a legal-source review claim", async () => {
    render(<LandUsePlanWorkbench planId={WORKBENCH.plan.id} />);
    await screen.findByText("Local legal requirements are not configured.");
    expect(screen.queryByText(/Sources reviewed/)).not.toBeInTheDocument();
    expect(screen.getByText(/source review is not established/i)).toBeVisible();
  });

  it("shows required sections missing from older choices without forcing unselected local content", async () => {
    const ready = { ...WORKBENCH,
      descriptor: { ...WORKBENCH.descriptor, requirements: [
        ...WORKBENCH.descriptor.requirements,
        { key: "new_required", label: "New required part", applicability: "required", sourceUrls: [] },
      ] },
      activeVersion: { ...WORKBENCH.activeVersion, applicable_requirement_keys: ["prior_rule"] },
      nodes: [{ ...WORKBENCH.nodes[0], requirement_key: "prior_rule", body: "SYNTHETIC saved text" }],
      designations: [{ id: "map", designation_set_label: "SYNTHETIC map", public_field_keys: [] }],
      actions: [{ id: "action", title: "SYNTHETIC action", status: "not_started" }],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/context")
      ? Response.json({ actorId: ready.actorId, workspaceId: ready.plan.workspace_id, planId: ready.plan.id,
        contextState: { status: "legacy" }, contextHash: null, descriptorId: ready.descriptor.id,
        planKindKey: ready.plan.plan_kind_key, versionId: ready.activeVersion.id, canWrite: true })
      : Response.json(ready)));
    render(<LandUsePlanWorkbench planId={ready.plan.id} />);
    expect(await screen.findByText("Complete applicable sections: new_required")).toBeVisible();
    expect(screen.queryByText(/Complete applicable sections:.*locally_defined/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Freeze public draft" })).toBeDisabled();
  });

  it.each(["retained", "staff_assessed", "legacy"] as const)("separates %s reviewed identity and context from current request recovery", async custody => {
    const context = syntheticPlanContext();
    if (custody === "staff_assessed") {
      const first = context.assessment.authorities[0];
      first.jurisdiction = { country: "NZ", subdivision: "WGN" };
      first.sourceUrls = ["https://example.test/authority"];
      context.assessment.authorities.push({ ...first, id: "20000000-0000-4000-8000-000000000099", label: "SYNTHETIC consultation body", jurisdiction: null, sourceUrls: [] });
      context.assessment.applicability = { status: "staff_assessed", explanation: "SYNTHETIC reviewed source finding", authorityIds: [first.id], sourceUrls: ["https://example.test/assessment"] };
    }
    const currentContext = syntheticPlanContext(); currentContext.place.label = "SYNTHETIC later area";
    const newer = { ...WORKBENCH.activeVersion, id: "77777777-7777-4777-8777-777777777777", version_number: 2 };
    const frozen = { ...WORKBENCH,
      canWrite: false, isHistoricalVersion: true,
      plan: { ...WORKBENCH.plan, title: "SYNTHETIC later title", descriptor_id: "current-edition", current_working_version_id: newer.id },
      activeVersion: { ...WORKBENCH.activeVersion, state: "adopted" },
      versions: [newer, { ...WORKBENCH.activeVersion, state: "adopted" }],
      descriptor: { ...WORKBENCH.descriptor, id: "reviewed-edition", terminology: { ...WORKBENCH.descriptor.terminology, plan: "Reviewed plan wording" },
        processSteps: [{ key: "setup", label: "Saved plan area", required: true, sourceUrls: [] }] },
      frozenVersion: { plan: { id: WORKBENCH.plan.id, descriptorId: "reviewed-edition", planKindKey: "community",
        title: "SYNTHETIC reviewed title", authorityLabel: "SYNTHETIC reviewed authority", geographyLabel: "SYNTHETIC reviewed area" },
        descriptorCustody: custody !== "legacy" ? "frozen" : "not_retained",
        context: custody !== "legacy" ? { status: "retained", context } : { status: "legacy" } },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method) throw new Error("Reading reviewed context must not write");
      return url.endsWith("/context") ? Response.json({ actorId: frozen.actorId, workspaceId: frozen.plan.workspace_id, planId: frozen.plan.id,
        contextState: { status: "retained", context: currentContext }, contextHash: "b".repeat(64), descriptorId: frozen.plan.descriptor_id,
        planKindKey: frozen.plan.plan_kind_key, versionId: newer.id, canWrite: true }) : Response.json(frozen);
    }));
    render(<LandUsePlanWorkbench planId={frozen.plan.id} versionId={frozen.activeVersion.id}/>);
    expect(await screen.findByRole("heading", { level: 1, name: "SYNTHETIC reviewed title" })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(`/api/land-use-plans/${frozen.plan.id}?versionId=${frozen.activeVersion.id}`, { cache: "no-store" });
    const history = screen.getByRole("navigation", { name: "Plan version history" });
    expect(within(history).getByText("Viewing version 1")).toHaveAttribute("aria-current", "page");
    expect(within(history).getByText(/This historical view is read-only/)).toBeVisible();
    for (const [name, href] of [["Open version 2 in a new tab", `/land-use-plans/${frozen.plan.id}?versionId=${newer.id}`], ["Open the current plan in a new tab", `/land-use-plans/${frozen.plan.id}`]]) {
      const link = within(history).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href); expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getByRole("button", { name: "Publish frozen plan" })).toBeDisabled();
    expect(screen.queryByRole("heading", { level: 1, name: frozen.plan.title })).not.toBeInTheDocument();
    expect(screen.getByText("SYNTHETIC reviewed authority · SYNTHETIC reviewed area")).toBeVisible();
    expect(within(screen.getByRole("heading", { name: "Workflow" }).closest("section")!).getByText(/Saved plan area/)).toHaveTextContent(custody === "legacy" ? "Open" : "Complete");
    const panel = screen.getByRole("region", { name: custody === "legacy" ? "Context not retained with this version" : "Context retained with this version" });
    expect(within(panel).queryByText("SYNTHETIC later area")).not.toBeInTheDocument();
    if (custody !== "legacy") {
      expect(within(panel).getByText(context.place.label)).toBeVisible();
      expect(within(panel).getByText(context.assessment.authorities[0].label)).toBeVisible();
      expect(within(panel).getByText(context.assessment.applicability.explanation)).toBeVisible();
      if (custody === "staff_assessed") {
        expect(within(panel).getByText("Staff assessed applicability.")).toBeVisible();
        expect(within(panel).getByText("Assessed bodies: SYNTHETIC responsible body")).toBeVisible();
        expect(within(panel).getByText("NZ / WGN")).toBeVisible();
        for (const name of ["https://example.test/authority", "https://example.test/assessment"]) expect(within(panel).getByRole("link", { name })).toHaveAttribute("href", name);
      } else expect(within(panel).getByText("Applicability remains unresolved.")).toBeVisible();
      expect(screen.getByText(/checklist, terminology and source-review dates were saved with this version/)).toBeVisible();
    } else {
      expect(within(panel).getByText(/did not retain its plan context/)).toBeVisible();
      expect(within(panel).queryByText(context.place.label)).not.toBeInTheDocument();
      expect(screen.getByText(/did not retain its checklist or source-review dates/)).toBeVisible();
    }
    expect(screen.getByText("Current plan context and request recovery").closest("details")).not.toHaveAttribute("open");
    await screen.findByText("Current saved context");
    await screen.findByText("Saved context loaded.");
    expect(screen.getByText("Plan area: SYNTHETIC later area")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Save plan context" })).toBeDisabled();
  });

  it("keeps unsaved draft text in place when history opens in another tab", async () => {
    const historicalId = "77777777-7777-4777-8777-777777777777";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...WORKBENCH, versions: [
      ...WORKBENCH.versions, { ...WORKBENCH.activeVersion, id: historicalId, version_number: 0, state: "superseded" },
    ] })));
    render(<LandUsePlanWorkbench planId={WORKBENCH.plan.id}/>);
    const text = await screen.findByLabelText("Draft text");
    fireEvent.change(text, { target: { value: "SYNTHETIC unsaved edit" } });
    const link = screen.getByRole("link", { name: "Open version 0 in a new tab" });
    expect(link).toHaveAttribute("href", `/land-use-plans/${WORKBENCH.plan.id}?versionId=${historicalId}`);
    expect(link).toHaveAttribute("target", "_blank");
    fireEvent.click(link);
    expect(text).toHaveValue("SYNTHETIC unsaved edit");
    expect(writes).toEqual([]);
  });

  it.each([true, false])("refuses form writes in a read-only working view, historical=%s", async historical => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method) { writes.push(JSON.parse(String(init.body))); return Response.json({ updated: true }); }
      return Response.json({ ...WORKBENCH, canWrite: false, isHistoricalVersion: historical });
    }));
    render(<LandUsePlanWorkbench planId={WORKBENCH.plan.id}/>);
    const add = await screen.findByRole("button", { name: "Add content node" });
    for (const name of ["Add content node", "Add implementation action", "Add relationship"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    // A synthetic submit bypasses the disabled button and reaches the shared write refusal.
    expect(fireEvent.submit(add.closest("form")!)).toBe(false);
    expect(await screen.findByText("This plan view is read-only.")).toBeVisible();
    expect(writes).toEqual([]);
  });
});
