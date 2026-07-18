import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  GRANTS_GOV_SEARCH_ENDPOINT,
  buildGrantsGovSearchBody,
  parseGrantsGovSearchResponse,
} from "@/lib/grants/grants-gov";
import {
  getCachedGrantsGovResult,
  setCachedGrantsGovResult,
} from "@/lib/grants/grants-gov-cache";

const querySchema = z.object({
  keyword: z.string().trim().max(120).optional(),
  agency: z.string().trim().max(200).optional(),
  eligibility: z.string().trim().max(200).optional(),
});

const UPSTREAM_TIMEOUT_MS = 10_000;

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("grants-gov.opportunities", request);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
  if (!membership) {
    return NextResponse.json({ error: "workspace_membership_required" }, { status: 403 });
  }

  const parsedQuery = querySchema.safeParse({
    keyword: request.nextUrl.searchParams.get("keyword") ?? undefined,
    agency: request.nextUrl.searchParams.get("agency") ?? undefined,
    eligibility: request.nextUrl.searchParams.get("eligibility") ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  let searchBody: ReturnType<typeof buildGrantsGovSearchBody>;
  try {
    searchBody = buildGrantsGovSearchBody({
      keyword: parsedQuery.data.keyword,
      agencies: parsedQuery.data.agency,
      eligibilities: parsedQuery.data.eligibility,
    });
  } catch {
    // The lib rejects facet filters outside its pipe-joined code alphabet.
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  const cacheKey = JSON.stringify(searchBody);
  const now = Date.now();
  const cached = getCachedGrantsGovResult(cacheKey, now);
  if (cached) {
    return NextResponse.json({
      ...cached.result,
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      cached: true,
    });
  }

  let payload: unknown;
  try {
    const upstream = await fetch(GRANTS_GOV_SEARCH_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(searchBody),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!upstream.ok) {
      audit.warn("grants.gov upstream returned non-OK status", { status: upstream.status });
      return NextResponse.json({ error: "grants_gov_unreachable" }, { status: 502 });
    }
    payload = await upstream.json();
  } catch (error) {
    audit.warn("grants.gov upstream fetch failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "grants_gov_unreachable" }, { status: 502 });
  }

  const result = parseGrantsGovSearchResponse(payload);
  if (!result) {
    audit.warn("grants.gov response failed defensive parse");
    return NextResponse.json({ error: "grants_gov_unreachable" }, { status: 502 });
  }

  setCachedGrantsGovResult(cacheKey, { fetchedAt: now, result });
  return NextResponse.json({
    ...result,
    fetchedAt: new Date(now).toISOString(),
    cached: false,
  });
}
