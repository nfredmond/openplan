import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const WORKBENCH = {
  plan: {
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
  versions: [{ id: "22222222-2222-4222-8222-222222222222", version_number: 1, version_kind: "original", state: "working", applicable_requirement_keys: [], content_hash: null, frozen_at: null, published_report_id: null }],
  activeVersion: { id: "22222222-2222-4222-8222-222222222222", version_number: 1, version_kind: "original", state: "working", applicable_requirement_keys: [], content_hash: null, frozen_at: null, published_report_id: null },
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
    writes.length = 0;
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

  it("does not turn an unsourced descriptor date into a legal-source review claim", async () => {
    render(<LandUsePlanWorkbench planId={WORKBENCH.plan.id} />);
    await screen.findByText("Local legal requirements are not configured.");
    expect(screen.queryByText(/Sources reviewed/)).not.toBeInTheDocument();
    expect(screen.getByText(/source review is not established/i)).toBeVisible();
  });
});
