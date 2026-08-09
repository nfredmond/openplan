import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunEvidencePanel } from "@/components/models/model-run-evidence-panel";

/**
 * DID THE THING THE PLANNER WAS TOLD TO FIX ACTUALLY GET FIXED?
 *
 * OpenPlan tells a planner, in the worker's own words: "add a free Census key
 * under Settings -> Integrations, then relaunch this run". The relaunch route
 * REBUILDS the run's demographics server-side before requeueing — deliberately,
 * because a relaunch that reused the stale stamp made that instruction one that
 * could never work — so at the moment of the click the app already knows
 * whether the key took.
 *
 * It returned that answer in the response body and nothing read it. The route
 * said so about itself: "NOT YET RENDERED ... a planner still learns the
 * demographic-rebuild outcome from the worker's failure minutes later, not from
 * here." On a deployment whose worker is not running, they never learn it at
 * all.
 *
 * That is this repository's signature defect wearing a comment that admits it.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";

/** The real reason text, from `zone-attribute-source.ts::NO_KEY_REASON`. */
const NO_KEY_REASON =
  "No US Census API key is available. A workspace owner or admin can add a free key under " +
  "Settings -> Integrations (api.census.gov/data/key_signup.html); an operator can instead set " +
  "CENSUS_API_KEY for the whole deployment.";

const PACKET = {
  engine: "aequilibrae",
  provenance: { engine_version: "aeq-1.6.2" },
  inputs: { zone_count: 26 },
  assumptions: {},
  caveats: [],
};

function mockRelaunch(body: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: unknown, init?: { method?: string }) => {
    if (init?.method === "POST") {
      return { ok: true, json: async () => body };
    }
    return { ok: true, json: async () => PACKET };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel() {
  return render(
    <ModelRunEvidencePanel
      modelId={MODEL_ID}
      modelRunId={MODEL_RUN_ID}
      runTitle="Grass Valley screening run"
      runStatus="failed"
      engineKey="aequilibrae"
      comparisonCandidates={[]}
    />
  );
}

async function pressRelaunch() {
  const button = await screen.findByRole("button", { name: /relaunch/i });
  fireEvent.click(button);
}

describe("the relaunch button answers the question the planner just acted on", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says the demographics STILL could not be read, in the server's own words", async () => {
    mockRelaunch({
      executionOutlook: { tone: "warning", headline: "Queued", detail: "" },
      zoneAttributes: { status: "unavailable", keyOrigin: "none", reason: NO_KEY_REASON },
    });

    renderPanel();
    await pressRelaunch();

    const notice = await screen.findByTestId("model-run-zone-relaunch-notice");
    // "Still" is the load-bearing word: it tells a planner their fix did not
    // take, rather than reading as a fresh and unrelated problem.
    expect(notice).toHaveTextContent(/still could not be read/i);
    // And the actionable sentence survives intact — this panel must not
    // paraphrase a reason the server wrote.
    expect(notice).toHaveTextContent("Settings -> Integrations");
    expect(notice).toHaveTextContent("api.census.gov");
  });

  it("stays silent when the rebuild worked, because the run now speaks for itself", async () => {
    mockRelaunch({
      executionOutlook: { tone: "info", headline: "Queued", detail: "" },
      zoneAttributes: { status: "supplied", keyOrigin: "workspace", reason: null },
    });

    renderPanel();
    await pressRelaunch();

    await waitFor(() => expect(screen.queryByRole("button", { name: /relaunching/i })).toBeNull());
    expect(screen.queryByTestId("model-run-zone-relaunch-notice")).toBeNull();
  });

  it("stays silent on a SUCCESSFUL rebuild even when a reason came back", async () => {
    /**
     * The discriminating case. A "supplied" stamp normally carries a null
     * reason, so a test using that pair cannot tell the status check from the
     * reason check — verified by mutation: deleting the `status !== "supplied"`
     * condition survived every other case in this file. Announcing a problem
     * on a rebuild that WORKED is the failure mode, and it needs a fixture
     * where only the status distinguishes them.
     */
    mockRelaunch({
      executionOutlook: { tone: "info", headline: "Queued", detail: "" },
      zoneAttributes: {
        status: "supplied",
        keyOrigin: "workspace",
        reason: "Equity overlay unavailable at block-group level.",
      },
    });

    renderPanel();
    await pressRelaunch();

    await waitFor(() => expect(screen.queryByRole("button", { name: /relaunching/i })).toBeNull());
    expect(screen.queryByTestId("model-run-zone-relaunch-notice")).toBeNull();
  });

  it("clears the notice when the NEXT relaunch fails outright", async () => {
    /**
     * The reset at the top of the handler, which the success path does not
     * exercise: a relaunch that throws never reaches the setter below, so
     * without the reset the previous run's reason stays on screen next to a
     * completely different error. Verified by mutation — deleting the reset
     * survived the success-path test.
     */
    mockRelaunch({
      executionOutlook: { tone: "warning", headline: "Queued", detail: "" },
      zoneAttributes: { status: "unavailable", keyOrigin: "none", reason: NO_KEY_REASON },
    });
    renderPanel();
    await pressRelaunch();
    expect(await screen.findByTestId("model-run-zone-relaunch-notice")).toBeInTheDocument();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string }) =>
        init?.method === "POST"
          ? { ok: false, json: async () => ({ error: "Worker unreachable" }) }
          : { ok: true, json: async () => PACKET }
      )
    );
    await pressRelaunch();

    await waitFor(() =>
      expect(screen.queryByTestId("model-run-zone-relaunch-notice")).toBeNull()
    );
  });

  it("stays silent when a failure carries no reason to show", async () => {
    /**
     * A notice with an empty body is worse than none: it reports a problem and
     * then fails to name it.
     *
     * HONEST NOTE ON COVERAGE: this path is guarded TWICE — the setter returns
     * null rather than "" when there is no reason, and the JSX renders on
     * truthiness. Each covers the other, so neither can be killed by mutating
     * it alone; both "return an empty string instead of null" and "loosen the
     * render guard to !== null" are equivalent mutants and SURVIVED. The
     * behaviour below is asserted directly and is correct; what is not
     * demonstrated is that either guard is individually load-bearing. Left
     * redundant on purpose — this is a defensive pair, not two chances to be
     * right — and recorded so a future session does not read a green run here
     * as proof that removing one is safe.
     */
    mockRelaunch({
      executionOutlook: { tone: "info", headline: "Queued", detail: "" },
      zoneAttributes: { status: "handoff_failed", keyOrigin: "workspace", reason: null },
    });

    renderPanel();
    await pressRelaunch();

    await waitFor(() => expect(screen.queryByRole("button", { name: /relaunching/i })).toBeNull());
    expect(screen.queryByTestId("model-run-zone-relaunch-notice")).toBeNull();
  });

  it("shows a handoff failure, not only a missing key", async () => {
    const storageReason =
      "The demographics for this run were read but could not be stored for the worker (bucket missing).";
    mockRelaunch({
      executionOutlook: { tone: "info", headline: "Queued", detail: "" },
      zoneAttributes: { status: "handoff_failed", keyOrigin: "workspace", reason: storageReason },
    });

    renderPanel();
    await pressRelaunch();

    expect(await screen.findByTestId("model-run-zone-relaunch-notice")).toHaveTextContent(
      "could not be stored for the worker"
    );
  });

  it("clears a previous notice so a stale answer cannot outlive its relaunch", async () => {
    // The panel is long-lived. A notice left over from an earlier press would
    // describe a rebuild that already happened, which is the stale-stamp defect
    // this whole field exists to prevent, one layer up.
    mockRelaunch({
      executionOutlook: { tone: "warning", headline: "Queued", detail: "" },
      zoneAttributes: { status: "unavailable", keyOrigin: "none", reason: NO_KEY_REASON },
    });
    renderPanel();
    await pressRelaunch();
    expect(await screen.findByTestId("model-run-zone-relaunch-notice")).toBeInTheDocument();

    mockRelaunch({
      executionOutlook: { tone: "info", headline: "Queued", detail: "" },
      zoneAttributes: { status: "supplied", keyOrigin: "workspace", reason: null },
    });
    await pressRelaunch();

    await waitFor(() =>
      expect(screen.queryByTestId("model-run-zone-relaunch-notice")).toBeNull()
    );
  });
});

describe("the route's own comment about this field", () => {
  it("no longer claims the field is unrendered", () => {
    /**
     * The route documented its own gap ("NOT YET RENDERED"). Leaving that in
     * place after wiring it would be a comment that is confidently wrong about
     * the code beside it — the drift this repository treats as dangerous,
     * because a stale doc is believed.
     */
    const source = readFileSync(
      path.join(process.cwd(), "src/app/api/models/[modelId]/runs/[modelRunId]/launch/route.ts"),
      "utf8"
    );
    expect(source).not.toContain("NOT YET RENDERED: the only caller today");
    expect(source).toContain("RENDERED 2026-08-08");
    // The field itself must still be returned, or the panel has nothing to read.
    expect(source).toContain("zoneAttributes: zoneAttributes");
  });
});
