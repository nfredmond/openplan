/**
 * Write authorization for the network-package routes.
 *
 * The package is the workspace-owning record of this module: versions, zones,
 * connectors, and corridors all hang off it and carry no workspace_id of their
 * own, so a write to any of them is a write to the PACKAGE's workspace. The
 * ingest route already resolved the package and applied the viewer floor
 * inline; this is the same check, in one place, for the sibling routes that had
 * no authorization at all beyond row-visibility RLS.
 *
 * Which package a version belongs to stays RLS's job, exactly as before — this
 * function changes who may write, not what they may reach.
 */

import { NextResponse } from "next/server";
import { requireWorkspaceWriteAccess } from "@/lib/auth/workspace-write-gate";

type QueryError = { message: string; code?: string | null } | null;

type NetworkPackageRow = {
  id: string;
  workspace_id: string;
};

type PackageQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: NetworkPackageRow | null; error: QueryError }>;
      };
    };
  };
};

export type NetworkPackageWriteAccess =
  | { ok: true; workspaceId: string }
  | { ok: false; response: NextResponse };

/**
 * Resolve the package's workspace with the caller's own RLS client, then apply
 * the viewer write floor. Call it after authentication and before any write.
 */
export async function requireNetworkPackageWriteAccess(
  supabase: unknown,
  packageId: string,
  userId: string
): Promise<NetworkPackageWriteAccess> {
  const client = supabase as PackageQueryClient;
  const { data: pkg, error } = await client
    .from("network_packages")
    .select("id, workspace_id")
    .eq("id", packageId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to verify network package" }, { status: 500 }),
    };
  }

  if (!pkg) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Network package not found" }, { status: 404 }),
    };
  }

  const writeAccess = await requireWorkspaceWriteAccess(supabase, userId, pkg.workspace_id);
  if (!writeAccess.ok) {
    return { ok: false, response: writeAccess.response };
  }

  return { ok: true, workspaceId: pkg.workspace_id };
}
