---
title: 2026-04-18 Engagement + project-control-room worktree reconciliation
date: 2026-04-18
phase: Phase F (forward-motion plan)
status: reconciled
---

# 2026-04-18 Engagement + project-control-room worktree reconciliation

## Verdict

Both remaining worktrees removed. Neither held work that should land in
`main` — status-lane's content was already merged under a different SHA,
and project-control-room represents an abandoned broader-scope design
that `main` deliberately narrowed.

## Worktree 1 — `openplan-status-lane`

**Location:** `/home/narford/.openclaw/workspace/openplan-status-lane`
**Tip:** `c876fca` (detached HEAD)
**Subject:** "fix: stabilize report packet and engagement surfaces"

**Diff summary vs `origin/main`:** 17 files, +333/-88 across
programs, reports, auth, and engagement surfaces.

**Evidence it was already merged.** `main` contains commit `52203ff`
with the identical subject line "fix: stabilize report packet and
engagement surfaces." The worktree commit is from an earlier pass of
the same work; the content landed under a different SHA during the
2026-04-16 integration program.

**Untracked files present:** `.codex`, `openplan/.codex`, `openplan/tmp/`
— these are local editor / runtime artifacts, not in-progress work.

**Decision:** Discard. `git worktree remove` with no cherry-pick.

## Worktree 2 — `openplan-project-control-room`

**Location:** `/home/narford/.openclaw/workspace/worktrees/openplan-project-control-room`
**Branch:** `feat/project-control-room-summary`
**Tip:** `2d1c2a0`
**Subject:** "feat: add project control room summary"

**Diff summary vs `origin/main`:** 4 files, +647/-23, centered on
`src/lib/projects/controls.ts` + related UI.

**Design divergence.** The worktree's `controls.ts` (272 lines, 16
exports) proposes a broad "control room" data model:
`ProjectRiskRecordLike`, `ProjectIssueRecordLike`,
`ProjectDecisionRecordLike`, `ProjectMeetingRecordLike`,
`ProjectDatasetRecordLike`, `ProjectReportRecordLike`,
`ProjectStageGateSummaryLike`, `ProjectControlRoomSummaryInput`,
`ProjectControlRoomSummary`, `formatProjectControlRoomSource`.

`main`'s `controls.ts` (336 lines, 7 exports) made a deliberately
narrower design choice — a deadlines-focused summary:
`ProjectMilestoneRecordLike`, `ProjectSubmittalRecordLike`,
`ProjectInvoiceControlRecordLike`, `ProjectReportControlSummaryLike`,
`ProjectControlDeadlineItem`, `ProjectControlsSummary`,
`buildProjectControlsSummary`.

**Interpretation.** Main is not behind the worktree — it is a
different design. The broader "control room" direction (risks,
issues, decisions, meetings, datasets as first-class) was
explicitly narrowed in `main` to deadlines-first. Re-introducing
the worktree's model would re-expand scope in a direction the
project already moved away from.

**Decision:** Discard. Delete branch `feat/project-control-room-summary`.

## Actions taken

```
git worktree remove /home/narford/.openclaw/workspace/openplan-status-lane
git worktree remove /home/narford/.openclaw/workspace/worktrees/openplan-project-control-room
git branch -D feat/project-control-room-summary
```

The status-lane worktree was on a detached HEAD — no branch to
delete. The project-control-room branch required `-D` because it
was never merged.

## Final worktree state

Only the primary worktree remains:

```
/home/narford/.openclaw/workspace/openplan  [main]
```

The eight 2026-04-16 grants-batch worktrees were removed in
Phase A. Worktree hygiene is now clean.

## Pointers

- Plan: `.claude/plans/eager-munching-spark.md` (Phase F)
- Prior worktree cleanup: Phase A (no separate doc — executed via
  `git worktree remove` on already-merged grants batches)
- `main`'s narrower controls design:
  `src/lib/projects/controls.ts`
