import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildJurisdictionReadinessPayload } from "@/lib/jurisdiction-readiness/payload";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";
import { createClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import {
  HOME_GEOGRAPHY_SCOPE_COLUMNS,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!z.string().uuid().safeParse(workspaceId).success) {
    return NextResponse.json({ error: "A valid workspaceId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await checkWorkspaceMembership(supabase, user.id, workspaceId);
  if (!membership.ok) {
    return NextResponse.json(
      { error: membership.kind === "not_member" ? "Workspace not found" : "Workspace membership could not be verified" },
      { status: membership.kind === "not_member" ? 404 : 503 },
    );
  }

  const read = await supabase
    .from("workspaces")
    .select(`${HOME_GEOGRAPHY_SCOPE_COLUMNS}, home_subdivision_code`)
    .eq("id", workspaceId)
    .maybeSingle();
  if (read.error) {
    return NextResponse.json({ error: "Workspace jurisdiction could not be read" }, { status: 500 });
  }
  if (!read.data) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const geography = parseWorkspaceHomeGeography(read.data);
  const payload = buildJurisdictionReadinessPayload(
    {
      countryCode: geography?.home_country_code ?? null,
      subdivisionCode: geography?.home_subdivision_code ?? null,
      label: geography?.home_geography_label ?? null,
    },
    jurisdictionReadinessRegistrySha256(),
  );
  const download = new URL(request.url).searchParams.get("download") === "1";
  return NextResponse.json(payload, {
    headers: download
      ? { "content-disposition": `attachment; filename="jurisdiction-readiness-${workspaceId}.json"` }
      : undefined,
  });
}
