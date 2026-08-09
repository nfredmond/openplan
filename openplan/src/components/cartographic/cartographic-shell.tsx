import Link from "next/link";
import { redirect } from "next/navigation";

import { AppCopilot } from "@/components/assistant/app-copilot";
import { buildRailGroups } from "@/components/nav/nav-registry";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { createClient } from "@/lib/supabase/server";
import {
  loadWorkspaceContext,
  resolveWorkspaceShellState,
} from "@/lib/workspaces/current";
import {
  deriveHomeMapView,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";

import { CartographicProvider } from "./cartographic-context";
import { CartographicZoomControls } from "./cartographic-zoom-controls";
import { CartographicHeader } from "./cartographic-header";
import { CartographicInspectorDockConnected } from "./cartographic-inspector-dock-connected";
import { CartographicLayersPanel } from "./cartographic-layers-panel";
import { MapSurfaceOnly } from "./map-surface-only";
import { CartographicMapBackdrop } from "./cartographic-map-backdrop";
import { CartographicMapLegend } from "./cartographic-map-legend";
import { CartographicOverviewSurface } from "./cartographic-overview-surface";
import {
  CartographicRail,
  type CartographicRailGroup,
  type CartographicRailItem,
} from "./cartographic-rail";

// The rail renders the shared nav registry. The registry stores icons as
// NAMES (it must stay importable from the middleware runtime); the rail's own
// ICONS map resolves them to components, and the nav-registry test asserts
// every registered name resolves, which is what makes this cast safe.
function buildNavGroups(): CartographicRailGroup[] {
  return buildRailGroups().map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon as CartographicRailItem["icon"],
    })),
  }));
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

  const { membership, workspace, options: workspaceOptions } = user
    ? await loadWorkspaceContext(supabase, user.id)
    : { membership: undefined, workspace: null, options: [] };

  const shellState = resolveWorkspaceShellState({
    membership,
    workspace,
    isAuthenticated: Boolean(user),
  });

  // Opening camera for the shell backdrop when the workspace has no mapped
  // features to frame yet. Read here so the client backdrop never fetches
  // geography ad hoc, and only the bbox columns are selected — the stored
  // boundary geometry can be megabytes and would ride the RSC payload of every
  // (app) page for a camera that needs four numbers. An error (column missing
  // because the migration has not been applied) leaves `data` null, which
  // parses to null, which frames neutrally.
  const homeGeographyRow = membership
    ? (
        await supabase
          .from("workspaces")
          .select("home_geography_source, home_min_lon, home_min_lat, home_max_lon, home_max_lat")
          .eq("id", membership.workspace_id)
          .maybeSingle()
      ).data
    : null;
  // Derived against the helper's reference viewport rather than the real
  // backdrop size, which is unknowable on the server. It errs wide, so the
  // whole home geography stays on screen instead of being cropped.
  const homeMapView = deriveHomeMapView(parseWorkspaceHomeGeography(homeGeographyRow));

  const workspaceUpdatedLabel =
    formatUpdatedLabel(workspace?.created_at ?? null) ?? null;
  const membershipPending = shellState.membershipStatus === "not_provisioned";
  // A first-run user with no workspace gets a focused self-serve onboarding
  // wizard in place of the empty page.
  const showOnboarding = membershipPending;
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
        <CartographicMapBackdrop
          homeMapView={homeMapView}
          workspaceId={membership?.workspace_id ?? null}
        />

        <CartographicRail groups={buildNavGroups()} />

        <CartographicHeader
          workspaceName={shellState.workspaceName}
          workspaceUpdatedLabel={workspaceUpdatedLabel}
          workspaces={workspaceOptions}
          currentWorkspaceId={membership?.workspace_id ?? null}
        />

        <CartographicOverviewSurface>
          {showOnboarding ? <OnboardingWizard defaultWorkspaceName={orgNameHint} /> : children}
        </CartographicOverviewSurface>

        {/*
          The map stays behind every page; its CONTROLS do not. See
          `lib/navigation/map-surfaces` — a layers panel on the RTP registry
          covered the Planning System card with checkboxes for a map nobody was
          reading, and the legend explained symbols for layers that page cannot
          toggle.
        */}
        <MapSurfaceOnly>
          {/*
            ONE DOCKED COLUMN, NOT TWO INDEPENDENTLY PINNED BOXES.

            The legend was `position: fixed; top: 420px` — a hardcoded offset
            chosen to clear a layers panel of some particular height. The layers
            panel grows with its coverage notes, so on a workspace with tract and
            crash disclosures it ran straight under the legend and the notes were
            covered. A fixed offset cannot survive content it does not know the
            height of.

            Stacking them in one flex column means the legend is BELOW the panel
            by construction, at any height, in any palette, on any viewport.
          */}
          <div className="op-cart-mapdock">
            <CartographicLayersPanel workspaceId={membership?.workspace_id ?? null} />

            <CartographicMapLegend />
          </div>
        </MapSurfaceOnly>

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
