// @vitest-environment node
import { describe, expect, it } from "vitest";
import { gtfsManagedClientMode } from "@/lib/gtfs/managed-ui-config";
const id = (n: number) => `e6000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = { OPENPLAN_GTFS_MANAGED_INGESTION: "1", OPENPLAN_GTFS_INSTALLATION_ID: id(3), OPENPLAN_GTFS_PARSER_BUILD: "a".repeat(40), NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", OPENPLAN_GTFS_WORK_DIR: "/private/gtfs", SUPABASE_SERVICE_ROLE_KEY: "synthetic-private-key" };
describe("managed transit browser configuration", () => {
 it("keeps explicitly disabled installations on the legacy path", () => { expect(gtfsManagedClientMode(id(1), id(2), {})).toEqual({ enabled: false }); expect(gtfsManagedClientMode(id(1), id(2), { ...env, OPENPLAN_GTFS_MANAGED_INGESTION: "0" })).toEqual({ enabled: false }); });
 it("exposes only installation, workspace and actor identity", () => { expect(gtfsManagedClientMode(id(1), id(2), env)).toEqual({ enabled: true, scope: { installationId: id(3), workspaceId: id(1), actorId: id(2) } }); });
 it.each(["OPENPLAN_GTFS_INSTALLATION_ID", "OPENPLAN_GTFS_PARSER_BUILD", "NEXT_PUBLIC_SUPABASE_URL", "OPENPLAN_GTFS_WORK_DIR", "OPENPLAN_GTFS_MANAGED_INGESTION"])("does not fall back when enabled %s is invalid", field => { const mode = gtfsManagedClientMode(id(1), id(2), { ...env, [field]: "invalid" }); expect(mode).toMatchObject({ enabled: true, unavailable: expect.any(String) }); expect(mode).not.toHaveProperty("scope"); expect(JSON.stringify(mode)).not.toContain("synthetic-private-key"); expect(JSON.stringify(mode)).not.toContain("/private/"); });
 it("refuses invalid browser workspace or actor identity without legacy fallback", () => { expect(gtfsManagedClientMode("invalid", id(2), env)).toHaveProperty("unavailable"); expect(gtfsManagedClientMode(id(1), "invalid", env)).toHaveProperty("unavailable"); });
});
