// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("managed transit Data Hub mount", () => {
 it("binds the visible panel to the current workspace and session actor", () => {
  const source = readFileSync("src/app/(app)/data-hub/page.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const panel = source.match(/<GtfsIngestPanel\b[\s\S]*?\/>/)?.[0]; expect(panel).toBeDefined();
  expect(panel).toMatch(/managed=\{gtfsManagedClientMode\(workspaceId, user\.id\)\}/);
  expect(panel).toContain('key={`${workspaceId}:${user.id}`}');
  expect(panel).toContain("readOnly={isReadOnlyWorkspaceRole(membership.role)}");
 });
});
