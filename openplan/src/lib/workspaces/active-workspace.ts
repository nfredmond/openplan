/**
 * The ACTIVE WORKSPACE selection — which of a user's workspaces they are
 * currently working in, persisted across requests and modules.
 *
 * A user can belong to more than one workspace: their own, plus any they were
 * invited to. "Current workspace" used to mean "newest-first, take the first"
 * (src/lib/workspaces/current.ts), which is arbitrary — an invited teammate
 * landed in their personal workspace instead of the team's, and a member of
 * several had no way to move between them. This cookie is the durable answer:
 * the workspace switcher writes it, invitation acceptance writes it, and
 * loadWorkspaceContext reads it. When it is unset or stale (points at a
 * workspace the user no longer belongs to), the caller falls back to the
 * newest-first default, so a bad cookie is never a dead end.
 *
 * The cookie is httpOnly: only server code needs it (page loaders read it to
 * resolve the workspace), and the switcher UI is handed its selection through
 * server-rendered props, so the browser never needs to read the value.
 */

import { cookies } from "next/headers";

export const ACTIVE_WORKSPACE_COOKIE = "openplan_active_workspace";

/** One year — a selection should survive well beyond a session. */
const ACTIVE_WORKSPACE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The selected workspace id from the cookie, or null.
 *
 * Safe to call outside a request scope (unit tests, non-request server code):
 * `cookies()` throws there, and this returns null rather than propagating —
 * null simply means "no selection", which the caller already handles. A value
 * that is not a UUID is treated as absent rather than trusted.
 */
export async function readActiveWorkspaceId(): Promise<string | null> {
  try {
    const store = await cookies();
    const value = store.get(ACTIVE_WORKSPACE_COOKIE)?.value?.trim();
    return value && UUID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Persist the selected workspace. Callable only from a route handler or server
 * action (where the cookie store is writable); in a server component the store
 * is read-only and this throws — deliberately, because a page render must not
 * mutate the selection as a side effect.
 */
export async function writeActiveWorkspaceId(workspaceId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ACTIVE_WORKSPACE_MAX_AGE_SECONDS,
  });
}
