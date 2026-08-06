/**
 * REACHABILITY GUARD — a planner can actually choose the transit feed their
 * model run uses, and what they chose reaches the launch request.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `transit-feed-handoff.test.ts`. That one
 * proves the handoff resolves a feed correctly. This one proves a person can
 * reach it. CLAUDE.md records eleven instances of the opposite: a capability
 * complete, tested, access-gated, reviewed — and unreachable. `src/test/
 * every-api-route-has-a-caller.test.ts` catches only "no caller at all"; it
 * cannot see a control gated on the wrong condition or a value collected by a
 * form and dropped before the fetch. So this renders the real control and reads
 * the real request body.
 *
 * THE ASSERTIONS THAT MATTER MOST ARE THE DISCLOSURES, not the picker.
 * A feed can be successfully ingested and still be one the model cannot use —
 * because it is frequency-based (OpenPlan's parser accepts those deliberately;
 * `gtfs_skim` refuses them), or because its stops are nowhere near the study
 * area. Both are knowable BEFORE the run is queued, and a planner who learns
 * either from a finished run with no transit in it has lost the afternoon this
 * lane exists to save.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/models",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));

import { ModelRunManager, type TransitFeedOption } from "@/components/models/model-run-manager";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_ID = "33333333-3333-4333-8333-333333333333";
const FEED_ID = "55555555-5555-4555-8555-555555555555";
const FREQUENCY_FEED_ID = "66666666-6666-4666-8666-666666666666";

const CORRIDOR = JSON.stringify({
  type: "Polygon",
  coordinates: [
    [
      [-121.5, 38.5],
      [-121.4, 38.5],
      [-121.4, 38.6],
      [-121.5, 38.6],
      [-121.5, 38.5],
    ],
  ],
});

const FEEDS: TransitFeedOption[] = [
  {
    id: FEED_ID,
    agencyName: "Sacramento Regional Transit",
    serviceEndDate: "2025-04-05",
    frequencyTripCount: 0,
    scheduledTripCount: 480,
  },
  {
    // THE SEVENTH SAMPLED FEED, to scale: 4 frequencies rows covering 2 of its
    // 18,150 trips. Under the rule both lanes used until 2026-08-06 this agency
    // lost its ENTIRE feed over those four rows.
    id: FREQUENCY_FEED_ID,
    agencyName: "Headway Publishing Agency",
    serviceEndDate: "2026-12-31",
    frequencyTripCount: 2,
    scheduledTripCount: 18148,
  },
];

type FetchCall = { url: string; body: Record<string, unknown> };

let calls: FetchCall[] = [];

function stubFetch(coverage: { coverage: string; reason: string | null } = { coverage: "yes", reason: null }) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url, body });
      if (url.includes("study-area-coverage")) {
        return { ok: true, json: async () => coverage } as unknown as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    })
  );
}

function renderManager(props: Partial<React.ComponentProps<typeof ModelRunManager>> = {}) {
  render(
    <ModelRunManager
      modelId={MODEL_ID}
      modelTitle="Regional screening model"
      defaultQueryText="Screening run"
      defaultCorridorText={CORRIDOR}
      scenarioEntries={[]}
      modelRuns={[]}
      schemaPending={false}
      workspaceId={WORKSPACE_ID}
      transitFeeds={FEEDS}
      {...props}
    />
  );
}

/** The picker only exists for the engines whose runs reach a transit skim. */
function selectEngine(value: string) {
  fireEvent.change(screen.getByLabelText(/Run mode/i), { target: { value } });
}

beforeEach(() => stubFetch());
afterEach(() => vi.unstubAllGlobals());

describe("choosing the feed a model run models transit from", () => {
  it("offers this workspace's feeds on the engines that reach a transit skim", () => {
    renderManager();
    selectEngine("aequilibrae");

    const picker = screen.getByLabelText(/Transit feed/i);
    expect(picker).toBeTruthy();
    expect(screen.getByText(/Sacramento Regional Transit/)).toBeTruthy();
  });

  it("offers nothing on an engine whose run never skims transit", () => {
    // A setting with no effect is worse than no setting: the planner believes
    // they chose something.
    renderManager();
    selectEngine("sketch_abm");

    expect(screen.queryByTestId("managed-run-transit-feed")).toBeNull();
  });

  it("defaults to leaving the worker's own feed selection alone", async () => {
    renderManager();
    selectEngine("aequilibrae");
    fireEvent.click(screen.getByRole("button", { name: /Launch run/i }));

    await waitFor(() => expect(calls.some((call) => call.url.includes("/runs"))).toBe(true));
    const launch = calls.find((call) => call.url.endsWith(`/api/models/${MODEL_ID}/runs`));
    // Absent, not null and not "": every run before this control existed
    // behaves exactly as it did.
    expect(launch?.body).not.toHaveProperty("transitFeedId");
  });

  it("sends the feed the planner picked", async () => {
    renderManager();
    selectEngine("aequilibrae");
    fireEvent.change(screen.getByLabelText(/Transit feed/i), { target: { value: FEED_ID } });
    fireEvent.click(screen.getByRole("button", { name: /Launch run/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith(`/api/models/${MODEL_ID}/runs`))).toBe(true)
    );
    const launch = calls.find((call) => call.url.endsWith(`/api/models/${MODEL_ID}/runs`));
    expect(launch?.body.transitFeedId).toBe(FEED_ID);
  });

  it("does not send a feed id on an engine that would ignore it", async () => {
    renderManager();
    selectEngine("aequilibrae");
    fireEvent.change(screen.getByLabelText(/Transit feed/i), { target: { value: FEED_ID } });
    selectEngine("sketch_abm");
    fireEvent.click(screen.getByRole("button", { name: /Launch run/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith(`/api/models/${MODEL_ID}/runs`))).toBe(true)
    );
    const launch = calls.find((call) => call.url.endsWith(`/api/models/${MODEL_ID}/runs`));
    expect(launch?.body).not.toHaveProperty("transitFeedId");
  });

  it("says so, and points at the Data Hub, when the workspace has no feed in use", () => {
    // An empty picker and "you have not ingested a feed" look identical; the
    // second is a fact and the first is a shrug.
    renderManager({ transitFeeds: [] });
    selectEngine("aequilibrae");

    const block = screen.getByTestId("managed-run-transit-feed");
    expect(block).toHaveTextContent(/no transit feed in use yet/i);
    expect(block).toHaveTextContent(/Data Hub/);
  });
});

describe("what a planner is told before they queue the run", () => {
  it("DISCLOSES what a partly frequency-based feed leaves out, and still hands it over", () => {
    // THE SENTENCE THAT USED TO BE FALSE. It told the planner the worker would
    // "fall back to its own feed selection" — which was true of the app's old
    // terminal refusal and is not true of anything now. Worse, the refusal it
    // described threw away the whole feed: of 16 sampled US feeds 7 ship
    // frequencies.txt, six header-only, and the seventh carries 4 rows over 2 of
    // its 18,150 trips. The worker now drops those trips, counts them, and
    // refuses only when nothing scheduled is left on the modeled day.
    renderManager();
    selectEngine("aequilibrae");
    fireEvent.change(screen.getByLabelText(/Transit feed/i), { target: { value: FREQUENCY_FEED_ID } });

    const disclosure = screen.getByTestId("managed-run-transit-feed-frequencies");
    expect(disclosure).toHaveTextContent(/frequencies\.txt/);
    // The SCALE of what is excluded, and of what still gets modeled — which is
    // the whole reason a count beats a boolean here.
    expect(disclosure).toHaveTextContent(/2 of this feed's trips/i);
    expect(disclosure).toHaveTextContent(/18,148 scheduled trip/i);
    // It is handed over. Nothing on screen may say otherwise.
    expect(disclosure).toHaveTextContent(/The feed is still handed over/i);
    expect(disclosure.textContent ?? "").not.toMatch(/fall back/i);
    expect(disclosure.textContent ?? "").not.toMatch(/refuses/i);
    // And it must not send them to re-ingest: that cannot change the split.
    expect(disclosure).toHaveTextContent(/Re-ingesting will not change the split/i);
  });

  it("says nothing about frequencies for a feed that publishes none", () => {
    renderManager();
    selectEngine("aequilibrae");
    fireEvent.change(screen.getByLabelText(/Transit feed/i), { target: { value: FEED_ID } });

    expect(screen.queryByTestId("managed-run-transit-feed-frequencies")).toBeNull();
  });

  it("discloses an expired schedule without refusing it", () => {
    // Three of four real Sacramento-area feeds measured 2026-08-05 had already
    // expired. Refusing them would refuse most of the country.
    renderManager();
    selectEngine("aequilibrae");
    fireEvent.change(screen.getByLabelText(/Transit feed/i), { target: { value: FEED_ID } });

    expect(screen.getByText(/published schedule runs through 2025-04-05/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Launch run/i })).toHaveProperty("disabled", false);
  });

  it("asks whether the chosen feed serves the study area, and says when it does not", async () => {
    stubFetch({ coverage: "no", reason: null });
    renderManager();
    selectEngine("aequilibrae");
    fireEvent.change(screen.getByLabelText(/Transit feed/i), { target: { value: FEED_ID } });

    await waitFor(() =>
      expect(screen.getByTestId("managed-run-transit-feed-coverage-no")).toBeTruthy()
    );

    const coverageCall = calls.find((call) => call.url.includes("study-area-coverage"));
    expect(coverageCall?.body).toMatchObject({ workspaceId: WORKSPACE_ID, feedId: FEED_ID });
    expect(coverageCall?.body.corridorGeojson).toBeTruthy();

    // A DISCLOSURE, NOT A GATE. The worker's own `feed_covers` compares against
    // the resolved zone system and is the authority; this compares against the
    // envelope. A disagreement is legitimate, so the launch stays available.
    expect(screen.getByRole("button", { name: /Launch run/i })).toHaveProperty("disabled", false);
  });

  it("never turns a failed coverage check into a coverage fact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("study-area-coverage")) {
          return { ok: false, json: async () => ({ error: "Failed to verify workspace membership" }) } as unknown as Response;
        }
        return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
      })
    );

    renderManager();
    selectEngine("aequilibrae");
    fireEvent.change(screen.getByLabelText(/Transit feed/i), { target: { value: FEED_ID } });

    await waitFor(() =>
      expect(screen.getByText(/Failed to verify workspace membership/)).toBeTruthy()
    );
    // "We could not ask" must never render as "this agency does not serve here".
    expect(screen.queryByTestId("managed-run-transit-feed-coverage-no")).toBeNull();
  });

  it("does not ask about coverage when no feed was chosen", async () => {
    renderManager();
    selectEngine("aequilibrae");

    await waitFor(() => expect(screen.getByLabelText(/Transit feed/i)).toBeTruthy());
    expect(calls.some((call) => call.url.includes("study-area-coverage"))).toBe(false);
  });
});
