import Link from "next/link";
import { RunHistory } from "@/components/runs/RunHistory";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", user!.id)
    .limit(1);

  const membership = memberships?.[0] as
    | { workspace_id: string; role: string; workspaces: { name: string } | null }
    | undefined;

  const workspaceName = membership?.workspaces?.name ?? "Your workspace";
  const workspaceRole = membership?.role ?? "member";
  const workspaceId = membership?.workspace_id ?? "";
  const workspaceIdSnippet = workspaceId ? workspaceId.slice(0, 8) : "unavailable";

  const actions = [
    {
      href: "/explore",
      title: "Open analysis workspace",
      description:
        "Start corridor analysis and validate the core query-to-results flow.",
    },
    {
      href: "/sign-up",
      title: "Invite/test another account",
      description:
        "Validate workspace bootstrap trigger and member assignment behavior.",
    },
  ];

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Workspace
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{workspaceName}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Signed in as {user?.email}. Sprint 0 focus is auth, route protection, and
          the first end-to-end analysis flow.
        </p>
        <p className="text-sm text-muted-foreground">
          Role: <span className="font-medium text-foreground">{workspaceRole}</span>. Workspace:
          <span className="font-mono text-foreground"> {workspaceIdSnippet}</span>
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30"
          >
            <h2 className="text-base font-semibold">{action.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{action.description}</p>
          </Link>
        ))}
      </div>

      <article className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Current baseline</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Supabase auth flow is complete for sign up, sign in, and protected routes.</li>
          <li>Analysis API is implemented with live scoring inputs and validation.</li>
          <li>Runs are persisted and retrievable for workspace-level history.</li>
          <li>Report generation endpoint returns structured markdown output.</li>
          <li>Core data layers now use real GTFS, crashes, Census, and LODES sources.</li>
        </ul>
      </article>

      <RunHistory workspaceId={workspaceId} />
    </section>
  );
}
