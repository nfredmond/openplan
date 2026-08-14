import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { MyWorkBoard } from "@/components/my-work/my-work-board";
import { DEPARTED_ASSIGNEE_SENTENCE } from "@/lib/workspaces/roster";
import type { MyWorkScope } from "@/lib/my-work/types";
import type { ProjectAssigneeRoster } from "@/lib/projects/assignee-roster";
import { buildDb, loadSeededMyWork, ROSTER } from "./helpers/fake-my-work-tables";

/**
 * WHAT THE PLANNER ACTUALLY SEES — rendered from items the REAL loader built
 * over the seeded workspace, never from hand-written props.
 *
 * That distinction is this repository's recorded lesson and it is the whole
 * reason this file imports the fake rather than describing five items: a board
 * test fed a described fixture proves the renderer against a workspace the
 * product may not be able to produce. Here, if the loader stops emitting an
 * assignee id, or starts calling a settled invoice open, these assertions
 * change.
 *
 * MUTATION-VERIFIED (2026-08-11), each reverted after: rendering the departed
 * assignee as a blank instead of the shared sentence, dropping the scope
 * toggles from the empty state, and reporting an unreadable block as empty.
 */

async function renderBoard(
  options: {
    scope?: MyWorkScope;
    roster?: ProjectAssigneeRoster;
    failures?: Record<string, string>;
    isViewer?: boolean;
    empty?: boolean;
  } = {}
) {
  const { result } = await loadSeededMyWork({
    scope: options.scope,
    roster: options.roster ?? ROSTER,
    failures: options.failures,
    db: options.empty ? emptyDb() : undefined,
  });
  render(
    <MyWorkBoard
      scope={result.scope}
      items={result.items}
      perSource={result.perSource}
      limitPerSource={result.limitPerSource}
      readFailureSummary={result.reads.describe()}
      roster={options.roster ?? ROSTER}
      departedIncludedInUnassigned={result.departedIncludedInUnassigned}
      isViewer={options.isViewer ?? false}
    />
  );
  return result;
}

/** The same workspace with its projects but no records at all. */
function emptyDb() {
  const db = buildDb();
  for (const table of Object.keys(db)) {
    if (table !== "projects") db[table] = [];
  }
  return db;
}

function blockNamed(heading: string) {
  const title = screen.getByText(heading);
  const surface = title.closest("article");
  if (!surface) throw new Error(`no surface around "${heading}"`);
  return within(surface);
}

describe("my work — the board", () => {
  it("leads with what is overdue, and says so in words rather than in colour", async () => {
    await renderBoard();
    const dated = blockNamed("Dated work");

    expect(dated.getByText("Deliverable overdue")).toBeInTheDocument();
    expect(dated.getByText("Existing conditions memo")).toBeInTheDocument();
    expect(dated.getByText("Submittal due")).toBeInTheDocument();
    // The deep link goes to the record, not just to the project.
    expect(dated.getByText("Authorization packet").closest("a")?.getAttribute("href")).toContain(
      "#project-submittal-s-mine"
    );
  });

  it("names a departed member's work instead of leaving it blank", async () => {
    await renderBoard({ scope: "unassigned" });
    const dated = blockNamed("Dated work");

    // The row is present AND it says what happened to its owner. A blank chip
    // here would read as ordinary unassigned work and a stale name would be a
    // lie about the team.
    expect(dated.getByText("Traffic count summary")).toBeInTheDocument();
    expect(dated.getByText(DEPARTED_ASSIGNEE_SENTENCE)).toBeInTheDocument();
  });

  it("refuses to claim anything about assignees when the roster could not be read", async () => {
    await renderBoard({ scope: "all_projects", roster: { ok: false } });

    expect(
      screen.getAllByText("Assignee unavailable — the team roster could not be read").length
    ).toBeGreaterThan(0);
    // And it does not silently narrow "unassigned" without saying so.
    expect(screen.queryByText(DEPARTED_ASSIGNEE_SENTENCE)).toBeNull();
  });

  it("shows workspace deadlines with no owner attached to them", async () => {
    await renderBoard();
    const workspace = blockNamed("Shared deadlines");

    expect(workspace.getByText("Active transportation program call")).toBeInTheDocument();
    expect(workspace.getByText("Decision overdue")).toBeInTheDocument();
    expect(workspace.getByText("Invoice 2026-004")).toBeInTheDocument();
    // Nothing in this block carries an assignee chip of any kind.
    expect(workspace.queryByText(DEPARTED_ASSIGNEE_SENTENCE)).toBeNull();
    expect(workspace.queryByText("planner@example.gov")).toBeNull();
  });

  it("names the blocked project and the gate holding it", async () => {
    await renderBoard();
    const blocked = blockNamed("Blocked projects");

    // Twice: the block's row is titled with the project, and the row's chip
    // links to it — the item IS the project here, not a record inside it.
    expect(blocked.getAllByText("Corridor Rehabilitation").length).toBe(2);
    expect(blocked.getByText(/environmental_clearance/)).toBeInTheDocument();
    expect(blocked.getByText(/Cultural resources survey outstanding/)).toBeInTheDocument();
  });

  it("offers the other views from the empty state instead of stopping there", async () => {
    await renderBoard({ empty: true });
    const dated = blockNamed("Dated work");

    expect(dated.getByText("Nothing dated is assigned to you right now.")).toBeInTheDocument();
    // Nathaniel's decision: the empty state carries the toggles.
    expect(dated.getByText("Unassigned")).toBeInTheDocument();
    expect(dated.getByText("All my projects")).toBeInTheDocument();
    expect(dated.getByText("Unassigned").closest("a")?.getAttribute("href")).toBe(
      "/my-work?scope=unassigned"
    );
  });

  it("tells a viewer why their list is empty rather than leaving a blank panel", async () => {
    await renderBoard({ empty: true, isViewer: true });

    expect(
      screen.getByText(
        /Viewers can read everything here but are not given project work/
      )
    ).toBeInTheDocument();
    // A viewer still gets the workspace's deadlines block — it is the part of
    // this page a read-only role can act on.
    expect(screen.getByText("Shared deadlines")).toBeInTheDocument();
  });

  it("says a block is unavailable rather than empty when its read failed", async () => {
    await renderBoard({
      empty: false,
      failures: {
        project_deliverables: "permission denied",
        project_milestones: "permission denied",
        project_submittals: "permission denied",
      },
    });
    const dated = blockNamed("Dated work");

    expect(
      dated.getByText(/could not be read, so it is shown as unavailable rather than as empty/)
    ).toBeInTheDocument();
    expect(dated.queryByText("Nothing dated is assigned to you right now.")).toBeNull();
    // And the disclosure names the lanes, so the reader knows what to disbelieve.
    expect(screen.getByText(/could not read project deliverables/)).toBeInTheDocument();
  });

  it("names the migration when the assignee column is not deployed yet", async () => {
    await renderBoard({
      failures: {
        project_deliverables: "column project_deliverables.assignee_user_id does not exist",
      },
    });

    expect(screen.getByText(/20260811000006/)).toBeInTheDocument();
    // A pending migration is not an outage: it does not join the read-failure
    // sentence.
    expect(screen.queryByText(/could not read project deliverables/)).toBeNull();
  });
});
