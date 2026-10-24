import { clearedProjectPlace } from "@/lib/projects/project-place";
import { readBcaProjectPlace } from "@/lib/bca/workbench/project-place";

export const bcaProjectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const bcaActorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export function bcaProjectRow() {
  return { ...clearedProjectPlace(), id: bcaProjectId, workspace_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    name: "Synthetic project", updated_at: "2026-10-19T01:02:03.123456+00:00", jurisdiction_context: null };
}
export function bcaProjectPlace() {
  const read = readBcaProjectPlace(bcaProjectId, bcaProjectRow());
  if (read.status !== "available") throw new Error("Synthetic scope fixture is invalid");
  return read.snapshot;
}
