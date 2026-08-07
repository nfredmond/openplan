import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CensusTractCoverageControl } from "@/components/geographies/census-tract-coverage-control";
import {
  DRAWN_PLACE_SOURCE,
  EMPTY_PLACE_OF_RECORD,
  type PlaceOfRecord,
} from "@/lib/geographies/place-of-record";

const FRANKLIN: PlaceOfRecord = {
  ...EMPTY_PLACE_OF_RECORD,
  source: "tigerweb",
  kind: "county",
  ref: "39049",
  label: "Franklin County, OH",
  countryCode: "US",
};

type Handler = (url: string, init?: RequestInit) => { ok: boolean; status: number; body: unknown };

function mockFetch(handler: Handler) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const result = handler(url, init);
      return {
        ok: result.ok,
        status: result.status,
        json: async () => result.body,
      } as Response;
    })
  );
  return calls;
}

/**
 * The control that makes the equity layer fillable.
 *
 * Two behaviours carry all the honesty here, and both are asserted below: every
 * count shown is RE-READ from the database rather than echoed from the ingest
 * response (which reports a partial number when an upsert fails midway), and a
 * FAILED load still re-checks, because the 60-second cut-off is an expected
 * outcome after which some tracts really are stored.
 */
describe("CensusTractCoverageControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues no request at all for a place with no derivable county", async () => {
    // Asking the server about a county we could not derive would be a request
    // with no county in it.
    const calls = mockFetch(() => ({ ok: true, status: 200, body: { tractCount: 0 } }));

    render(
      <CensusTractCoverageControl
        place={{ ...EMPTY_PLACE_OF_RECORD, source: DRAWN_PLACE_SOURCE, label: "Drawn corridor" }}
        origin="project_study_area"
        affectsWorkspaceLayer={false}
      />
    );

    expect(await screen.findByText(/will not guess which county contains a drawn shape/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("reports the stored count from the database, not the ingest response", async () => {
    // The ingest says it upserted 328. The re-check says 12 are stored. 12 is
    // the true answer, and echoing 328 would assert a load that did not finish.
    let coverageCalls = 0;
    const calls = mockFetch((url) => {
      if (url.includes("/coverage")) {
        coverageCalls += 1;
        return { ok: true, status: 200, body: { tractCount: coverageCalls === 1 ? 0 : 12 } };
      }
      return {
        ok: true,
        status: 200,
        body: {
          results: [
            { stateFips: "39", countyFips: "049", status: "ingested", tractsUpserted: 328, unmatched: 0, error: null },
          ],
        },
      };
    });

    render(
      <CensusTractCoverageControl place={FRANKLIN} origin="workspace_home_geography" affectsWorkspaceLayer />
    );

    fireEvent.click(await screen.findByRole("button", { name: /load census tracts/i }));

    await waitFor(() => expect(screen.getByText(/12 census tracts are stored/i)).toBeInTheDocument());
    expect(screen.queryByText(/328 census tracts are stored/i)).not.toBeInTheDocument();

    // One check on mount, one POST, one re-check after it.
    expect(calls.filter((call) => call.url.includes("/coverage"))).toHaveLength(2);
    expect(calls.filter((call) => call.url.includes("/ingest"))).toHaveLength(1);
  });

  it("posts the derived county, and only that county", async () => {
    const calls = mockFetch((url) =>
      url.includes("/coverage")
        ? { ok: true, status: 200, body: { tractCount: 0 } }
        : { ok: true, status: 200, body: { results: [] } }
    );

    render(
      <CensusTractCoverageControl place={FRANKLIN} origin="workspace_home_geography" affectsWorkspaceLayer />
    );
    fireEvent.click(await screen.findByRole("button", { name: /load census tracts/i }));

    await waitFor(() => expect(calls.some((call) => call.url.includes("/ingest"))).toBe(true));
    const ingest = calls.find((call) => call.url.includes("/ingest"));
    expect(JSON.parse(String(ingest?.init?.body))).toEqual({
      counties: [{ stateFips: "39", countyFips: "049" }],
    });
  });

  it("still re-reads coverage when the load fails, and says what is stored", async () => {
    const calls = mockFetch((url) =>
      url.includes("/coverage")
        ? { ok: true, status: 200, body: { tractCount: 41 } }
        : { ok: false, status: 504, body: { error: "Gateway timeout" } }
    );

    render(
      <CensusTractCoverageControl place={FRANKLIN} origin="workspace_home_geography" affectsWorkspaceLayer />
    );
    fireEvent.click(await screen.findByRole("button", { name: /reload from the census bureau/i }));

    await waitFor(() => expect(screen.getByText(/cut off/i)).toBeInTheDocument());
    expect(screen.getByText(/41 census tracts are stored/i)).toBeInTheDocument();
    expect(screen.getByText(/may be a partial load/i)).toBeInTheDocument();
    expect(calls.filter((call) => call.url.includes("/coverage"))).toHaveLength(2);
  });

  it("names the Census-key remedy when demographics did not join", async () => {
    mockFetch((url) =>
      url.includes("/coverage")
        ? { ok: true, status: 200, body: { tractCount: 0 } }
        : {
            ok: true,
            status: 200,
            body: {
              results: [
                {
                  stateFips: "39",
                  countyFips: "049",
                  status: "no_demographics",
                  tractsUpserted: 0,
                  unmatched: 0,
                  error: null,
                },
              ],
            },
          }
    );

    render(
      <CensusTractCoverageControl place={FRANKLIN} origin="workspace_home_geography" affectsWorkspaceLayer />
    );
    fireEvent.click(await screen.findByRole("button", { name: /load census tracts/i }));

    await waitFor(() => expect(screen.getByText(/Integration keys/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Loaded /)).not.toBeInTheDocument();
  });

  it("tells a project mount that loading will not change this workspace's map", async () => {
    mockFetch(() => ({ ok: true, status: 200, body: { tractCount: 7 } }));

    render(
      <CensusTractCoverageControl place={FRANKLIN} origin="project_study_area" affectsWorkspaceLayer={false} />
    );

    expect(
      await screen.findByText(/not this workspace's home geography/i)
    ).toBeInTheDocument();
  });

  it("offers the reload as a repair when tracts carry no ACS universe", async () => {
    // The refusal a planner meets is on the Title VI panel and on the map:
    // "no poverty rate for these tracts". This control is the only place that
    // can fix it, so it has to say so and the button has to name the repair.
    mockFetch(() => ({ ok: true, status: 200, body: { tractCount: 328, staleTractCount: 41 } }));

    render(
      <CensusTractCoverageControl place={FRANKLIN} origin="workspace_home_geography" affectsWorkspaceLayer />
    );

    expect(await screen.findByText(/41 of them were loaded before/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /reload to measure these tracts/i })
    ).toBeInTheDocument();
  });

  it("stays quiet about universes when the deployment does not report them", async () => {
    // An older deployment answers the coverage read without the field at all,
    // and this control must not invent a claim from its absence.
    //
    // WHAT THIS DOES NOT PROVE, stated because a mutation showed it: replacing
    // the `null` this parses into with `0` leaves the test green, since the
    // control renders nothing for either. Whether the count is UNKNOWN or ZERO
    // is a distinction only the route can express, and it is asserted there —
    // `census-tract-coverage-route.test.ts`, "reports the stale count as
    // unknown when that read fails". What is proved here is narrower and still
    // worth having: an absent field produces no sentence and no repair button.
    mockFetch(() => ({ ok: true, status: 200, body: { tractCount: 328 } }));

    render(
      <CensusTractCoverageControl place={FRANKLIN} origin="workspace_home_geography" affectsWorkspaceLayer />
    );

    await screen.findByRole("button", { name: /reload from the census bureau/i });
    expect(screen.queryByText(/loaded before OpenPlan recorded/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reload to measure these tracts/i })
    ).not.toBeInTheDocument();
  });

  it("does not report zero when the coverage check itself failed", async () => {
    mockFetch(() => ({ ok: false, status: 500, body: { error: "boom" } }));

    render(
      <CensusTractCoverageControl place={FRANKLIN} origin="workspace_home_geography" affectsWorkspaceLayer />
    );

    expect(
      await screen.findByText(/says nothing about whether tracts are loaded/i)
    ).toBeInTheDocument();
  });
});
