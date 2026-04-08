import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Command, ShieldCheck } from "lucide-react";
import { AppSecondaryNav } from "@/components/nav/app-secondary-nav";
import { AppSidebarLink } from "@/components/nav/app-sidebar-link";
import { AppCopilot } from "@/components/assistant/app-copilot";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  resolveWorkspaceShellState,
  unwrapWorkspaceRecord,
  type WorkspaceMembershipRow,
} from "@/lib/workspaces/current";

const navGroups = [
  {
    title: "Main",
    items: [
      { href: "/dashboard", label: "Overview", icon: "overview" as const },
      { href: "/projects", label: "Projects", icon: "projects" as const },
      { href: "/plans", label: "Plans", icon: "plans" as const },
      { href: "/programs", label: "Programs", icon: "programs" as const },
      { href: "/reports", label: "Reports", icon: "reports" as const },
    ],
  },
  {
    title: "Analysis",
    items: [
      { href: "/engagement", label: "Engagement", icon: "engagement" as const },
      { href: "/explore", label: "Analysis Studio", icon: "analysis" as const },
      { href: "/scenarios", label: "Scenarios", icon: "scenarios" as const },
      { href: "/models", label: "Models", icon: "models" as const },
      { href: "/county-runs", label: "County Validation", icon: "county" as const },
      { href: "/data-hub", label: "Data Hub", icon: "data" as const },
    ],
  },
  {
    title: "Workspace",
    items: [
      { href: "/billing", label: "Billing", icon: "billing" as const },
      { href: "/admin", label: "Admin", icon: "admin" as const },
    ],
  },
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = user
    ? await supabase
        .from("workspace_members")
        .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
        .eq("user_id", user.id)
        .limit(1)
    : { data: [] };

  const membership = memberships?.[0] as WorkspaceMembershipRow | undefined;
  const workspace = unwrapWorkspaceRecord(membership?.workspaces);

  const shellState = resolveWorkspaceShellState({
    membership,
    workspace,
    isAuthenticated: Boolean(user),
  });

  const workspaceName = shellState.workspaceName;
  const workspacePlan = shellState.workspacePlan;
  const workspaceRole = shellState.workspaceRole;
  const membershipPending = shellState.membershipStatus === "not_provisioned";

  async function handleSignOut() {
    "use server";
    const actionSupabase = await createClient();
    await actionSupabase.auth.signOut();
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[288px_minmax(0,1fr)] xl:grid-cols-[304px_minmax(0,1fr)]">
      <aside className="shell-sidebar relative border-b border-[color:var(--shell-border)] lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="shell-sidebar-grid flex h-full flex-col gap-5 px-4 py-4 lg:px-5 lg:py-5">
          <div className="shell-brand-strip">
            <Link href="/dashboard" className="shell-brand-mark">
              <span className="shell-brand-icon">
                <Command className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="shell-brand-kicker">OpenPlan</span>
                <span className="shell-brand-title">Civic Workbench</span>
              </span>
            </Link>
          </div>

          <section className="shell-ledger-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="shell-panel-kicker">Workspace ledger</p>
                <h2 className="mt-2 font-display text-[1.3rem] font-semibold tracking-tight text-white">
                  {workspaceName}
                </h2>
              </div>
              <span className="shell-inline-stamp text-emerald-100/90">
                <ShieldCheck className="h-3.5 w-3.5" />
                supervised pilot
              </span>
            </div>
            <div className="mt-4 grid gap-2 text-[0.72rem] uppercase tracking-[0.16em] text-slate-300/78 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="shell-data-line">
                <span>Plan</span>
                <strong>{workspacePlan}</strong>
              </div>
              <div className="shell-data-line">
                <span>Role</span>
                <strong>{workspaceRole}</strong>
              </div>
            </div>
          </section>

          <nav className="space-y-4" aria-label="Primary application navigation">
            {navGroups.map((group) => (
              <div key={group.title} className="space-y-2">
                <div className="px-1">
                  <p className="shell-section-label">{group.title}</p>
                </div>
                <div className="space-y-1.5">
                  {group.items.map((item) => (
                    <AppSidebarLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <AppSecondaryNav />

          <div className="mt-auto space-y-3 pt-4">
            {membershipPending ? (
              <div className="shell-warning-rail">
                <div className="flex items-center gap-2 text-[0.82rem] font-semibold text-amber-100">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-200" />
                  Workspace membership pending
                </div>
                <p className="mt-2 text-[0.78rem] leading-relaxed text-amber-50/82">
                  This account is authenticated, but it is not attached to a workspace yet. Open Projects to create one or ask an owner/admin to add you.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/projects" className="shell-text-link">
                    Open Projects
                  </Link>
                  <Link href="/dashboard" className="shell-text-link shell-text-link-muted">
                    Overview
                  </Link>
                </div>
              </div>
            ) : null}

            <div className="shell-session-panel">
              <div>
                <p className="shell-panel-kicker">Session</p>
                <p className="mt-2 text-sm font-medium text-white">{user?.email ?? "Guest session"}</p>
                <p className="mt-1 text-[0.74rem] text-slate-400">
                  {user ? "Authenticated workspace operator" : "Preview mode"}
                </p>
              </div>

              {user ? (
                <form action={handleSignOut}>
                  <button type="submit" className="shell-action-button w-full">
                    Sign out
                  </button>
                </form>
              ) : (
                <Link href="/sign-in" className="shell-action-button shell-action-button-accent block text-center">
                  Sign in to activate workspace
                </Link>
              )}
            </div>
          </div>
        </div>
      </aside>

      <div className="shell-main min-w-0">
        <header className="app-shell-toolbar sticky top-0 z-30 border-b border-[color:var(--shell-border)]">
          <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <p className="shell-section-label">OpenPlan operator surface</p>
              <p className="mt-1 text-sm text-[color:var(--shell-muted)]">
                Atlas Studio, survey ledger, and delivery controls in one continuous workbench.
              </p>
            </div>
            <div className="relative z-[80] flex items-center justify-between gap-2 lg:justify-end">
              <AppCopilot workspaceId={membership?.workspace_id ?? null} workspaceName={workspaceName} />
            </div>
          </div>
        </header>

        <main className="relative min-w-0 px-4 pb-6 pt-4 sm:px-6 sm:pb-7 lg:px-8 lg:pb-8 lg:pt-5">
          <div className="workspace-module-surface text-slate-950">
            <div className="relative px-4 pb-4 pt-5 sm:px-5 sm:pb-5 sm:pt-6 lg:px-7 lg:pb-7 lg:pt-7">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
