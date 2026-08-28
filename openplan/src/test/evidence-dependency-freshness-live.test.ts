import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;

liveDescribe("project evidence dependency freshness triggers", () => {
  let service: SupabaseClient;
  let workspaceId = "";
  let projectId = "";

  async function revision(): Promise<string> {
    const read = await service.from("projects").select("updated_at").eq("id", projectId).single();
    if (read.error || !read.data) throw new Error(read.error?.message ?? "project revision missing");
    return read.data.updated_at as string;
  }

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "evidence-freshness-service");
    workspaceId = randomUUID();
    projectId = randomUUID();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const workspace = await service.from("workspaces").insert({
      id: workspaceId,
      name: `Evidence freshness ${suffix}`,
      slug: `evidence-freshness-${suffix}`,
    });
    if (workspace.error) throw new Error(workspace.error.message);
    const project = await service.from("projects").insert({
      id: projectId,
      workspace_id: workspaceId,
      name: "Evidence dependency project",
    });
    if (project.error) throw new Error(project.error.message);
  });

  afterAll(async () => {
    if (service && workspaceId) {
      const removed = await service.from("workspaces").delete().eq("id", workspaceId);
      if (removed.error) throw new Error(removed.error.message);
    }
  });

  it("advances monotonically for a direct GIS input and a report artifact child", async () => {
    const beforeCorridor = await revision();
    const corridor = await service.from("project_corridors").insert({
      workspace_id: workspaceId,
      project_id: projectId,
      name: "Freshness proof corridor",
      corridor_type: "custom",
      geometry_geojson: { type: "LineString", coordinates: [[-83.1, 39.9], [-83.0, 40.0]] },
    });
    expect(corridor.error).toBeNull();
    const afterCorridor = await revision();
    expect(Date.parse(afterCorridor)).toBeGreaterThan(Date.parse(beforeCorridor));

    const reportId = randomUUID();
    const report = await service.from("reports").insert({
      id: reportId,
      workspace_id: workspaceId,
      project_id: projectId,
      title: "Freshness proof report",
      report_type: "board_packet",
    });
    expect(report.error).toBeNull();
    const beforeArtifact = await revision();

    const artifact = await service.from("report_artifacts").insert({
      report_id: reportId,
      artifact_kind: "pdf",
      storage_path: `${workspaceId}/${reportId}/proof.pdf`,
      metadata_json: { checksumSha256: "a".repeat(64) },
    });
    expect(artifact.error).toBeNull();
    const afterArtifact = await revision();
    expect(Date.parse(afterArtifact)).toBeGreaterThan(Date.parse(beforeArtifact));
  });
});
