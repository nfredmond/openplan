import { z } from "zod";
import type { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Reserve county loads into the shared `census_tracts` table for one person.
 *
 * The data is public and cross-tenant, and every load runs as the service role
 * against TIGERweb and ACS, so it is metered per person rather than per
 * workspace: anyone who signs up owns a workspace and could otherwise multiply
 * the allowance by making more. The allowance and window live in
 * `reserve_census_tract_ingest` (migration 20261017000006), which also checks
 * the workspace role and counts and records under one advisory lock.
 */

type ServiceRpcClient = Pick<ReturnType<typeof createServiceRoleClient>, "rpc">;

export type CensusTractIngestReservation =
  | { status: "reserved" }
  | { status: "refused"; recent: number; limit: number; retryAfterSeconds: number }
  | { status: "unavailable"; message: string };

const reservationSchema = z.object({
  allowed: z.boolean(),
  recent: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  retryAfterSeconds: z.number().int().nonnegative(),
});

export async function reserveCensusTractIngest(
  service: ServiceRpcClient,
  input: {
    userId: string;
    workspaceId: string;
    counties: ReadonlyArray<{ stateFips: string; countyFips: string }>;
    sourceRoute: string;
  }
): Promise<CensusTractIngestReservation> {
  const { data, error } = await service.rpc("reserve_census_tract_ingest", {
    p_user_id: input.userId,
    p_workspace_id: input.workspaceId,
    p_counties: input.counties.map((county) => `${county.stateFips}${county.countyFips}`),
    p_source_route: input.sourceRoute,
  });
  if (error) return { status: "unavailable", message: error.message };
  const parsed = reservationSchema.safeParse(data);
  if (!parsed.success) return { status: "unavailable", message: "unexpected reservation reply" };
  if (parsed.data.allowed) return { status: "reserved" };
  return {
    status: "refused",
    recent: parsed.data.recent,
    limit: parsed.data.limit,
    retryAfterSeconds: parsed.data.retryAfterSeconds,
  };
}
