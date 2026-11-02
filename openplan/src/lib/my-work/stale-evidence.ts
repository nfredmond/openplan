/**
 * MY WORK's stale-evidence sources: report packets whose sources moved after
 * generation, and SS4A applications whose seeded Safety evidence no longer
 * matches its fence.
 *
 * Neither fits a one-table descriptor in `sources.ts`. Staleness is computed
 * from a report, its latest artifact, its project and the project's crash
 * acquisitions, so each source calls its shared loader and turns the answer
 * into items. The packet rule is the Reports registry's own
 * (`loadReportPacketFreshness`, rule `registry`), so My Work cannot disagree
 * with the page it links to. Both loaders read through the caller's client
 * and report each failed read by name.
 *
 * Unassessed packets are not listed: every packet generated before the
 * jurisdiction fingerprint, and every guided comparison, is unassessed by
 * design, and the Reports page already shows those labels. Unassessed seeds
 * are listed, because no other page says a seed could not be checked.
 */

import { loadSs4aSeedFenceStanding } from "@/lib/grants/ss4a-seed-fence-standing";
import { getReportNavigationHref } from "@/lib/reports/catalog";
import { loadReportPacketFreshness } from "@/lib/reports/packet-freshness-loader";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";

import { PURSUIT_ENDED_OPPORTUNITY_STATUSES } from "./sources";
import type { MyWorkBlockId, MyWorkItem, MyWorkSourceId } from "./types";

type MyWorkLoaderReadFailure = { label: string; message: string; pending: boolean };

export type MyWorkLoaderOutcome = {
  items: MyWorkItem[];
  /** Matching records before the per-source cap, so a caller can say the list was cut. */
  rowsRead: number;
  failures: MyWorkLoaderReadFailure[];
};

export type MyWorkLoaderSource = {
  id: MyWorkSourceId;
  label: string;
  readLabel: string;
  block: MyWorkBlockId;
  load: (supabase: unknown, context: { workspaceId: string; limitPerSource: number }) => Promise<MyWorkLoaderOutcome>;
};

/** A report status that takes it out of circulation (20260314000018). */
const ARCHIVED_REPORT_STATUS = "archived";

const staleReportPacketsSource: MyWorkLoaderSource = {
  id: "stale_report_packets",
  label: "Report packets to refresh",
  readLabel: "report packets",
  block: "needs_review",
  load: async (supabase, { workspaceId, limitPerSource }) => {
    const load = await loadReportPacketFreshness(supabase, { workspaceId, rule: "registry" });
    const stale = load.entries
      .filter((entry) => entry.standing.state === "stale" && entry.status !== ARCHIVED_REPORT_STATUS)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return {
      rowsRead: stale.length,
      failures: load.failures,
      items: stale.slice(0, limitPerSource).map((entry) => ({
        sourceId: "stale_report_packets",
        block: "needs_review",
        id: entry.reportId,
        title: entry.title,
        projectId: entry.projectId,
        projectName: entry.projectName,
        dueOn: null,
        isOverdue: false,
        ownerLabel: null,
        badge: { label: PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED, tone: "warning" },
        detail: entry.standing.state === "stale" ? entry.standing.reasons.join(" ") : null,
        // The report's change review, where the packet is generated again.
        href: getReportNavigationHref(entry.reportId, PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED),
        dedupKey: null,
      } satisfies MyWorkItem)),
    };
  },
};

const staleSs4aSeedsSource: MyWorkLoaderSource = {
  id: "stale_ss4a_seeds",
  label: "Seeded SS4A applications",
  readLabel: "seeded SS4A applications",
  block: "needs_review",
  load: async (supabase, { workspaceId, limitPerSource }) => {
    const load = await loadSs4aSeedFenceStanding(supabase, { workspaceId });
    const listed = load.entries
      .filter((entry) => entry.standing.state !== "current" &&
        !PURSUIT_ENDED_OPPORTUNITY_STATUSES.includes(entry.opportunityStatus ?? ""))
      // Changed evidence first, then the newest seed.
      .sort((left, right) =>
        Number(right.standing.state === "stale") - Number(left.standing.state === "stale") ||
        Date.parse(right.seededAt ?? "") - Date.parse(left.seededAt ?? ""));
    return {
      rowsRead: listed.length,
      failures: load.failures,
      items: listed.slice(0, limitPerSource).map((entry) => {
        const stale = entry.standing.state === "stale";
        const reasons = entry.standing.state === "current" ? [] : entry.standing.reasons;
        return {
          sourceId: "stale_ss4a_seeds",
          block: "needs_review",
          id: entry.opportunityId,
          title: entry.title,
          projectId: entry.projectId,
          projectName: null,
          dueOn: null,
          isOverdue: false,
          ownerLabel: null,
          badge: stale
            ? { label: "Safety evidence changed", tone: "warning" }
            : { label: "Safety evidence not checked", tone: "neutral" },
          detail: [
            ...reasons,
            ...(entry.latestSeedState === "stale" ? ["Regenerate the Safety report, then seed again from its new artifact."] : []),
            // Seeding again keeps final text, so a final section from a stale seed needs finalizing again.
            ...(entry.staleFinalSections.length > 0 ? ["Finalize those sections again from a current seed's drafts."] : []),
          ].join(" "),
          // The application card, where the seed is previewed and applied again.
          href: `/grants?focusOpportunityId=${entry.opportunityId}#funding-opportunity-${entry.opportunityId}`,
          dedupKey: null,
        } satisfies MyWorkItem;
      }),
    };
  },
};

/** Sources read through a shared loader instead of one table. They have no due dates. */
export const MY_WORK_LOADER_SOURCES: readonly MyWorkLoaderSource[] = [
  staleReportPacketsSource,
  staleSs4aSeedsSource,
];
