import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bell,
  ChevronRight,
  Command,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppSecondaryNav } from "@/components/nav/app-secondary-nav";
import { AppSidebarLink } from "@/components/nav/app-sidebar-link";
import { createClient } from "@/lib/supabase/server";

type MembershipRow = {
  workspace_id: string;
  role: string;
  workspaces:
    | {
        name: string | null;
        plan: string | null;
      }
    | Array<{
        name: string | null;
        plan: string | null;
      }>
    | null;
};

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
        .select("workspace_id, role, workspaces(name, plan)")
        .eq("user_id", user.id)
        .limit(1)
    : { data: [] };

  const membership = memberships?.[0] as MembershipRow | undefined;
  const workspace = Array.isArray(membership?.workspaces)
    ? membership?.workspaces[0] ?? null
    : membership?.workspaces ?? null;

  const workspaceName = workspace?.name ?? "Planning Workspace";
  const workspacePlan = workspace?.plan ?? "pilot";
  const workspaceRole = membership?.role ?? (user ? "member" : "guest");

  async function handleSignOut() {
    "use server";
    const actionSupabase = await createClient();
    await actionSupabase.auth.signOut();
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#0b1218_0%,#0f1720_18%,#111a24_100%)] text-slate-100 lg:grid lg:grid-cols-[296px_minmax(0,1fr)]">
      <aside className="border-b border-white/8 bg-[linear-gradient(180deg,rgba(6,12,18,0.98),rgba(8,15,21,0.96))] lg:min-h-screen lg:border-b-0 lg:border-r lg:border-white/8">
        <div className="flex h-full flex-col px-4 py-4 sm:px-5 lg:px-5 lg:py-5">
          <div className="flex items-center justify-between gap-3 pb-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 transition hover:border-white/15 hover:bg-white/[0.06]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/12 text-emerald-200 shadow-[0_0_0_1px_rgba(110,231,183,0.12)]">
                <Command className="h-4.5 w-4.5" strokeWidth={1.9} />
              </span>
              <span>
                <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-slate-400">OpenPlan</span>
                <span className="block text-sm font-semibold tracking-[0.02em] text-white">Planning OS</span>
              </span>
            </Link>
            <div className="hidden rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400 lg:block">
              Desktop Shell
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.22)]">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Workspace</p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-white">{workspaceName}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.72rem] uppercase tracking-[0.12em] text-slate-300/80">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">Plan: {workspacePlan}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">Role: {workspaceRole}</span>
            </div>
            <p className="mt-3 text-sm text-slate-300/78">
              Shift focus from standalone corridor runs to a full operating system for plans, programs, engagement, and model workflows.
            </p>
          </div>

          <nav className="mt-5 space-y-1.5" aria-label="Primary application navigation">
            {primaryNav.map((item) => (
              <AppSidebarLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
            ))}
          </nav>

          <div className="mt-5">
            <AppSecondaryNav />
          </div>

          <div className="mt-auto space-y-3 pt-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                Operating posture
              </div>
              <p className="mt-2 text-sm text-slate-300/78">
                Multi-module shell is now active. Next build waves will bind each module to real Planning OS objects and workflows.
              </p>
            </div>

            {user ? (
              <form action={handleSignOut}>
                <button
                  type="submit"
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-white/15 hover:bg-white/[0.06] hover:text-white"
                >
                  Sign out
                </button>
              </form>
            ) : (
              <Link
                href="/sign-in"
                className="block w-full rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-center text-sm font-semibold text-emerald-100 transition hover:border-emerald-200/30 hover:bg-emerald-400/14"
              >
                Sign in to activate full workspace access
              </Link>
            )}
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-white/8 bg-[linear-gradient(180deg,rgba(7,12,17,0.94),rgba(7,12,17,0.82))] backdrop-blur-xl">
          <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                Planning OS Workspace
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-300/80">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">Left-nav app shell active</span>
                <span className="hidden text-slate-500 sm:inline">/</span>
                <span className="inline-flex items-center gap-1.5 text-slate-300/76">
                  Product reset
                  <ChevronRight className="h-3.5 w-3.5" />
                  Option C
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-[280px] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-sm text-slate-300 shadow-[0_10px_24px_rgba(0,0,0,0.12)]">
                <Search className="h-4 w-4 text-slate-500" />
                <span className="truncate text-slate-400">Search projects, plans, campaigns, reports…</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-white/15 hover:bg-white/[0.06] hover:text-white"
                  aria-label="Notifications"
                >
                  <Bell className="h-4.5 w-4.5" />
                </button>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-slate-300 shadow-[0_10px_24px_rgba(0,0,0,0.12)]">
                  <p className="font-medium text-white">{user?.email ?? "Guest session"}</p>
                  <p className="text-xs text-slate-400">{user ? "Authenticated workspace access" : "Previewing app shell"}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8">
          <div className="rounded-[30px] border border-white/6 bg-[linear-gradient(180deg,rgba(244,248,251,0.98),rgba(238,244,248,0.96))] p-4 text-slate-950 shadow-[0_30px_80px_rgba(0,0,0,0.18)] sm:p-5 lg:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
