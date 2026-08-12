/**
 * A LIVE CRASH READ MUST SAY WHICH OF THE YEARS IT ASKED FOR CAME BACK EMPTY.
 *
 * THE DEFECT. The Safety module asks every crash source for a rolling window of
 * recent complete years (`recentCrashYears`). A source is under no obligation to
 * hold all of them — a fatality census publishes its annual file well after the
 * year ends, so the most recent one or two years of a four-year window routinely
 * return nothing. The banner then reports ONE total, summed over the years that
 * answered, and a planner reads it as the whole window. Two years of fatalities
 * presented as four halves the apparent crash burden of a study area, in a
 * document that competes for safety funding.
 *
 * The disclosure that existed could not say this. It fired only when the source
 * reported crashes AND no year carried a mappable record — very nearly
 * unreachable — so the common case went entirely unstated. A branch whose
 * condition almost nothing can satisfy is the defect class this repository has
 * shipped repeatedly, and it is what this file exists to stop recurring.
 *
 * AND IT MUST NOT SAY WHY. Nothing in the adapter contract distinguishes "no
 * crashes were reported", "records came back but none could be mapped", and
 * "this year is not published yet". Copy that picked one would convert an
 * unpublished year into a finding that the roads were safe, which is the exact
 * inversion this module's disclosure discipline exists to prevent.
 *
 * The response driving the render is produced by the REAL
 * `ingestCrashesForStudyArea` against a study area SEARCHED for with the
 * registry's own `covers()` predicates — never a hand-written fixture.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafetyWorkspace, splitLiveReadYears } from "@/components/safety/safety-workspace";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import { recentCrashYears } from "@/lib/safety/crash-years";
import type { CrashRecord } from "@/lib/safety/sources/types";
import { findReadOnlyOnlyStudyArea } from "./helpers/crash-coverage-probe";

vi.mock("@/components/safety/safety-crash-map", () => ({
  SafetyCrashMap: () => <div data-testid="safety-crash-map" />,
}));

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({ onCorridorChange }: { onCorridorChange: (t: string) => void }) => (
    <button
      onClick={() =>
        onCorridorChange(
          JSON.stringify({
            type: "Polygon",
            coordinates: [
              [
                [-97.5, 30.1],
                [-97.0, 30.1],
                [-97.0, 30.6],
                [-97.5, 30.6],
                [-97.5, 30.1],
              ],
            ],
          })
        )
      }
    >
      pick-area
    </button>
  ),
}));

function crashResponse() {
  return {
    ok: true,
    json: async () => ({
      type: "FeatureCollection",
      features: [],
      returnedCount: 0,
      matchedCount: 0,
      truncated: false,
      limit: 2000,
    }),
  } as Response;
}

function record(year: number, id: string): CrashRecord {
  return {
    externalId: id,
    collisionDate: `${year}-04-01`,
    collisionYear: year,
    severity: "fatal",
    killedCount: 1,
    injuredCount: 0,
    pedestrianInvolved: false,
    bicyclistInvolved: false,
    motorcyclistInvolved: false,
    collisionType: "rear_end",
    lighting: "daylight",
    weather: "clear",
    sourceAttributes: {},
    latitude: 30.3,
    longitude: -97.2,
  };
}

/**
 * A real `read_only` result whose source answered for only SOME of the years the
 * module asks for — the arrears case, built through the production lane.
 */
async function partialYearResponse(answeredYears: number[], requested: number[]) {
  const probe = findReadOnlyOnlyStudyArea();
  expect(probe, "no read-only crash source covers anywhere — the lane is unreachable").not.toBeNull();

  const records = answeredYears.map((year, index) => record(year, `case-${index}`));
  const spy = vi.spyOn(probe!.adapter, "fetch").mockResolvedValue({
    records,
    matchedTotal: records.length,
    geocodedTotal: records.length,
    // What the source actually came back with — a strict subset of `requested`.
    yearsCovered: answeredYears,
    truncated: false,
  });

  const service = {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: "i" }, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
      upsert: async () => ({ error: null }),
    }),
  };

  const result = await ingestCrashesForStudyArea({
    service: service as never,
    workspaceId: "ws-1",
    bbox: probe!.bbox,
    years: requested,
  });
  spy.mockRestore();

  expect(result.status, "the lane did not produce a read-only result to render").toBe("read_only");
  return { ok: true, json: async () => result } as Response;
}

function routedFetch(ingestRes: Response) {
  return vi.fn(async (url: unknown, init?: RequestInit) =>
    init?.method === "POST" || String(url).includes("/ingest") ? ingestRes : crashResponse()
  );
}

describe("splitLiveReadYears", () => {
  it("separates the years that answered from the years that did not", () => {
    expect(splitLiveReadYears([2025, 2024, 2023, 2022], [2023, 2022])).toEqual({
      answered: [2023, 2022],
      silent: [2025, 2024],
    });
  });

  it("reports every requested year as silent when nothing came back", () => {
    expect(splitLiveReadYears([2025, 2024], [])).toEqual({ answered: [], silent: [2025, 2024] });
  });

  it("reports no silent years when the source answered for all of them", () => {
    expect(splitLiveReadYears([2025, 2024], [2024, 2025]).silent).toEqual([]);
  });

  it("ignores a year the source returned that was never asked for", () => {
    // A source answering outside the window is the source's business; the
    // disclosure is about the window the planner was shown.
    expect(splitLiveReadYears([2024], [2024, 2019])).toEqual({ answered: [2024], silent: [] });
  });
});

describe("the live-read banner and the years it asked for", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => crashResponse()) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("names the years that came back empty instead of presenting a partial total as the whole window", async () => {
    // The window the module really asks for, from the shared helper — not a
    // typed list, so this cannot drift from what the component posts.
    const requested = recentCrashYears();
    expect(requested.length).toBeGreaterThan(1);
    // The arrears case: the two oldest years answered, the newest did not.
    const answered = requested.slice(1);
    const silent = [requested[0]];

    const response = await partialYearResponse(answered, requested);
    vi.stubGlobal("fetch", routedFetch(response) as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    fireEvent.click(screen.getByText("pick-area"));
    await waitFor(() => expect(screen.getByText(/Retrieve crash data/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Retrieve crash data/i));

    const note = await screen.findByText(/The source returned nothing for/i);

    // It names the silent years…
    for (const year of silent) {
      expect(note).toHaveTextContent(String(year));
    }
    // …says the counts cover only the years that answered…
    expect(note).toHaveTextContent(/counts above cover only/i);
    for (const year of answered) {
      expect(note).toHaveTextContent(String(year));
    }
    // …offers all three reasons rather than choosing one…
    expect(note).toHaveTextContent(/has not published/i);
    expect(note).toHaveTextContent(/none could be mapped/i);
    // …and refuses the finding a silent year would otherwise imply.
    expect(note).toHaveTextContent(/not evidence that no crashes occurred/i);
  });

  it("says nothing about silent years when every requested year answered", async () => {
    const requested = recentCrashYears();
    const response = await partialYearResponse(requested, requested);
    vi.stubGlobal("fetch", routedFetch(response) as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    fireEvent.click(screen.getByText("pick-area"));
    await waitFor(() => expect(screen.getByText(/Retrieve crash data/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Retrieve crash data/i));

    // The live read did render — the disclosure is absent because there is
    // nothing to disclose, not because the branch never ran.
    await waitFor(() => expect(screen.getByText(/Live read — not saved/i)).toBeInTheDocument());
    expect(screen.queryByText(/The source returned nothing for/i)).not.toBeInTheDocument();
  });

  it("discloses a wholly empty window rather than showing a bare zero", async () => {
    // Every year silent and zero crashes. Without this the banner reads
    // "0 reported · 0 mappable" — indistinguishable from a study area whose
    // roads had no fatalities for four years.
    const requested = recentCrashYears();
    const response = await partialYearResponse([], requested);
    vi.stubGlobal("fetch", routedFetch(response) as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    fireEvent.click(screen.getByText("pick-area"));
    await waitFor(() => expect(screen.getByText(/Retrieve crash data/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Retrieve crash data/i));

    const note = await screen.findByText(/No records came back for any year requested/i);
    expect(note).toHaveTextContent(/not evidence that no crashes occurred/i);
  });
});
