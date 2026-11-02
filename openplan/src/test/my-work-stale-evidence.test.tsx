vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { render, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";

import { MyWorkBoard } from "@/components/my-work/my-work-board";

import { groupMyWorkItemsByBlock } from "@/lib/my-work/types";
import { buildDb, idsOf, loadSeededMyWork as load, ROSTER, type Db } from "./helpers/fake-my-work-tables";
import { BASIS_REASON, buildFreshnessDb, FRESH_P1, FRESH_P2, FRESH_P_B } from "./helpers/report-freshness-fixtures";
import {
  MISSING_ARTIFACT,
  mergeDb,
  reseededWithEarlierFinals,
  seedFenceRows,
  SEED_AWARDED_OPPORTUNITY,
  SEED_OPEN_OPPORTUNITY,
  SEED_UNREADABLE_OPPORTUNITY,
} from "./helpers/ss4a-seed-fence-fixtures";

/**
 * Stale evidence in My Work's "Waiting on a person" block: report packets the
 * Reports registry would ask to refresh, and seeded SS4A applications whose
 * Safety evidence moved past its fence or cannot be checked. Built on the
 * same rows as the loader tests, read through the real `loadMyWork`.
 */

const WS = "aaaaaaaa-0000-4000-8000-000000000001";

function withStaleEvidence(edit?: (db: Db) => void): Db {
  const base = buildDb();
  const freshness = buildFreshnessDb();
  // The freshness projects carry the jurisdiction columns the registry rule reads.
  base.projects = base.projects.filter((project) => ![FRESH_P1, FRESH_P2, FRESH_P_B].includes(String(project.id)));
  const seeds = seedFenceRows(WS);
  seeds.safety_crash_ingests[0].evidence_revision = 8;
  seeds.funding_opportunities.push({ id: SEED_UNREADABLE_OPPORTUNITY, workspace_id: WS, project_id: null, title: "SS4A seed with a removed artifact", opportunity_status: "open" });
  seeds.funding_opportunity_safety_seeds.push({ id: "seed-unreadable", workspace_id: WS, opportunity_id: SEED_UNREADABLE_OPPORTUNITY, artifact_id: MISSING_ARTIFACT, created_at: "2026-10-18T09:00:00+00:00" });
  const db = mergeDb(base, freshness, seeds);
  edit?.(db);
  return db;
}

describe("My Work stale evidence", () => {
  it("lists the packets the registry would refresh, newest change first", async () => {
    const { result } = await load({ db: withStaleEvidence() });
    const packets = result.items.filter((item) => item.sourceId === "stale_report_packets");

    // Not the current packet, the never-generated one, the archived one or another workspace's.
    expect(idsOf(packets)).toEqual(["r-edited", "r-crash", "r-basis"]);
    expect(packets.every((item) => item.block === "needs_review")).toBe(true);
    expect(packets[0]).toMatchObject({
      title: "Edited corridor packet",
      projectId: FRESH_P1,
      projectName: "Main Street corridor",
      badge: { label: "Refresh recommended", tone: "warning" },
      href: "/reports/r-edited#drift-since-generation",
      isOverdue: false,
      dueOn: null,
    });
    expect(packets[2].detail).toBe(BASIS_REASON);
    expect(result.perSource.stale_report_packets).toEqual({ count: 3, pending: false, failed: false });
  });

  it("lists seeds whose Safety evidence changed or cannot be checked, not awarded ones", async () => {
    const { result } = await load({ db: withStaleEvidence() });
    const seeds = result.items.filter((item) => item.sourceId === "stale_ss4a_seeds");

    expect(idsOf(seeds)).toEqual([SEED_OPEN_OPPORTUNITY, SEED_UNREADABLE_OPPORTUNITY]);
    expect(idsOf(seeds)).not.toContain(SEED_AWARDED_OPPORTUNITY);
    expect(seeds[0]).toMatchObject({
      title: "SS4A planning grant",
      badge: { label: "Safety evidence changed", tone: "warning" },
      href: `/grants?focusOpportunityId=${SEED_OPEN_OPPORTUNITY}#funding-opportunity-${SEED_OPEN_OPPORTUNITY}`,
    });
    expect(seeds[0].detail).toContain("The crash records behind the seeded Safety report changed");
    expect(seeds[0].detail).toContain("Regenerate the Safety report, then seed again");
    expect(seeds[1]).toMatchObject({ badge: { label: "Safety evidence not checked", tone: "neutral" } });
    expect(seeds[1].detail).toBe("The seeded Safety report artifact could not be read.");
  });

  it("lists nothing for a seed whose evidence still matches", async () => {
    const { result } = await load({ db: withStaleEvidence((db) => {
      const ingest = db.safety_crash_ingests.find((row) => row.evidence_revision === 8)!;
      ingest.evidence_revision = 7;
    }) });
    expect(idsOf(result.items.filter((item) => item.sourceId === "stale_ss4a_seeds"))).toEqual([SEED_UNREADABLE_OPPORTUNITY]);
  });

  it("keeps a re-seeded application listed while final sections still come from the stale earlier seed", async () => {
    const { result } = await load({ db: mergeDb(buildDb(), reseededWithEarlierFinals(WS)) });
    const [seed] = result.items.filter((item) => item.sourceId === "stale_ss4a_seeds");
    expect(seed).toMatchObject({ id: SEED_OPEN_OPPORTUNITY, badge: { label: "Safety evidence changed", tone: "warning" } });
    expect(seed.detail).toBe(
      "Project overview and Budget narrative are still final from an earlier Safety seed. " +
      "The crash records behind the seeded Safety report changed after it was generated. " +
      "Finalize those sections again from a current seed's drafts."
    );
  });

  it("caps each source and still reports how many matched", async () => {
    const { result } = await load({ db: withStaleEvidence(), limitPerSource: 1 });
    expect(idsOf(result.items.filter((item) => item.sourceId === "stale_report_packets"))).toEqual(["r-edited"]);
    expect(result.rowsRead.stale_report_packets).toBe(3);
    expect(result.rowsRead.stale_ss4a_seeds).toBe(2);
  });

  it("discloses a failed read by name instead of an empty list", async () => {
    const { result } = await load({ db: withStaleEvidence(), failures: { reports: "permission denied for table reports" } });

    expect(result.perSource.stale_report_packets).toEqual({ count: 0, pending: false, failed: true });
    expect(result.reads.all).toContainEqual({ label: "report packets", message: "permission denied for table reports" });
    expect(result.reads.describe()).toContain("report packets");
    // The other source still answers.
    expect(result.perSource.stale_ss4a_seeds?.failed).toBe(false);
  });

  it("discloses unreadable crash evidence while keeping packets already known to be stale", async () => {
    const { result } = await load({ db: withStaleEvidence(), failures: { safety_crash_ingests: "permission denied for table safety_crash_ingests" } });

    expect(result.perSource.stale_report_packets?.failed).toBe(true);
    expect(result.reads.all.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(["project crash evidence used for packet freshness", "crash acquisitions cited by SS4A seeds"])
    );
    const packets = idsOf(result.items.filter((item) => item.sourceId === "stale_report_packets"));
    expect(packets).toEqual(expect.arrayContaining(["r-edited", "r-basis"]));
    // The crash-only change cannot be seen without the read; it is not listed as current either.
    expect(packets).not.toContain("r-crash");
    expect(groupMyWorkItemsByBlock(result.items).needs_review.length).toBeGreaterThan(0);
  });

  it("shows each item with its link, and names an unreadable lane on the board", async () => {
    const { result } = await load({ db: withStaleEvidence(), failures: { funding_opportunity_safety_seeds: "permission denied" } });
    const view = render(
      <MyWorkBoard scope={result.scope} items={result.items} perSource={result.perSource} limitPerSource={result.limitPerSource}
        readFailureSummary={result.reads.describe()} roster={ROSTER} departedIncludedInUnassigned isViewer={false} timeZone="UTC" />
    );
    const waiting = within(view.getByTestId("my-work-needs-review"));
    expect(waiting.getByRole("link", { name: /Edited corridor packet/ }).getAttribute("href")).toBe("/reports/r-edited#drift-since-generation");
    expect(waiting.getByTestId("my-work-needs-review-unreadable").textContent).toContain("seeded SS4A applications could not be read");
    expect(waiting.queryByText("SS4A planning grant")).toBeNull();
  });
});
