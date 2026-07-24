import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  HOME_GEOGRAPHY_COLUMNS,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";
import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import type { SafetyIngestSummary } from "@/lib/safety/client-types";

export const metadata = {
  title: "Safety · OpenPlan",
};

export default async function SafetyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
  if (!membership) {
    return (
      <section className="module-page">
        <div className="module-intro-card">
          <h1 className="module-section-title">Workspace access required</h1>
          <p className="module-note">
            You need to belong to a workspace to review its crash data — reported collisions
            retrieved from the source agency, mapped for screening-level safety analysis.
          </p>
          <div className="module-inline-list">
            <Link className="module-inline-item" href="/projects">
              Projects
            </Link>
            <Link className="module-inline-item" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const workspaceId = membership.workspace_id;

  // The workspace's stated home geography pre-fills the study area, so an
  // agency does not re-pick its own county on every visit. Read here rather
  // than in the client component so no map surface fetches geography ad hoc.
  // A missing column (migration not applied) yields an error and no row, which
  // parses to `null` — the un-prefilled behavior, not a guessed place.
  const { data: workspaceRow } = await supabase
    .from("workspaces")
    .select(HOME_GEOGRAPHY_COLUMNS)
    .eq("id", workspaceId)
    .maybeSingle();
  const homeGeography = parseWorkspaceHomeGeography(workspaceRow);

  // The most recent ingest drives the coverage banner. A missing table (schema
  // not applied yet) is treated the same as "nothing retrieved" rather than
  // failing the page.
  const { data: ingestRow } = await supabase
    .from("safety_crash_ingests")
    .select(
      "id,source_label,attribution,coverage_state,severity_completeness,status,crash_count,geocoded_count,truncated,years_requested,fetch_error,created_at"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestIngest: SafetyIngestSummary | null = ingestRow
    ? {
        id: ingestRow.id as string,
        sourceLabel: (ingestRow.source_label as string | null) ?? null,
        attribution: (ingestRow.attribution as string | null) ?? null,
        coverageState: ingestRow.coverage_state as string,
        severityCompleteness: ingestRow.severity_completeness as string,
        status: ingestRow.status as string,
        crashCount: Number(ingestRow.crash_count ?? 0),
        geocodedCount: Number(ingestRow.geocoded_count ?? 0),
        truncated: Boolean(ingestRow.truncated),
        yearsRequested: (ingestRow.years_requested as number[] | null) ?? [],
        fetchError: (ingestRow.fetch_error as string | null) ?? null,
        createdAt: ingestRow.created_at as string,
      }
    : null;

  return (
    <section className="module-page">
      <SafetyWorkspace
        workspaceId={workspaceId}
        latestIngest={latestIngest}
        homeGeography={homeGeography}
      />
    </section>
  );
}
