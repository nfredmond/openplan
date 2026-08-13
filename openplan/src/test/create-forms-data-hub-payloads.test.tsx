import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataHubRecordComposer } from "@/components/data-hub/data-hub-record-composer";

/**
 * THE REQUEST BODY, FIELD FOR FIELD, ACROSS A PRESENTATION CHANGE.
 *
 * `data-hub-record-composer.tsx` moved from three permanently-open tabbed forms
 * to three guided flows. Forty-two controls moved with it, and the failure mode
 * of that kind of change is silent: a field that stops being sent does not
 * throw, does not fail a type check, and does not look different on screen. The
 * record simply arrives at `/api/data-hub/records` missing a column, and nobody
 * finds out until somebody needs the citation, the checksum, or the vintage.
 *
 * So this asserts the POST BODY, not the layout. Every field of all three
 * record types, plus the four rules that are not "send what was typed":
 *
 *   1. `rowCount` / `recordsWritten` go as NUMBERS or not at all, never as the
 *      empty string a blank number input actually holds;
 *   2. `startedAt` / `completedAt` are converted to ISO, and omitted when blank;
 *   3. `relationshipType` is sent only when a project was chosen — otherwise it
 *      names a relationship to nothing;
 *   4. `thematicMetricKey` / `thematicMetricLabel` are sent only when the
 *      dataset is bound to geometry, because a metric on an unbound dataset
 *      names a column no map layer will ever read.
 *
 * WHAT IT CANNOT PROVE. Nothing visual: jsdom applies no stylesheet and has no
 * box model, so it cannot show the sheet is on screen, full-height on a phone,
 * that focus moved, or that the page behind is inert. Those are measured in a
 * real browser. It also does not check that the server accepts these names —
 * only that the browser still sends them.
 *
 * WHY EVERY QUERY IS SCOPED TO ONE SHEET. This page mounts three `<dialog>`s
 * and only one is open at a time. A real browser hides the other two — a closed
 * `<dialog>` is `display: none` — but jsdom applies no stylesheet, so all three
 * flows' controls are in the document and `getByLabelText(/connector/i)` finds
 * labels from a sheet nobody opened. Unscoped queries here would be measuring
 * a DOM no person ever sees. `sheet(id)` is the fix and it is not optional.
 */

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTOR_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const DATASET_ID = "44444444-4444-4444-8444-444444444444";

const fetchMock = vi.fn();

function renderComposer() {
  render(
    <DataHubRecordComposer
      workspaceId={WORKSPACE_ID}
      connectors={[{ id: CONNECTOR_ID, label: "Census ACS" }]}
      projects={[{ id: PROJECT_ID, label: "Downtown Mobility" }]}
      datasets={[{ id: DATASET_ID, label: "Equity indicators", connectorId: CONNECTOR_ID }]}
    />
  );
}

/** The one sheet under test, so a closed sibling cannot answer a query. */
function sheet(flowId: string) {
  return within(screen.getByTestId(`guided-flow-${flowId}`));
}

let current = "";

function openSheet(buttonName: RegExp, flowId: string) {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
  current = flowId;
}

function next() {
  fireEvent.click(sheet(current).getByRole("button", { name: /^next$/i }));
}

function submit(name: RegExp) {
  fireEvent.click(sheet(current).getByRole("button", { name }));
}

function type(label: RegExp, value: string) {
  fireEvent.change(sheet(current).getByLabelText(label), { target: { value } });
}

async function sentBody(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const call = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(call[0]).toBe("/api/data-hub/records");
  return JSON.parse(String(call[1].body)) as Record<string, unknown>;
}

describe("Data Hub composer: the request body survived the move to guided flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends every connector field, and the workspace it was rendered for", async () => {
    renderComposer();
    openSheet(/add a connector/i, "data-hub-connector");

    type(/^connector name$/i, "Census ACS 5-Year");
    type(/short key/i, "census-acs5");
    type(/^description/i, "Five-year American Community Survey tables.");
    next();

    type(/^source type$/i, "census");
    type(/who publishes it/i, "federal");
    type(/is it working right now/i, "degraded");
    type(/how often does it update/i, "annual");
    next();

    type(/endpoint or source url/i, "https://api.census.gov/data/2023/acs/acs5");
    type(/how you sign in to it/i, "api_key");
    type(/who looks after it/i, "Priya / Data Ops");
    fireEvent.click(sheet(current).getByLabelText(/watch this source for policy/i));

    submit(/add connector/i);

    expect(await sentBody()).toEqual({
      workspaceId: WORKSPACE_ID,
      recordType: "connector",
      displayName: "Census ACS 5-Year",
      key: "census-acs5",
      sourceType: "census",
      category: "federal",
      status: "degraded",
      cadence: "annual",
      authMode: "api_key",
      endpointUrl: "https://api.census.gov/data/2023/acs/acs5",
      ownerLabel: "Priya / Data Ops",
      description: "Five-year American Community Survey tables.",
      policyMonitorEnabled: true,
    });
  });

  it("sends every dataset field, with rowCount as a number and the geometry metric bound", async () => {
    renderComposer();
    openSheet(/add a dataset/i, "data-hub-dataset");

    type(/^dataset name$/i, "Equity indicators for study corridors");
    type(/where it came from/i, CONNECTOR_ID);
    type(/^linked project/i, PROJECT_ID);
    type(/how the project uses it/i, "evidence");
    next();

    type(/^status$/i, "ready");
    type(/what area it describes/i, "tract");
    type(/coverage summary/i, "Focus zones + comparators");
    type(/^vintage/i, "ACS 2023");
    type(/how often you refresh it/i, "annual");
    next();

    type(/what it draws on/i, "analysis_tracts");
    type(/which number colours the map/i, "pctBelowPoverty");
    type(/what to call it on the legend/i, "Poverty screening");
    next();

    type(/^source url$/i, "https://api.census.gov/data/x");
    type(/what you are allowed to do with it/i, "Public domain");
    type(/^schema version$/i, "v2026.03");
    type(/checksum/i, "sha256:abc");
    type(/how many rows/i, "1842");
    type(/how to cite it/i, "US Census Bureau, ACS 2023.");
    type(/^notes$/i, "Tract vintage is 2020.");

    submit(/add dataset/i);

    const body = await sentBody();
    expect(body).toEqual({
      workspaceId: WORKSPACE_ID,
      recordType: "dataset",
      name: "Equity indicators for study corridors",
      connectorId: CONNECTOR_ID,
      projectId: PROJECT_ID,
      relationshipType: "evidence",
      status: "ready",
      geographyScope: "tract",
      geometryAttachment: "analysis_tracts",
      thematicMetricKey: "pctBelowPoverty",
      thematicMetricLabel: "Poverty screening",
      coverageSummary: "Focus zones + comparators",
      vintageLabel: "ACS 2023",
      sourceUrl: "https://api.census.gov/data/x",
      licenseLabel: "Public domain",
      schemaVersion: "v2026.03",
      checksum: "sha256:abc",
      rowCount: 1842,
      refreshCadence: "annual",
      citationText: "US Census Bureau, ACS 2023.",
      notes: "Tract vintage is 2020.",
    });
    // Not the string a blank-or-typed number input actually holds.
    expect(typeof body.rowCount).toBe("number");
  });

  it("omits the project relationship, the metric and the row count when they were never answered", async () => {
    renderComposer();
    openSheet(/add a dataset/i, "data-hub-dataset");

    type(/^dataset name$/i, "Unbound reference table");
    // No project, no geometry binding, no row count.
    next();
    next();
    next();

    submit(/add dataset/i);

    const body = await sentBody();
    // `undefined` values do not survive JSON.stringify — absence IS the
    // assertion, and it is the one that matters: a relationship to no project
    // and a metric on unbound geometry are both claims about nothing.
    expect(body).not.toHaveProperty("relationshipType");
    expect(body).not.toHaveProperty("projectId");
    expect(body).not.toHaveProperty("connectorId");
    expect(body).not.toHaveProperty("thematicMetricKey");
    expect(body).not.toHaveProperty("thematicMetricLabel");
    expect(body).not.toHaveProperty("rowCount");
    expect(body.geometryAttachment).toBe("none");
  });

  /**
   * FOUND BY MUTATION, and the mutation that found it survived first.
   *
   * Removing the `bound ?` guard from `thematicMetricKey` changed NOTHING —
   * the key is cleared whenever the binding changes, so by the time the guard
   * runs it is already empty and the guard has no work to do. Its twin does:
   * `thematicMetricLabel` is FREE TEXT and is not cleared, so a planner who
   * binds a dataset, names the legend, then unbinds it again would have sent a
   * legend label for a dataset that draws on nothing — a caption for a layer
   * that will never render. This is the case that makes the guard load-bearing,
   * and without it that half of the guard was untested.
   */
  it("drops a legend label typed while bound, when the binding is taken away again", async () => {
    renderComposer();
    openSheet(/add a dataset/i, "data-hub-dataset");

    type(/^dataset name$/i, "Unbound again");
    next();
    next();

    type(/what it draws on/i, "analysis_tracts");
    type(/what to call it on the legend/i, "Poverty screening");
    type(/what it draws on/i, "none");
    next();

    submit(/add dataset/i);

    const body = await sentBody();
    expect(body).not.toHaveProperty("thematicMetricLabel");
    expect(body.geometryAttachment).toBe("none");
  });

  it("drops a metric chosen for a binding that was then changed to nothing", async () => {
    renderComposer();
    openSheet(/add a dataset/i, "data-hub-dataset");

    type(/^dataset name$/i, "Rebound dataset");
    next();
    next();

    type(/what it draws on/i, "analysis_corridor");
    type(/which number colours the map/i, "safetyScore");
    // Changing what it draws on must not carry a metric the new layer has no
    // column for.
    type(/what it draws on/i, "none");
    next();

    submit(/add dataset/i);

    const body = await sentBody();
    expect(body).not.toHaveProperty("thematicMetricKey");
    expect(body.geometryAttachment).toBe("none");
  });

  it("sends every refresh-job field, with the times as ISO and the count as a number", async () => {
    renderComposer();
    openSheet(/log a refresh run/i, "data-hub-refresh-job");

    type(/^job name$/i, "Weekly ACS refresh check");
    type(/^connector \(optional\)$/i, CONNECTOR_ID);
    type(/^dataset \(optional\)$/i, DATASET_ID);
    next();

    type(/what it was doing/i, "backfill");
    type(/how it ended/i, "failed");
    type(/what started it/i, "scheduled");
    type(/rows written/i, "0");
    next();

    type(/started at/i, "2026-08-01T09:30");
    type(/finished at/i, "2026-08-01T10:15");
    type(/who or what started it/i, "nightly cron");
    type(/what happened/i, "Upstream returned 503 twice.");

    submit(/add refresh job/i);

    const body = await sentBody();
    expect(body).toMatchObject({
      workspaceId: WORKSPACE_ID,
      recordType: "refreshJob",
      jobName: "Weekly ACS refresh check",
      connectorId: CONNECTOR_ID,
      datasetId: DATASET_ID,
      jobType: "backfill",
      status: "failed",
      refreshMode: "scheduled",
      triggeredByLabel: "nightly cron",
      errorSummary: "Upstream returned 503 twice.",
    });
    // Zero is a real answer and must survive: "wrote nothing" is not "unknown".
    expect(body.recordsWritten).toBe(0);
    expect(String(body.startedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(String(body.completedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("omits the times entirely when a run is recorded after the fact", async () => {
    renderComposer();
    openSheet(/log a refresh run/i, "data-hub-refresh-job");

    type(/^job name$/i, "Recorded later");
    next();
    next();

    submit(/add refresh job/i);

    const body = await sentBody();
    expect(body).not.toHaveProperty("startedAt");
    expect(body).not.toHaveProperty("completedAt");
    expect(body).not.toHaveProperty("recordsWritten");
  });

  it("will not walk past a missing name, and says which answer is missing", async () => {
    renderComposer();
    openSheet(/add a connector/i, "data-hub-connector");

    // Next, with nothing typed. The submit button only exists on the last step,
    // so refusing to ADVANCE is what makes the required field unskippable —
    // the browser's own `required` attribute cannot do this across steps.
    next();

    expect(fetchMock).not.toHaveBeenCalled();
    // Twice, deliberately: once under the control it is about, once in the
    // sheet's own alert. An error a planner cannot see from the field it
    // concerns is the same as no error.
    expect(
      sheet("data-hub-connector").getAllByText(/give the source a name you will recognise in a list/i)
    ).toHaveLength(2);
    // Still on the first step: the name question is still on screen.
    expect(sheet("data-hub-connector").getByLabelText(/^connector name$/i)).toBeInTheDocument();
  });

  it("shows the server's own three-part refusal rather than a generic one", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "Data Hub schema is not available yet",
        details: "The connectors table does not exist in this deployment.",
        hint: "Apply the latest Supabase migrations, then try again.",
      }),
    });

    renderComposer();
    openSheet(/add a connector/i, "data-hub-connector");
    type(/^connector name$/i, "Census ACS 5-Year");
    next();
    next();
    submit(/add connector/i);

    const alert = await sheet("data-hub-connector").findByRole("alert");
    expect(alert).toHaveTextContent("Data Hub schema is not available yet");
    expect(alert).toHaveTextContent("The connectors table does not exist in this deployment.");
    expect(alert).toHaveTextContent("Apply the latest Supabase migrations, then try again.");
  });
});
