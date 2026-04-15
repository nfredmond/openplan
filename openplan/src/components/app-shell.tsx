import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Command } from "lucide-react";
import { AppSecondaryNav } from "@/components/nav/app-secondary-nav";
import { AppSidebarLink } from "@/components/nav/app-sidebar-link";
import { AppCopilot } from "@/components/assistant/app-copilot";
import { createClient } from "@/lib/supabase/server";
import {
  loadCurrentWorkspaceMembership,
  resolveWorkspaceShellState,
} from "@/lib/workspaces/current";

const navGroups = [
  {
    title: "Operate",
    items: [
      { href: "/dashboard", label: "Overview", icon: "overview" as const },
      { href: "/projects", label: "Projects", icon: "projects" as const },
      { href: "/rtp", label: "RTP Cycles", icon: "rtp" as const },
      { href: "/plans", label: "Plans", icon: "plans" as const },
      { href: "/programs", label: "Programs", icon: "programs" as const },
      { href: "/reports", label: "Reports", icon: "reports" as const },
    ],
  },
  {
    title: "Analyze",
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
    title: "Govern",
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

  const { membership, workspace } = user
    ? await loadCurrentWorkspaceMembership(supabase, user.id)
    : { membership: undefined, workspace: null };

  const shellState = resolveWorkspaceShellState({
    membership,
    workspace,
    isAuthenticated: Boolean(user),
  });

  const workspaceName = shellState.workspaceName;
  const membershipPending = shellState.membershipStatus === "not_provisioned";

  async function handleSignOut() {
    "use server";
    const actionSupabase = await createClient();
    await actionSupabase.auth.signOut();
    redirect("/");
  }

  return (
    <div className="openplan-shell">
      {/* Left navigation rail */}
      <aside className="openplan-left-rail border-b border-white/[0.06] lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col">
          {/* Brand + workspace */}
          <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-emerald-300/20 bg-emerald-300/[0.07]">
              <Command className="h-3.5 w-3.5 text-emerald-300/80" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-slate-500">
                OpenPlan
              </p>
              <p className="truncate text-[0.84rem] font-semibold leading-tight text-white">
                {workspaceName}
              </p>
            </div>
          </div>

          {/* Primary navigation */}
          <nav className="flex-1 overflow-y-auto py-3" aria-label="Primary navigation">
            <div className="space-y-4 px-2">
              {navGroups.map((group) => (
                <section key={group.title}>
                  <p className="mb-1 px-2 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-slate-600">
                    {group.title}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <AppSidebarLink
                        key={item.href}
                        href={item.href}
                        label={item.label}
                        icon={item.icon}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </nav>

          {/* Context-sensitive sub-navigation */}
          <AppSecondaryNav />

          {/* Footer */}
          <div className="border-t border-white/[0.06] px-2 py-3">
            {membershipPending ? (
              <div className="mb-3 border border-amber-300/20 bg-amber-300/[0.07] p-3">
                <div className="flex items-center gap-2 text-[0.74rem] font-semibold text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Workspace not provisioned
                </div>
                <p className="mt-1.5 text-[0.7rem] leading-relaxed text-amber-50/70">
                  Signed in but not attached to a workspace. Open Projects to create one or ask an
                  owner to add you.
                </p>
                <Link
                  href="/projects"
                  className="mt-2 inline-block text-[0.7rem] font-semibold text-amber-200 underline-offset-2 hover:underline"
                >
                  Open Projects
                </Link>
              </div>
            ) : null}

            <div className="flex items-center gap-2.5 rounded px-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.78rem] font-medium text-slate-300">
                  {user?.email ?? "Guest session"}
                </p>
                <p className="text-[0.66rem] text-slate-600">
                  {user ? shellState.workspaceRole : "Preview mode"}
                </p>
              </div>
              <div className="shrink-0">
                {user ? (
                  <form action={handleSignOut}>
                    <button
                      type="submit"
                      className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:text-slate-300"
                    >
                      Sign out
                    </button>
                  </form>
                ) : (
                  <Link
                    href="/sign-in"
                    className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-emerald-400/80 transition-colors hover:text-emerald-300"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="openplan-main-stage">
        {/* Topbar — workspace context + AI copilot */}
        <header className="openplan-topbar border-b border-[color:var(--shell-border)]">
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[color:var(--shell-muted)]">
                {workspaceName}
              </p>
            </div>
            <div className="relative z-[80] shrink-0">
              <AppCopilot
                workspaceId={membership?.workspace_id ?? null}
                workspaceName={workspaceName}
              />
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="openplan-workbench px-4 pb-8 pt-5 sm:px-6 lg:px-8">
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
