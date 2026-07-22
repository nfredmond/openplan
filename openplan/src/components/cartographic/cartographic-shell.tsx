import Link from "next/link";
import { redirect } from "next/navigation";

import { AppCopilot } from "@/components/assistant/app-copilot";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { canReviewAccessRequests } from "@/lib/access-requests";
import { createClient } from "@/lib/supabase/server";
import {
  loadCurrentWorkspaceMembership,
  resolveWorkspaceShellState,
} from "@/lib/workspaces/current";

import { CartographicProvider } from "./cartographic-context";
import { CartographicZoomControls } from "./cartographic-zoom-controls";
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

function buildNavGroups(isOperator: boolean): CartographicRailGroup[] {
  return [
    {
      title: "Operate",
      items: [
        { href: "/dashboard", label: "Overview", icon: "overview" },
        { href: "/command-center", label: "Command Center", icon: "command" },
        { href: "/projects", label: "Projects", icon: "projects" },
        { href: "/rtp", label: "RTP Cycles", icon: "rtp" },
        { href: "/plans", label: "Plans", icon: "plans" },
        { href: "/programs", label: "Programs", icon: "programs" },
        { href: "/grants", label: "Grants", icon: "grants" },
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
        ...(isOperator ? [{ href: "/admin", label: "Admin", icon: "admin" as const }] : []),
      ],
    },
  ];
}

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
  const isOperator = canReviewAccessRequests(user?.email);
  // A first-run user with no workspace gets a focused self-serve onboarding
  // wizard in place of the empty page. Operators keep full access to every
  // (app) route (e.g. /admin) even without a workspace, so the wizard never
  // hijacks their surface.
  const showOnboarding = membershipPending && !isOperator;
  const orgNameHint =
    typeof user?.user_metadata?.org_name === "string" ? user.user_metadata.org_name : "";

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

        <CartographicRail groups={buildNavGroups(isOperator)} />

        <CartographicHeader
          workspaceName={shellState.workspaceName}
          workspacePlan={shellState.workspacePlan}
          workspaceUpdatedLabel={workspaceUpdatedLabel}
        />

        <CartographicOverviewSurface>
          {showOnboarding ? <OnboardingWizard defaultWorkspaceName={orgNameHint} /> : children}
        </CartographicOverviewSurface>

        <CartographicLayersPanel />

        <CartographicMapLegend />

        <CartographicInspectorDockConnected />

        <CartographicZoomControls />

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
