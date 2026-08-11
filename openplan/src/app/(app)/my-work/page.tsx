import { redirect } from "next/navigation";

import { MyWorkBoard } from "@/components/my-work/my-work-board";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { loadMyWork } from "@/lib/my-work/query";
import { normalizeMyWorkScope } from "@/lib/my-work/types";
import { loadProjectAssigneeRoster } from "@/lib/projects/assignee-roster";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { moduleMetadata } from "@/lib/ui/page-title";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

export const metadata = moduleMetadata("My Work");

/**
 * /my-work — one queue for everything a planner is on the hook for.
 *
 * TWO CLIENTS, TWO JOBS, AND THE SPLIT IS THE POINT.
 *
 * The QUEUE is read with the caller's RLS client. Four of its eight sources
 * (deliverables, milestones, submittals, issues) have no workspace_id of their
 * own — they are scoped through `projects` — so a service-role read of them
 * would be a cross-tenant leak with nothing behind it. `loadMyWork` contains no
 * service-role client at all and a test greps for that.
 *
 * The ROSTER is read with the service role, because it cannot be read any other
 * way: `workspace_members`' only SELECT policy is `members_read_own`, so an RLS
 * roster read returns exactly one row — the caller — and a page built on that
 * would render every teammate's assignment as "departed". `loadWorkspaceRoster`
 * does its own caller-membership check before it reads anything, which is where
 * the authorization the service role bypasses is put back.
 *
 * ONE DISCLOSURE, NOT TWO. The roster read and the queue reads keep separate
 * failure logs (different modules, different lifetimes), so the queue's are
 * replayed into the page's log before it is described — a reader gets one
 * sentence naming everything this page could not read, rather than two that
 * each look like the whole story.
 */
export default async function MyWorkPage({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string | string[] }>;
}) {
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
      <WorkspaceMembershipRequired
        moduleLabel="My work"
        title="My work needs a workspace"
        description="This page lists the deliverables, milestones, submittals and deadlines of a workspace's projects. You are signed in, but this account is not in a workspace yet — a workspace is normally created for you when you sign up. Reload your workspace, or ask an owner/admin to add you to the correct one."
        primaryHref="/dashboard"
        primaryLabel="Go to your workspace"
      />
    );
  }

  const workspaceId = membership.workspace_id;
  const scope = normalizeMyWorkScope((await searchParams)?.scope);

  const reads = new ReadFailureLog();
  const roster = await loadProjectAssigneeRoster(
    createServiceRoleClient(),
    user.id,
    workspaceId,
    reads
  );

  const work = await loadMyWork(supabase, {
    workspaceId,
    userId: user.id,
    scope,
    roster,
  });

  // See the header: one sentence, not two. `ReadFailureLog` has no merge, and
  // replaying is honest — the labels and messages are the queue's own.
  for (const failure of work.reads.all) {
    reads.check(failure.label, { error: { message: failure.message } });
  }

  return (
    <MyWorkBoard
      scope={work.scope}
      items={work.items}
      perSource={work.perSource}
      limitPerSource={work.limitPerSource}
      readFailureSummary={reads.describe()}
      roster={roster}
      departedIncludedInUnassigned={work.departedIncludedInUnassigned}
      isViewer={membership.role === "viewer"}
    />
  );
}
