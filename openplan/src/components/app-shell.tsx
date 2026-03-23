import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Command,
  Search,
  ShieldCheck,
} from "lucide-react";
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

const primaryNav = [
  { href: "/dashboard", label: "Overview", icon: "overview" as const },
  { href: "/projects", label: "Projects", icon: "projects" as const },
  { href: "/plans", label: "Plans", icon: "plans" as const },
  { href: "/programs", label: "Programs", icon: "programs" as const },
  { href: "/engagement", label: "Engagement", icon: "engagement" as const },
  { href: "/explore", label: "Analysis Studio", icon: "analysis" as const },
  { href: "/scenarios", label: "Scenarios", icon: "scenarios" as const },
  { href: "/models", label: "Models", icon: "models" as const },
  { href: "/data-hub", label: "Data Hub", icon: "data" as const },
  { href: "/reports", label: "Reports", icon: "reports" as const },
  { href: "/admin", label: "Admin", icon: "admin" as const },
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
    <div className="relative isolate min-h-screen overflow-hidden bg-[linear-gradient(180deg,#0b1218_0%,#0f1720_18%,#111a24_58%,#121c26_100%)] text-slate-100 lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(820px_320px_at_20%_-4%,rgba(86,162,113,0.10),transparent_58%),radial-gradient(700px_280px_at_90%_0%,rgba(96,165,250,0.08),transparent_64%)] lg:block"
      />

      {/* ── Sidebar ── */}
      <aside className="relative z-10 border-b border-white/[0.06] bg-[linear-gradient(180deg,rgba(6,12,18,0.985),rgba(8,15,21,0.97))] lg:min-h-screen lg:border-b-0 lg:border-r lg:border-white/[0.06]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-12 right-0 hidden w-px bg-gradient-to-b from-white/[0.18] via-white/[0.08] to-transparent lg:block"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-24 hidden h-64 w-40 bg-[radial-gradient(circle,rgba(45,212,191,0.12),transparent_68%)] opacity-35 blur-3xl lg:block"
        />

        <div className="flex h-full flex-col px-4 py-4 lg:px-5 lg:py-5">
          {/* Logo */}
          <div className="pb-5">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-200 shadow-[0_0_0_1px_rgba(110,231,183,0.10)]">
                <Command className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span>
                <span className="block text-[0.64rem] font-semibold uppercase tracking-[0.26em] text-slate-400">OpenPlan</span>
                <span className="block text-[0.84rem] font-semibold tracking-[0.02em] text-white">Planning OS</span>
              </span>
            </Link>
          </div>

          {/* Workspace info */}
          <div className="rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.038),rgba(255,255,255,0.026))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <p className="text-[0.64rem] font-semibold uppercase tracking-[0.24em] text-slate-400">Workspace</p>
            <h2 className="mt-2 font-display text-lg font-semibold tracking-tight text-white">{workspaceName}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.68rem] uppercase tracking-[0.14em] text-slate-300/70">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5">{workspacePlan}</span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5">{workspaceRole}</span>
            </div>
          </div>

          {/* Primary navigation */}
          <nav className="mt-5 space-y-1" aria-label="Primary application navigation">
            {primaryNav.map((item) => (
              <AppSidebarLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
            ))}
          </nav>

          {/* Contextual secondary nav */}
          <div className="mt-5">
            <AppSecondaryNav />
          </div>

          {/* Bottom: status + auth */}
          <div className="mt-auto space-y-3 pt-6">
            <div className="rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.02))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center gap-2 text-[0.82rem] font-semibold text-white">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-300/80" />
                Platform status
              </div>
              <p className="mt-1.5 text-[0.78rem] leading-relaxed text-slate-300/70">
                Multi-module shell is active. Modules are binding to live Planning OS objects and workflows.
              </p>
            </div>

            {membershipPending ? (
              <div className="rounded-2xl border border-amber-300/15 bg-amber-400/10 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-center gap-2 text-[0.82rem] font-semibold text-amber-100">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-200" />
                  Workspace membership pending
                </div>
                <p className="mt-1.5 text-[0.78rem] leading-relaxed text-amber-50/80">
                  You are signed in, but this account is not attached to a workspace yet. Create one from Projects or ask an owner/admin to add you.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-amber-100/85">
                  <Link href="/projects" className="rounded-full border border-amber-200/20 px-2.5 py-1 transition hover:border-amber-100/35 hover:text-white">
                    Open Projects
                  </Link>
                  <Link href="/dashboard" className="rounded-full border border-amber-200/15 px-2.5 py-1 text-amber-100/75 transition hover:border-amber-100/35 hover:text-white">
                    Overview
                  </Link>
                </div>
              </div>
            ) : null}

            {user ? (
              <form action={handleSignOut}>
                <button
                  type="submit"
                  className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-slate-200/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white"
                >
                  Sign out
                </button>
              </form>
            ) : (
              <Link
                href="/sign-in"
                className="block w-full rounded-2xl border border-emerald-300/15 bg-emerald-400/8 px-4 py-2.5 text-center text-sm font-semibold text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-200 hover:border-emerald-200/25 hover:bg-emerald-400/12"
              >
                Sign in to activate workspace
              </Link>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main content area ── */}
      <div className="relative min-w-0">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 hidden h-[360px] bg-[radial-gradient(64%_90%_at_18%_0%,rgba(255,255,255,0.05),transparent_52%)] lg:block"
        />

        {/* Top bar */}
        <header className="app-shell-toolbar sticky top-0 z-30 border-b border-white/[0.06] backdrop-blur-xl">
          <div className="relative flex items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            {/* Search */}
            <div className="flex min-w-0 max-w-[440px] flex-1 items-center gap-3 rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.028))] px-3.5 py-2.5 text-sm text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-200 hover:border-white/[0.12] hover:bg-white/[0.05]">
              <Search className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="truncate">Search projects, plans, reports…</span>
            </div>

            {/* Right: notification + user */}
            <div className="flex items-center gap-2">
              <AppCopilot workspaceId={membership?.workspace_id ?? null} workspaceName={workspaceName} />
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.028))] text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
              </button>
              <div className="hidden rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.028))] px-3.5 py-2 text-sm text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:block">
                <p className="font-medium text-white">{user?.email ?? "Guest session"}</p>
                <p className="text-[0.72rem] text-slate-400">{user ? "Authenticated" : "Preview mode"}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="relative min-w-0 px-4 pb-6 pt-4 sm:px-6 sm:pb-7 lg:px-8 lg:pb-8 lg:pt-5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-4 top-0 h-20 rounded-[30px] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0))] sm:inset-x-6 lg:inset-x-8"
          />
          <div className="relative -mt-2 lg:-mt-3">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-6 -top-4 h-14 rounded-[28px] bg-[radial-gradient(60%_120%_at_50%_100%,rgba(56,189,248,0.10),transparent_72%)] blur-2xl"
            />
            <div className="workspace-module-surface text-slate-950">
              <div className="relative px-4 pb-4 pt-5 sm:px-5 sm:pb-5 sm:pt-6 lg:px-6 lg:pb-6 lg:pt-7">
                {children}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
