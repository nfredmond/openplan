import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * REACHABILITY, not unit behaviour.
 *
 * `listStageGateTemplates()` shipped in `template-loader.ts` documented as "the
 * source for a jurisdiction picker" and had no caller outside its own test.
 * Meanwhile `describeStageGateBinding()` was telling planners in the product to
 * "Rebind this workspace to the template registered for …" — naming an action
 * no surface offered. That is the shipped-invisible defect class: complete,
 * tested logic no person can reach.
 *
 * So this suite refuses two shortcuts that would make it prove nothing:
 *
 *   1. IT DOES NOT MOCK THE PANEL. The setup page's own suite mocks every
 *      workspace panel, which is right for testing the page and useless for
 *      proving the picker exists. Here the real `WorkspaceStageGatePanel`
 *      renders inside the real `WorkspacePage`.
 *   2. IT DOES NOT HAND-WRITE THE CHOICES. `buildStageGateRebindChoices` is
 *      driven from a workspace ROW through the real reconciliation and the real
 *      registry. A stage-gate action already shipped once with an offer
 *      condition no board could satisfy, because its test described a board the
 *      product cannot produce.
 *
 * The two-template case is built with the REAL `createStageGateTemplateRegistry`
 * over an artifact derived from the REAL California pack — which is exactly how
 * a second jurisdiction pack arrives (a registration, never a call-site edit) —
 * rather than a literal describing what one might look like.
 */

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const runsLimitMock = vi.fn(() => ({ data: [] as unknown[], error: null }));
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsEqMock = vi.fn(() => ({ order: runsOrderMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock }));

const modelRunsRowsMock = vi.fn(() => ({ data: [] as unknown[], error: null }));

/** The workspace row the page reads, and the columns it asked for. */
const workspaceRowMock = vi.fn<() => { data: unknown; error: unknown }>(() => ({
  data: null,
  error: null,
}));
const workspacesSelectedColumns: string[] = [];
/**
 * This mock PROJECTS. A mocked Supabase client normally returns the fixture
 * whatever columns were asked for, which is why deleting a column from a
 * `.select()` leaves every assertion green while the real page renders
 * `undefined` — CLAUDE.md names this exact failure. Narrowing the row to the
 * requested column list here means a dropped column shows up as the wrong
 * SENTENCE on screen, not only as a failed string comparison, so the disclosure
 * assertions below are load-bearing too.
 */
const workspacesSelectMock = vi.fn((columns: string) => {
  workspacesSelectedColumns.push(columns);
  const requested = columns.split(",").map((column) => column.trim());
  return {
    eq: () => ({
      maybeSingle: async () => {
        const result = workspaceRowMock();
        if (!result.data || typeof result.data !== "object") return result;
        const row = result.data as Record<string, unknown>;
        return {
          ...result,
          data: Object.fromEntries(
            requested.filter((column) => column in row).map((column) => [column, row[column]])
          ),
        };
      },
    }),
  };
});

const fromMock = vi.fn((table: string) => {
  if (table === "runs") return { select: runsSelectMock };
  if (table === "model_runs") {
    return { select: () => ({ eq: () => ({ in: async () => modelRunsRowsMock() }) }) };
  }
  if (table === "workspaces") return { select: workspacesSelectMock };
  if (table === "assistant_action_executions") {
    // The dashboard's recent-actions audit feed (absorbed from the retired
    // Command Center page); empty is fine — this suite is about the binding.
    return {
      select: () => ({
        eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      }),
    };
  }
  if (
    table === "engagement_items" ||
    table === "funding_awards" ||
    table === "billing_invoice_records"
  ) {
    // The Insights figures' three lanes (loadDashboardChartRows). Empty is fine
    // — this suite is about the binding; the figures have their own tests.
    const chain: Record<string, unknown> = {};
    for (const method of ["eq", "gte", "order", "limit"]) chain[method] = () => chain;
    chain.then = <T,>(resolve: (value: { data: unknown[]; error: null }) => T) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    return { select: () => chain };
  }
  throw new Error(`Unexpected table: ${table}`);
});

// Deliberately only `redirect`, matching what the dashboard's own suite mocks.
// The panel must not need a router: after a rebind every gate diff it holds was
// computed against the PREVIOUS binding, so refreshing into a half-updated
// picker would be worse than closing it. A `useRouter` here would hide a
// regression that reintroduces that dependency.
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) =>
    loadCurrentWorkspaceMembershipMock(...args),
}));

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>(
    "@/lib/operations/workspace-summary"
  );
  return {
    ...actual,
    loadWorkspaceOperationsSummaryForWorkspace: (...args: unknown[]) =>
      loadWorkspaceOperationsSummaryForWorkspaceMock(...args),
  };
});

// Everything on the dashboard that is NOT the surface under test. The
// stage-gate panel is deliberately absent from this list.
vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/runs/RunHistory", () => ({ RunHistory: () => <div /> }));
vi.mock("@/components/workspaces/workspace-geography-panel", () => ({
  WorkspaceGeographyPanel: () => <div data-testid="workspace-geography-panel" />,
}));
vi.mock("@/components/workspaces/workspace-team-panel", () => ({
  WorkspaceTeamPanel: () => <div />,
}));
vi.mock("@/components/workspaces/workspace-integration-keys-panel", () => ({
  WorkspaceIntegrationKeysPanel: () => <div />,
}));
vi.mock("@/components/dashboard/build-identity-line", () => ({
  BuildIdentityLine: () => <div />,
}));
vi.mock("@/components/dashboard/deployment-health-panel", () => ({
  DeploymentHealthPanel: () => <div />,
}));
vi.mock("@/lib/config/deployment-health", () => ({
  evaluateDeploymentHealth: () => ({ status: "ready", problems: [] }),
}));
vi.mock("@/lib/config/deployment-health-facts", () => ({
  readDeploymentEnvFacts: () => ({}),
  resolveModelingWorkerDeclaration: () => "declared",
  loadModelingWorkerFacts: async () => ({ declared: true }),
}));
vi.mock("@/lib/models/worker-health-server", () => ({
  loadModelingWorkerHealth: async () => ({
    aequilibrae: { kind: "aequilibrae", state: "fresh", reason: "fresh" },
    activitysim: { kind: "activitysim", state: "fresh", reason: "fresh" },
  }),
}));

import WorkspacePage from "@/app/(app)/workspace/page";
import { WorkspaceStageGatePanel } from "@/components/workspaces/workspace-stage-gate-panel";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";
import {
  buildStageGateRebindChoices,
  STAGE_GATE_BINDING_WORKSPACE_COLUMNS,
} from "@/lib/stage-gates/rebind";
import {
  BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS,
  createStageGateTemplateRegistry,
  stageGateTemplateRegistry,
} from "@/lib/stage-gates/template-registry";
import { describeStageGateBinding, resolveWorkspaceStageGateBinding } from "@/lib/stage-gates/template-loader";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

/**
 * The workspace row a self-serve sign-up leaves behind: the trigger inserts only
 * (name, slug), so `stage_gate_template_id` is whatever the migration's DEFAULT
 * is — read from the registry rather than retyped — and no geography is stated.
 */
function signupWorkspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKSPACE_ID,
    stage_gate_template_id: stageGateTemplateRegistry.defaultTemplateId,
    home_geography_source: null,
    home_geography_kind: null,
    home_geography_ref: null,
    home_geography_label: null,
    home_country_code: null,
    home_subdivision_code: null,
    ...overrides,
  };
}

/** The home-geography shape a TIGERweb county in one subdivision resolves to. */
function inSubdivision(subdivision: string) {
  return {
    home_geography_source: "tigerweb",
    home_geography_kind: "county",
    home_geography_ref: "00000",
    home_geography_label: "Some County",
    home_country_code: "US",
    home_subdivision_code: subdivision,
  };
}

/**
 * An ADDITIONAL registered pack, built the way a new pack really arrives: a
 * registration handed to the real registry factory, which validates the artifact
 * and rejects a jurisdiction mismatch. Its gates are derived from the shipped
 * default artifact — the first two dropped, one added — so the departing and
 * arriving gate lists this suite asserts on are real gate ids from a real
 * document, not names invented to match an assertion.
 */
function twoTemplateRegistry() {
  const defaultPack = stageGateTemplateRegistry.get(
    stageGateTemplateRegistry.defaultTemplateId ?? ""
  );
  if (!defaultPack) throw new Error("The built-in registry has no default template to derive from");

  const keptGates = defaultPack.document.gates.filter(
    (gate) => !defaultPack.document.gate_order.slice(0, 2).includes(gate.gate_id)
  );
  const addedGate = {
    gate_id: "GX1_SECOND_PACK_ONLY",
    sequence: 99,
    name: "A gate only the second pack defines",
    required_evidence: [],
  };

  return createStageGateTemplateRegistry([
    ...BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS,
    {
      artifact: {
        template_id: "second_pack_v0_1",
        template_name: "Second Jurisdiction Pack",
        version: "0.1.0",
        jurisdiction: "OH",
        gate_order: [...keptGates.map((gate) => gate.gate_id), addedGate.gate_id],
        gates: [...keptGates, addedGate],
      },
      jurisdiction: { country: "US", subdivision: "OH", label: "Ohio, United States" },
    },
  ]);
}

function emptyWorkspaceSummary() {
  return buildWorkspaceOperationsSummaryFromSourceRows({
    projects: [],
    plans: [],
    programs: [],
    reports: [],
    fundingOpportunities: [],
  });
}

async function renderWorkspace() {
  render(await WorkspacePage());
}

beforeEach(() => {
  vi.clearAllMocks();
  workspacesSelectedColumns.length = 0;
  runsLimitMock.mockReturnValue({ data: [], error: null });
  modelRunsRowsMock.mockReturnValue({ data: [], error: null });
  workspaceRowMock.mockReturnValue({ data: signupWorkspaceRow(), error: null });
  loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue(emptyWorkspaceSummary());
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: WORKSPACE_ID, role: "owner" },
    workspace: { id: WORKSPACE_ID, name: "Any Agency", created_at: "2026-01-01T00:00:00Z" },
  });
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: fromMock,
  });
});

describe("a planner can reach the stage-gate template binding from workspace setup", () => {
  it("mounts the real panel, and its disclosure is the one describeStageGateBinding produces", async () => {
    // A California workspace BOUND to the California pack: stored id and
    // geography agree, so this is the non-alarming path and the panel must not
    // cry wolf on it. The stored id is explicit here because the registry
    // default is now the US federal-aid floor — a CA workspace still holding
    // the default would (correctly) be told to rebind, which is the OTHER path.
    const boundCaliforniaRow = signupWorkspaceRow({
      ...inSubdivision("CA"),
      stage_gate_template_id: "ca_stage_gates_v0_1",
    });
    workspaceRowMock.mockReturnValue({
      data: boundCaliforniaRow,
      error: null,
    });

    await renderWorkspace();

    const panel = screen.getByRole("region", { name: "Stage-gate template" });

    // Built by the real resolver over the same row the page read — so this
    // asserts the panel renders THE binding, not a plausible sentence.
    const resolution = resolveWorkspaceStageGateBinding(boundCaliforniaRow);
    if (resolution.kind !== "resolved") throw new Error("expected a resolved binding");
    const disclosure = describeStageGateBinding(resolution.binding);

    expect(within(panel).getByText(disclosure.headline)).toBeInTheDocument();
    expect(within(panel).getByText(disclosure.detail)).toBeInTheDocument();
    expect(resolution.binding.templateSelection).toBe("jurisdiction_matched");

    // The other built-in pack — the US federal-aid floor — is offered as a
    // rebind option WITH its own self-description, so a planner picking reads
    // what the template says it is, not just its name.
    const floor = stageGateTemplateRegistry.get("us_federal_aid_stage_gates_v0_1");
    expect(floor?.descriptor.templateDescription).toBeTruthy();
    expect(
      within(panel).getByText(floor!.descriptor.templateDescription!)
    ).toBeInTheDocument();
  });

  it("asks the database for the columns the binding is resolved from", async () => {
    await renderWorkspace();

    const projection = workspacesSelectedColumns.find((columns) =>
      columns.includes("home_country_code")
    );
    expect(projection).toBeDefined();
    // Both are load-bearing and both are easy to lose: without the stored id the
    // binding of record is invisible, and without the subdivision every
    // California workspace resolves as a country-level "US" one whose pack the
    // registry then cannot find.
    expect(projection).toContain("stage_gate_template_id");
    expect(projection).toContain("home_subdivision_code");
    expect(projection).toContain("stage_gate_template_selection");
    expect(projection).toBe(STAGE_GATE_BINDING_WORKSPACE_COLUMNS);
  });

  it("says loudly, on workspace setup, when the bound template was assumed rather than chosen", async () => {
    // A workspace that has stated no geography holds the migration's DEFAULT.
    // Nobody chose it, and the gate names it renders belong to another
    // jurisdiction — the one case a planner must not read as settled.
    await renderWorkspace();

    const panel = screen.getByRole("region", { name: "Stage-gate template" });
    const resolution = resolveWorkspaceStageGateBinding(signupWorkspaceRow());
    if (resolution.kind !== "resolved") throw new Error("expected a resolved binding");
    const disclosure = describeStageGateBinding(resolution.binding);

    expect(disclosure.isJurisdictionAssumed).toBe(true);
    expect(within(panel).getByText(disclosure.headline)).toBeInTheDocument();
    expect(within(panel).getByText(disclosure.detail)).toBeInTheDocument();

    // The bound template's own scope disclosures render with the binding. For
    // the federal-aid floor these are the three honesty limits (state-manual
    // overlay, FTA exclusion, NEPA-only), and they are asserted from the
    // template's descriptor rather than retyped so the artifact stays the
    // single source.
    expect(resolution.binding.scopeNotes?.length ?? 0).toBeGreaterThanOrEqual(3);
    for (const note of resolution.binding.scopeNotes ?? []) {
      expect(within(panel).getByText(note)).toBeInTheDocument();
    }
  });

  it("says the binding could not be READ, rather than answering from a failed query", async () => {
    // The workspace row read fails. `data` is then null — and a null row
    // resolves through the real reconciliation to the interim default whose
    // disclosure states "This workspace has not stated where it works" and tells
    // the planner to go set a home geography they may already have set. That is
    // a claim about the agency, and a broken query cannot make it.
    workspaceRowMock.mockReturnValue({
      data: null,
      error: { message: "column workspaces.stage_gate_template_id does not exist" },
    });

    await renderWorkspace();

    const panel = screen.getByRole("region", { name: "Stage-gate template" });
    expect(within(panel).getByText(/could not read which stage-gate template/i)).toBeInTheDocument();
    expect(within(panel).getByText(/failed read, not a finding/i)).toBeInTheDocument();

    // The sentence a null row WOULD have produced, asserted through the real
    // resolver so it stays exact if the wording changes.
    const fromNullRow = resolveWorkspaceStageGateBinding(null);
    if (fromNullRow.kind !== "resolved") throw new Error("expected a resolved binding");
    const wouldHaveClaimed = describeStageGateBinding(fromNullRow.binding);
    expect(wouldHaveClaimed.detail).toMatch(/has not stated where it works/i);
    expect(within(panel).queryByText(wouldHaveClaimed.detail)).toBeNull();
    expect(within(panel).queryByText(wouldHaveClaimed.headline)).toBeNull();

    // And no control: every gate list in the review step is a diff against the
    // current binding, which is precisely what could not be read.
    expect(within(panel).queryByRole("radio")).toBeNull();
    // Workspace setup is an internal page, so an operator may see the reason.
    expect(
      within(panel).getByText(/column workspaces.stage_gate_template_id does not exist/i)
    ).toBeInTheDocument();
  });

  it("offers the other registered packs, or states plainly when there is nothing else to bind to", async () => {
    // Asserted against the registry rather than a literal: with the CA pack and
    // the US federal-aid floor both built in, an owner sees a real alternative;
    // if the registry ever shrinks to one pack again, the panel must say there
    // is nothing else rather than render an empty picker.
    await renderWorkspace();

    const panel = screen.getByRole("region", { name: "Stage-gate template" });
    if (stageGateTemplateRegistry.list().length === 1) {
      expect(within(panel).getByText(/no other one to bind to/i)).toBeInTheDocument();
      expect(within(panel).queryByRole("radio")).toBeNull();
    } else {
      expect(within(panel).getAllByRole("radio").length).toBeGreaterThan(0);
    }
  });
});

describe("the rebind itself", () => {
  it("offers every other registered pack, names the gates leaving the board, and only then writes", async () => {
    const registry = twoTemplateRegistry();
    const row = signupWorkspaceRow(inSubdivision("CA"));
    // The REAL builder over a REAL row and a REAL registry.
    const choices = buildStageGateRebindChoices(row, { registry });
    if (choices.kind !== "bound") throw new Error(`expected a bound workspace, got ${choices.kind}`);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ workspaceId: WORKSPACE_ID, templateId: "second_pack_v0_1" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WorkspaceStageGatePanel workspaceId={WORKSPACE_ID} canManage choices={choices} />
    );

    const option = screen.getByRole("radio", { name: /Second Jurisdiction Pack/ });
    fireEvent.click(option);

    // Selecting must not write. The review step is the whole point: a rebind is
    // funder-facing and has to be explicit.
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Review rebind/ }));

    // The two gates the second pack dropped are named, by the name the real
    // default document gives them — the operator confirms against the list,
    // not against a promise.
    const defaultPack = stageGateTemplateRegistry.get(
      stageGateTemplateRegistry.defaultTemplateId ?? ""
    );
    const departing = defaultPack!.document.gate_order.slice(0, 2);
    expect(departing.length).toBe(2);
    for (const gateId of departing) {
      expect(screen.getByText(new RegExp(gateId))).toBeInTheDocument();
    }
    expect(screen.getByText(/GX1_SECOND_PACK_ONLY/)).toBeInTheDocument();
    expect(
      screen.getByText(/never edited, re-mapped, or deleted by a rebind/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Rebind to Second Jurisdiction Pack/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/workspaces/stage-gate-template");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      workspaceId: WORKSPACE_ID,
      templateId: "second_pack_v0_1",
      // Sent so the route can refuse if someone else rebound the workspace
      // while this operator was reading the departing-gate list.
      expectedCurrentTemplateId: choices.binding.templateId,
    });

    vi.unstubAllGlobals();
  });

  it("stops offering the picker after a rebind, because its gate diffs describe the old binding", async () => {
    const choices = buildStageGateRebindChoices(signupWorkspaceRow(inSubdivision("CA")), {
      registry: twoTemplateRegistry(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    );

    render(<WorkspaceStageGatePanel workspaceId={WORKSPACE_ID} canManage choices={choices} />);

    fireEvent.click(screen.getByRole("radio", { name: /Second Jurisdiction Pack/ }));
    fireEvent.click(screen.getByRole("button", { name: /Review rebind/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Rebind to/ }));

    // Every gates-leaving list on screen was computed against the template that
    // was bound when the page rendered. Offering a second rebind against those
    // numbers would let an operator confirm a change whose stated effect is no
    // longer true, so the control closes and says so.
    await waitFor(() => expect(screen.queryByRole("radio")).toBeNull());
    expect(screen.getByText(/No recorded gate decision was edited/i)).toBeInTheDocument();
    expect(screen.getByText(/Reload the page/i)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows the target template's scope disclosures in the review step, before the operator confirms", async () => {
    // A California workspace reviewing a rebind to the US federal-aid floor,
    // over the REAL built-in registry: the floor's three scope notes (state
    // manual overlay, FTA exclusion, NEPA-only) are what the operator must read
    // before binding to it, so they render inside the review card.
    const choices = buildStageGateRebindChoices(
      signupWorkspaceRow({ ...inSubdivision("CA"), stage_gate_template_id: "ca_stage_gates_v0_1" })
    );
    if (choices.kind !== "bound") throw new Error(`expected a bound workspace, got ${choices.kind}`);

    const floorOption = choices.options.find(
      (option) => option.templateId === "us_federal_aid_stage_gates_v0_1"
    );
    expect(floorOption?.scopeNotes?.length ?? 0).toBeGreaterThanOrEqual(3);

    render(<WorkspaceStageGatePanel workspaceId={WORKSPACE_ID} canManage choices={choices} />);

    fireEvent.click(screen.getByRole("radio", { name: /US Federal-Aid Delivery Floor/ }));
    fireEvent.click(screen.getByRole("button", { name: /Review rebind/ }));

    for (const note of floorOption?.scopeNotes ?? []) {
      expect(screen.getByText(note)).toBeInTheDocument();
    }
  });

  it("refuses to guess what would change when the bound template is not registered here", async () => {
    // A workspace pointing at a pack this deployment does not have. "Nothing
    // leaves the board" would be a claim the code cannot support, so the option
    // carries null and the panel says it could not be determined.
    const choices = buildStageGateRebindChoices(
      signupWorkspaceRow({ stage_gate_template_id: "a_pack_this_deployment_does_not_have" }),
      { registry: twoTemplateRegistry() }
    );
    if (choices.kind !== "unknown_template") {
      throw new Error(`expected unknown_template, got ${choices.kind}`);
    }
    expect(choices.options.every((option) => option.gatesLeaving === null)).toBe(true);

    render(<WorkspaceStageGatePanel workspaceId={WORKSPACE_ID} canManage choices={choices} />);

    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(screen.getByRole("button", { name: /Review rebind/ }));

    expect(screen.getByText(/could not be determined/i)).toBeInTheDocument();
    expect(screen.getByText(/not a statement that nothing changes/i)).toBeInTheDocument();
  });

  it("shows a member the binding but no control", async () => {
    const choices = buildStageGateRebindChoices(signupWorkspaceRow(inSubdivision("CA")), {
      registry: twoTemplateRegistry(),
    });

    render(
      <WorkspaceStageGatePanel workspaceId={WORKSPACE_ID} canManage={false} choices={choices} />
    );

    expect(screen.getByRole("region", { name: "Stage-gate template" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/Ask a workspace owner or admin/i)).toBeInTheDocument();
  });
});
