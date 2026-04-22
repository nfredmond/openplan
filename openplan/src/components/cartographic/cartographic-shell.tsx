import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { AppCopilot } from "@/components/assistant/app-copilot";
import { createClient } from "@/lib/supabase/server";
import {
  loadCurrentWorkspaceMembership,
  resolveWorkspaceShellState,
} from "@/lib/workspaces/current";

import { CartographicProvider } from "./cartographic-context";
import { CartographicHeader } from "./cartographic-header";
import { CartographicInspectorDockConnected } from "./cartographic-inspector-dock-connected";
import { CartographicLayersPanel } from "./cartographic-layers-panel";
import { CartographicMapBackdrop } from "./cartographic-map-backdrop";
import { CartographicMapLegend } from "./cartographic-map-legend";
import { CartographicOverviewSurface } from "./cartographic-overview-surface";
import {
  CartographicRail,
  type CartographicRailGroup,
} from "./cartographic-rail";

const NAV_GROUPS: CartographicRailGroup[] = [
  {
    title: "Operate",
    items: [
      { href: "/dashboard", label: "Overview", icon: "overview" },
      { href: "/command-center", label: "Command Center", icon: "command" },
      { href: "/projects", label: "Projects", icon: "projects" },
      { href: "/rtp", label: "RTP Cycles", icon: "rtp" },
      { href: "/plans", label: "Plans", icon: "plans" },
      { href: "/programs", label: "Programs", icon: "programs" },
      { href: "/reports", label: "Reports", icon: "reports" },
    ],
  },
  {
    title: "Analyze",
    items: [
      { href: "/engagement", label: "Engagement", icon: "engagement" },
      { href: "/explore", label: "Analysis Studio", icon: "analysis" },
      { href: "/scenarios", label: "Scenarios", icon: "scenarios" },
      { href: "/models", label: "Models", icon: "models" },
      { href: "/county-runs", label: "County Validation", icon: "county" },
      { href: "/data-hub", label: "Data Hub", icon: "data" },
      { href: "/aerial", label: "Aerial Ops", icon: "aerial" },
    ],
  },
  {
    title: "Govern",
    items: [
      { href: "/billing", label: "Billing", icon: "billing" },
      { href: "/admin", label: "Admin", icon: "admin" },
    ],
  },
];

function formatUpdatedLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function CartographicShell({ children }: { children: React.ReactNode }) {
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

  const workspaceUpdatedLabel =
    formatUpdatedLabel(workspace?.billing_updated_at ?? workspace?.created_at ?? null) ?? null;
  const membershipPending = shellState.membershipStatus === "not_provisioned";

  async function handleSignOut() {
    "use server";
    const actionSupabase = await createClient();
    await actionSupabase.auth.signOut();
    redirect("/");
  }

  return (
    <CartographicProvider>
      <div className="op-cart-shell">
        <CartographicMapBackdrop />

        <CartographicRail groups={NAV_GROUPS} />

        <CartographicHeader
          workspaceName={shellState.workspaceName}
          workspacePlan={shellState.workspacePlan}
          workspaceUpdatedLabel={workspaceUpdatedLabel}
        />

        <CartographicOverviewSurface>
          {membershipPending ? (
            <div className="op-cart-alert" role="status">
              <div className="op-cart-alert__hd">
                <AlertTriangle size={14} strokeWidth={1.8} aria-hidden />
                <span>Workspace not provisioned</span>
              </div>
              <p className="op-cart-alert__body">
                Signed in but not attached to a workspace. Open Projects to create one or ask an
                owner to add you.
              </p>
              <Link href="/projects" className="op-cart-alert__cta">
                Open Projects
              </Link>
            </div>
          ) : null}
          {children}
        </CartographicOverviewSurface>

        <CartographicLayersPanel />

        <CartographicMapLegend />

        <CartographicInspectorDockConnected />

        <div className="op-cart-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom in">＋</button>
          <button type="button" aria-label="Zoom out">−</button>
        </div>

        <div className="op-cart-copilot-slot">
          <AppCopilot
            workspaceId={membership?.workspace_id ?? null}
            workspaceName={shellState.workspaceName}
          />
        </div>

        <div className="op-cart-account" aria-label="Account">
          <div className="op-cart-account__who">
            <span className="op-cart-account__email">{user?.email ?? "Guest session"}</span>
            <span className="op-cart-account__role">
              {user ? shellState.workspaceRole : "Preview mode"}
            </span>
          </div>
          {user ? (
            <form action={handleSignOut}>
              <button type="submit" className="op-cart-account__signout">
                Sign out
              </button>
            </form>
          ) : (
            <Link href="/sign-in" className="op-cart-account__signout">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </CartographicProvider>
  );
}
