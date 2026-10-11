// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "@/test/helpers/source-text";
describe("managed transit Data Hub mount", () => {
 it("binds the visible panel to the current workspace and session actor", () => {
  const source = stripSourceComments(readFileSync("src/app/(app)/data-hub/page.tsx", "utf8"));
  const panel = source.match(/<GtfsIngestPanel\b[\s\S]*?\/>/)?.[0]; expect(panel).toBeDefined();
  expect(panel).toMatch(/managed=\{gtfsManagedClientMode\(workspaceId, user\.id\)\}/);
  expect(panel).toContain('key={`transit:${workspaceId}:${user.id}`}');
  expect(panel).toContain("readOnly={isReadOnlyWorkspaceRole(membership.role)}");
 });
 it("projects adopted version identity and refreshes the dependent equity read", () => {
  const source = stripSourceComments(readFileSync("src/app/(app)/data-hub/page.tsx", "utf8"));
  expect(source).toContain("id, feed_id, workspace_id, service_start_date");
  expect(source).toContain(".map(version => version.id).sort()");
  expect(source).toContain('import { randomUUID } from "node:crypto"');
  expect(source).toContain("read: randomUUID(),");
  const equity = source.match(/<TitleViServiceEquityPanel\b[\s\S]*?\/>/)?.[0];
  expect(equity).toContain("feedVersionRevision={transitFeedRevision}");
  expect(equity).toContain('key={`equity:${workspaceId}:${user.id}`}');
 });
 it("keeps sibling transit and equity identity distinct during server refresh", () => {
  const source = stripSourceComments(readFileSync("src/app/(app)/data-hub/page.tsx", "utf8"));
  const transit = source.match(/<GtfsIngestPanel\b[\s\S]*?\/>/)?.[0];
  const equity = source.match(/<TitleViServiceEquityPanel\b[\s\S]*?\/>/)?.[0];
  const transitKey = transit?.match(/key=\{(`[^`]+`)\}/)?.[1];
  const equityKey = equity?.match(/key=\{(`[^`]+`)\}/)?.[1];
  expect(transitKey).toBeDefined();
  expect(equityKey).toBeDefined();
  expect(transitKey).not.toBe(equityKey);
 });
});
