import { describe, expect, it } from "vitest";

import { keepLinksInsideWorkspace } from "@/lib/rtp/link-workspace-scope";

/**
 * The public plan pages publish what this keeps (KI-2026-11-02-053). It must
 * fail closed: a project whose workspace was not read is treated as another
 * workspace's, so a projection that loses `projects.workspace_id` empties the
 * project lists instead of publishing every embed.
 */
describe("keepLinksInsideWorkspace", () => {
  const WORKSPACE = "workspace-1";

  it("keeps this workspace's projects and drops another workspace's", () => {
    const result = keepLinksInsideWorkspace(
      [
        { id: "own", projects: { workspace_id: WORKSPACE } },
        { id: "own-array", projects: [{ workspace_id: WORKSPACE }] },
        { id: "foreign", projects: { workspace_id: "workspace-2" } },
        { id: "foreign-array", projects: [{ workspace_id: "workspace-2" }] },
      ],
      WORKSPACE
    );

    expect(result.rows.map((row) => row.id)).toEqual(["own", "own-array"]);
    expect(result.dropped).toBe(2);
  });

  it("drops a project whose workspace was not read", () => {
    const result = keepLinksInsideWorkspace(
      [
        { id: "missing", projects: { id: "p1" } },
        { id: "null", projects: { workspace_id: null } },
      ],
      WORKSPACE
    );

    expect(result.rows).toEqual([]);
    expect(result.dropped).toBe(2);
  });

  it("keeps a row whose embed came back empty, which carries no project data", () => {
    const result = keepLinksInsideWorkspace(
      [
        { id: "empty", projects: null },
        { id: "empty-array", projects: [] },
      ],
      WORKSPACE
    );

    expect(result.rows.map((row) => row.id)).toEqual(["empty", "empty-array"]);
    expect(result.dropped).toBe(0);
  });
});
