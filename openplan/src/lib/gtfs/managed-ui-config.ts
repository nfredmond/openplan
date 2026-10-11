import { z } from "zod";
import { managedGtfsEnabled } from "./managed-route";
import { gtfsQueueOptions } from "./managed-worker-queue";
import type { GtfsClientScope } from "./managed-client";

export type GtfsManagedClientMode = { enabled: false } | { enabled: true; scope: GtfsClientScope } | { enabled: true; unavailable: string };

/** Expose only browser history identity, never private configuration. An
 * enabled but misconfigured worker cannot fall back to untracked submissions.
 */
export function gtfsManagedClientMode(workspaceId: string, actorId: string, env: Partial<NodeJS.ProcessEnv> = process.env): GtfsManagedClientMode {
 try {
  if (!managedGtfsEnabled(env)) return { enabled: false };
  const options = gtfsQueueOptions(["--once"], env);
  if (options.help) throw new Error("Worker configuration is unavailable");
  const scope = z.object({ installationId: z.string().uuid(), workspaceId: z.string().uuid(), actorId: z.string().uuid() }).strict().parse({ installationId: options.installationId, workspaceId, actorId });
  return { enabled: true, scope };
 } catch {
  return { enabled: true, unavailable: "Managed transit imports are unavailable. The installation operator must check the worker configuration. Existing feeds remain readable." };
 }
}
