import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { BCA_PROJECT_PROJECTION, type BcaProjectPlaceRead } from "@/lib/bca/workbench/project-place";
import { PROJECT_PLACE_SCOPE_COLUMNS } from "@/lib/projects/project-place";
import { bcaActorId, bcaProjectId, bcaProjectRow } from "./fixtures/bca/project-place";

const mocks = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, redirect: () => { throw new Error("sign in"); } }));
vi.mock("@/components/grants/bca-workbench/workbench", () => ({ BcaWorkbench: () => null }));
vi.mock("@/lib/models/guided-comparison-evidence-server", () => ({ loadGuidedComparisonEvidence: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/models/guided-comparison-results", () => ({ buildGuidedComparisonResults: vi.fn().mockReturnValue([]) }));
import { authorizeBcaProject } from "@/lib/bca/workbench/access";
import BcaPage from "@/app/(app)/grants/bca/[projectId]/page";

function query(result: { data: unknown; error: unknown }) {
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: bcaActorId } } });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser }, from: mocks.from });
});
it("reads the complete scope projection through route-local actor, workspace and write checks", async () => {
  const project = query({ data: bcaProjectRow(), error: null });
  const membership = query({ data: { workspace_id: bcaProjectRow().workspace_id, role: "viewer" }, error: null });
  mocks.from.mockImplementation(table => table === "projects" ? project : membership);
  expect((await authorizeBcaProject(bcaProjectId, false)).error).toBeUndefined();
  expect((await authorizeBcaProject(bcaProjectId, true)).error?.status).toBe(403);
  expect(project.select).toHaveBeenCalledWith(BCA_PROJECT_PROJECTION);
  expect(BCA_PROJECT_PROJECTION).toBe(`id, workspace_id, name, updated_at, jurisdiction_context, ${PROJECT_PLACE_SCOPE_COLUMNS}`);
  expect(BCA_PROJECT_PROJECTION).not.toContain("place_geometry_geojson");
  expect(project.eq).toHaveBeenCalledWith("id", bcaProjectId);
  expect(membership.select).toHaveBeenCalledWith("workspace_id, role");
  expect(membership.eq).toHaveBeenCalledWith("workspace_id", bcaProjectRow().workspace_id);
  expect(membership.eq).toHaveBeenCalledWith("user_id", bcaActorId);
  mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
  expect((await authorizeBcaProject(bcaProjectId, false)).error?.status).toBe(401);
});
it("passes the actual project snapshot from the server page with the same full projection", async () => {
  const project = query({ data: bcaProjectRow(), error: null });
  const membership = query({ data: { role: "member" }, error: null });
  const sets = query({ data: [], error: null });
  mocks.from.mockImplementation(table => table === "projects" ? project : table === "workspace_members" ? membership : sets);
  const page = await BcaPage({ params: Promise.resolve({ projectId: bcaProjectId }) }) as ReactElement<{ projectId: string; projectPlace: BcaProjectPlaceRead }>;
  expect(project.select).toHaveBeenCalledWith(BCA_PROJECT_PROJECTION);
  expect(project.eq).toHaveBeenCalledWith("id", bcaProjectId);
  expect(membership.eq).toHaveBeenCalledWith("workspace_id", bcaProjectRow().workspace_id);
  expect(membership.eq).toHaveBeenCalledWith("user_id", bcaActorId);
  expect(page.props.projectId).toBe(bcaProjectId);
  expect(page.props.projectPlace).toMatchObject({ status: "available", snapshot: { projectId: bcaProjectId,
    projectUpdatedAt: bcaProjectRow().updated_at, status: "missing" } });
});
