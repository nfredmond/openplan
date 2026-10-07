import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readPlanContextRecovery } from "@/lib/land-use-plans/plan-context-recovery";
import { LandUsePlanWorkbench } from "@/components/land-use-plans/land-use-plan-workbench";

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
    workspace_id: "66666666-6666-4666-8666-666666666666", plan_kind_key: "general",
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
});
