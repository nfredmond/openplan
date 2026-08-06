/**
 * WHAT THE EVIDENCE PANEL SAYS ABOUT THE FEED A RUN MODELED TRANSIT FROM.
 *
 * TWO RECORDS, NEVER MERGED. `input_snapshot_json.transitFeed` is what OpenPlan
 * ASKED FOR at launch; `mode_split.transit_los` is what the worker DID. On a
 * healthy run they agree and merging them would look tidy. On the runs that
 * matter — a selection the worker refused, a queued run nothing picked up —
 * only one of the two exists, and a merged view would present a request as an
 * outcome. That is the whole reason this panel reads them separately, and the
 * reason it is worth a test.
 *
 * THE OTHER PROPERTY PINNED HERE IS ABOUT ABSENCE. A worker that predates this
 * handoff writes none of the new keys, and a missing boolean must render as
 * "not recorded" rather than as `false` — because `false` is a positive claim
 * (the schedule had not expired; no operator feed was displaced), and it would
 * be a claim made by a worker that said nothing.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunEvidencePanel } from "@/components/models/model-run-evidence-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";
const CHECKSUM = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

function packet(overrides: {
  transitLos?: Record<string, unknown>;
  transitFeedStamp?: Record<string, unknown> | undefined;
  transitStatus?: string;
}) {
  return {
    engine: "aequilibrae",
    mode_split: {
      transit_status: overrides.transitStatus ?? "modeled",
      transit_los: overrides.transitLos ?? {},
    },
    provenance: { engine_version: "aeq-1.6.2" },
    inputs: {
      zone_count: 42,
      input_snapshot: overrides.transitFeedStamp ? { transitFeed: overrides.transitFeedStamp } : {},
    },
    assumptions: { corridor_geojson_hash: "abcdef1234567890ffff" },
    caveats: [],
  };
}

async function openPanelWith(body: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
  render(
    <ModelRunEvidencePanel
      modelId={MODEL_ID}
      modelRunId={MODEL_RUN_ID}
      runTitle="Screening run"
      runStatus="succeeded"
      engineKey="aequilibrae"
      comparisonCandidates={[]}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /inspect evidence/i }));
  await waitFor(() => expect(screen.getByTestId("evidence-transit-provenance")).toBeInTheDocument());
}

afterEach(() => vi.unstubAllGlobals());

describe("the feed a run was launched with, beside the feed the worker read", () => {
  it("names the workspace feed chosen at launch, and that the choice was the planner's", async () => {
    await openPanelWith(
      packet({
        transitFeedStamp: {
          status: "selected",
          agencyName: "Sacramento Regional Transit",
          feedVersionId: "v1",
        },
        transitLos: { feed_origin: "workspace_feed_version", feed_checksum_sha256: CHECKSUM },
      })
    );

    const selection = screen.getByTestId("evidence-transit-selection");
    expect(selection).toHaveTextContent(/handed to the modeling worker/i);
    expect(selection).toHaveTextContent("Sacramento Regional Transit");
    // The origin label must never read as a discovery hit — this feed came from
    // a person, and it outranked the deployment's own configuration.
    expect(screen.getByTestId("evidence-transit-provenance")).toHaveTextContent(
      /Chosen for this run from this workspace's own ingested feeds/i
    );
  });

  it("shows the checksum the worker VERIFIED, not the one the launch requested", async () => {
    // The proof that "the model ran on the feed on that card" is checkable
    // rather than assured. It comes from the worker's echo; a stamp value would
    // be a claim about the worker's behaviour authored by whoever could edit
    // the member-writable snapshot.
    await openPanelWith(
      packet({
        transitFeedStamp: { status: "selected", checksumSha256: "ffff-from-the-snapshot" },
        transitLos: { feed_origin: "workspace_feed_version", feed_checksum_sha256: CHECKSUM },
      })
    );

    const shown = screen.getByTestId("evidence-transit-checksum");
    expect(shown).toHaveTextContent("abcdef012345");
    expect(shown).not.toHaveTextContent("from-the-snapshot");
  });

  it("still reads a run stamped by a build that refused frequency-based feeds", async () => {
    // `unsupported_by_skim` IS NO LONGER PRODUCED — the app stopped refusing a
    // feed over a frequencies.txt row on 2026-08-06, because that rule cost an
    // 18,150-trip agency its entire feed over four rows. Runs launched before
    // then still carry the stamp, so the panel must still render one, and the
    // label must date the rule rather than describe it as current behaviour.
    await openPanelWith(
      packet({
        transitStatus: "feed_unavailable",
        transitFeedStamp: {
          status: "unsupported_by_skim",
          agencyName: "Headway Publishing Agency",
          reason: "This feed describes some of its service with frequencies.txt…",
        },
        transitLos: { feed_origin: "none", no_feed_reason: "selected_feed_uses_frequencies" },
      })
    );

    const selection = screen.getByTestId("evidence-transit-selection");
    expect(selection).toHaveTextContent(/before 2026-08-06/i);
    expect(selection).toHaveTextContent(/frequencies\.txt/);

    // And the worker's own reason gets a sentence a planner can act on, rather
    // than the raw enum value. It now describes the case the worker ACTUALLY
    // refuses — every trip on the modeled day published as a headway band.
    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent(/Every trip on the modeled service day/i);
    expect(block).toHaveTextContent(/Re-ingesting will not change it/i);
    expect(block).not.toHaveTextContent("selected_feed_uses_frequencies");
  });

  it("gives a version-skew refusal an operator instruction, not a feed instruction", async () => {
    // `selected_feed_stamp_version_unsupported` had NO LABEL, so it fell through
    // to the generic sentence — which asserted that no feed covered the study
    // area. The actual fact is that the worker is older than the app and refused
    // to guess which feed was meant; the fix belongs to whoever operates the
    // deployment, and no claim whatever was established about the area.
    await openPanelWith(
      packet({
        transitStatus: "feed_unavailable",
        transitLos: {
          feed_origin: "workspace_feed_version",
          no_feed_reason: "selected_feed_stamp_version_unsupported",
        },
      })
    );

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent(/upgrade the worker/i);
    expect(block).not.toHaveTextContent(/No GTFS feed was applied to this study area/i);
    expect(block).not.toHaveTextContent("selected_feed_stamp_version_unsupported");
  });

  it("does not silently fall back — a checksum mismatch says what it means", async () => {
    await openPanelWith(
      packet({
        transitStatus: "feed_unavailable",
        transitLos: { feed_origin: "none", no_feed_reason: "selected_feed_checksum_mismatch" },
      })
    );

    expect(screen.getByTestId("evidence-transit-provenance")).toHaveTextContent(
      /did not match the checksum OpenPlan recorded/i
    );
  });

  it("discloses an expired schedule at launch AND at skim time, as two separate facts", async () => {
    // They are minutes apart and a schedule can expire between them.
    await openPanelWith(
      packet({
        transitFeedStamp: {
          status: "selected",
          scheduleExpiredAtLaunch: true,
          serviceEndDate: "2025-04-05",
        },
        transitLos: {
          feed_origin: "workspace_feed_version",
          feed_schedule_expired: true,
          feed_expiry_evaluated_at: "2026-08-06T14:00:00.000Z",
        },
      })
    );

    expect(screen.getByTestId("evidence-transit-schedule-expired")).toHaveTextContent("2025-04-05");
    expect(screen.getByTestId("evidence-transit-worker-schedule-expired")).toHaveTextContent(
      /the service modeled here is that schedule/i
    );
  });

  it("affirms a schedule the worker checked and found current", async () => {
    await openPanelWith(
      packet({
        transitFeedStamp: { status: "selected" },
        transitLos: {
          feed_origin: "workspace_feed_version",
          feed_schedule_expired: false,
          feed_expiry_evaluated_at: "2026-08-06T14:00:00.000Z",
        },
      })
    );

    expect(screen.getByTestId("evidence-transit-worker-schedule-current")).toBeTruthy();
    expect(screen.queryByTestId("evidence-transit-worker-schedule-expired")).toBeNull();
  });

  it("says when a per-run choice displaced the deployment's own feed", async () => {
    // A reversal of the worker's documented precedence. Whoever set
    // GTFS_URL/GTFS_PATH has a right to know a run did not use it.
    await openPanelWith(
      packet({
        transitFeedStamp: { status: "selected" },
        transitLos: { feed_origin: "workspace_feed_version", operator_env_overridden: true },
      })
    );

    expect(screen.getByTestId("evidence-transit-operator-override")).toHaveTextContent(
      /outranks a default set for every run/i
    );
  });

  it("treats a worker that said nothing as silence, never as a denial", async () => {
    // THE ABSENCE CASE. A worker predating this handoff writes none of these
    // keys. Rendering the expiry notice, or the override notice, on that run
    // would be a claim made by nobody.
    await openPanelWith(
      packet({
        transitFeedStamp: { status: "not_selected", reason: "No transit feed from this workspace…" },
        transitLos: { feed_origin: "discovered_catalog" },
      })
    );

    expect(screen.queryByTestId("evidence-transit-worker-schedule-expired")).toBeNull();
    // AND NOT THE OPPOSITE EITHER. This is what makes the null/false
    // distinction observable rather than merely intended: a worker that said
    // nothing must not be quoted as having checked and found the schedule
    // current. Reading a missing key as `false` would print exactly that.
    expect(screen.queryByTestId("evidence-transit-worker-schedule-current")).toBeNull();
    expect(screen.queryByTestId("evidence-transit-operator-override")).toBeNull();
    expect(screen.queryByTestId("evidence-transit-checksum")).toBeNull();
    // The launch record still says what was asked, which is the point of
    // recording `not_selected` at all rather than leaving the key off.
    expect(screen.getByTestId("evidence-transit-selection")).toHaveTextContent(
      /the worker chose one itself/i
    );
  });

  it("shows nothing about a selection for a run launched before the stamp existed", async () => {
    await openPanelWith(packet({ transitLos: { feed_origin: "discovered_catalog" } }));

    expect(screen.queryByTestId("evidence-transit-selection")).toBeNull();
    // …while the worker's own provenance still renders, exactly as before.
    expect(screen.getByTestId("evidence-transit-provenance")).toHaveTextContent(
      /Discovered for this study area/i
    );
  });
});
