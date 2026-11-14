import { expect, it, vi } from "vitest";
import { BCA_LATEST_VERSION_PROJECTION, loadLatestBcaVersion, type BcaLatestVersionClient } from "@/lib/bca/workbench/latest-version";
import { exampleBcaDocument, reviewBcaProjectPlace } from "@/lib/bca/workbench/document";
import { bcaProjectId, bcaProjectPlace } from "./fixtures/bca/project-place";

const versionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const document = reviewBcaProjectPlace(exampleBcaDocument(bcaProjectId), bcaProjectPlace());
function client(result: { data: unknown; error: unknown }) {
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
  for (const step of [chain.select, chain.eq, chain.order, chain.limit]) step.mockReturnValue(chain);
  const from = vi.fn().mockReturnValue(chain);
  return { db: { from } as unknown as BcaLatestVersionClient, from, chain };
}

it("reads the same newest row the report prints, with the fields the workbench opens", async () => {
  const row = { id: versionId, project_id: bcaProjectId, created_at: "2026-11-13T12:00:00Z", document_json: document };
  const { db, from, chain } = client({ data: [row], error: null });
  expect(await loadLatestBcaVersion(db, bcaProjectId)).toEqual({ status: "found", id: versionId, createdAt: row.created_at, document });
  expect(from).toHaveBeenCalledWith("project_bca_versions");
  expect(chain.select).toHaveBeenCalledWith(BCA_LATEST_VERSION_PROJECTION);
  expect(BCA_LATEST_VERSION_PROJECTION).toBe("id, project_id, created_at, document_json");
  expect(chain.eq).toHaveBeenCalledWith("project_id", bcaProjectId);
  expect(chain.order.mock.calls).toEqual([["created_at", { ascending: false }], ["id", { ascending: false }]]);
  expect(chain.limit).toHaveBeenCalledWith(1);
});

it("keeps none saved, a failed read and an unreadable document apart", async () => {
  expect(await loadLatestBcaVersion(client({ data: [], error: null }).db, bcaProjectId)).toEqual({ status: "none" });
  expect(await loadLatestBcaVersion(client({ data: null, error: { message: "timeout" } }).db, bcaProjectId)).toEqual({ status: "failed" });
  const other = { ...document, projectId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
  expect(await loadLatestBcaVersion(client({ data: [{ id: versionId, project_id: bcaProjectId, created_at: "2026-11-13T12:00:00Z",
    document_json: other }], error: null }).db, bcaProjectId)).toEqual({ status: "unreadable", createdAt: "2026-11-13T12:00:00Z" });
  expect(await loadLatestBcaVersion(client({ data: [{ id: versionId, project_id: bcaProjectId, created_at: null,
    document_json: { bad: true } }], error: null }).db, bcaProjectId)).toEqual({ status: "unreadable", createdAt: null });
});
