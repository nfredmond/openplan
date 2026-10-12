# Synthesis

**In flight.** Eighteen PRs (#201 to #218) were opened today. Six are merged: #201, #202, #203, #204, #206, #207. Twelve are open. Ten (#205, #208 to #216) are one Codex lane's stacked chain on a single worktree. #217 (agent orientation docs) and #218 (grant close-date fix) sit on main. Only #207 (Planner Agent knows today's date, merged) and #218 (grant drafts stop calling a closed call open, open) change what a planner sees. The rest is M3 recovery evidence, operator CLIs, disconnected aerial libraries and proof directories. None changes app behavior.

**Overlap.** No two open PRs touch the same product-code file. The stack shares appended doc files (README, ROADMAP, ledger, BACKUP guide), and #213, #214 and #216 share one workflow file. Merged out of order, they conflict. #218 and merged #207 both slice UTC instants to dates in separate routes, and both disagree with isDeadlinePast in deadlines.ts.

**Stale or abandoned.** gtfs-encryption-join-20261011 is abandoned, with no unique content. Of 123 worktrees, 119 have nothing unmerged but sit 40 to 1,600 commits behind main. Pruning is not done. The draft-custody branch sits at #216's head with no commits. The Opus review has no worktree, branch or PR.

**Merge hold.** Nathaniel holds all main merges until both the hosted relaunch and the independent Opus review are complete. #204 merged 26 seconds after the hold was posted. #206 merged under a recorded exception, and #217 says it will land under the same one. The Opus review has not started.

**Bot findings that matter.** Codex left P1 or P2 findings on twelve PRs. None has an answer. Confirmed: #207 (a Pacific planner from 17:00 to midnight is told a same-day deadline has passed), #218 (a call closing 09:00 UTC reads as "today" until midnight), #217 (CLAUDE.md duplicates guidance AGENTS.md says not to duplicate), and #211 (the OCR proof does not launch from its retained environment). #215 (capture runs even when docker stop fails) is also open.

**For the replan.** Absorb: one shared date helper (end of day for date-only values, instant comparison for timestamps) to cover #207, #218 and isDeadlinePast; the reproduced open defects (#212 admission loss on restart, #215 duplicate uploads on retry) into KNOWN_ISSUES.md; the operator CLIs into CHANGELOG.md. Drop: the per-PR dated paragraphs in ROADMAP.md (855 lines, 204 KB) and the ledger, the CLAUDE.md hunk of #217, and the 63-second cold-build claim in #206's body, which the tracked doc contradicts. Prune stale worktrees separately, after their lanes close.
