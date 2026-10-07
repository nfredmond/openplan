# Checklist wording CI correction

October 7, 2026. PR #127 at `a6847575` fails one full-QA assertion.
[GitHub job 112923057192](https://github.com/nfredmond/openplan/actions/runs/37659490292/job/112923057192)
reports 18,847 passing tests, one failure and 1,544 skips. The
[failure excerpt](context-copy-ci/github-failure-excerpt.log) shows one additional
occurrence of "resolve" in planner-facing checklist text.

Commit `68cbd469` changes "resolve pending context changes" to "review pending
context changes". The guard and its baseline stay unchanged. The existing
[24 copy and control tests](context-copy-ci/focused-tests.log), changed-file
ESLint and the [production build](context-copy-ci/build-status.json) pass.
The original failure and corrected run cover this wording correction; no test,
authorization guard or product behavior changes.

T3 opens the observed created-plan link in a second preview tab because the
first tab correctly retains an unsaved restored creation draft. The new tab
loads the corrected sentence and reports commit `68cbd469be2d`. Temporary section
text makes the existing disabled-checklist explanation visible. The
[desktop](context-copy-ci/desktop.png) and [390px](context-copy-ci/mobile.png)
views show the full sentence; its right edge is x=352.8 on mobile. The text is
cleared through the form, and the clean-form status returns. No save action is
used. This bounded copy check does not repeat the earlier native recovery journey.

Snapshot output omits two console records, so this follow-up does not claim a
complete console review. The [owned server](context-copy-ci/server-status.json)
peaks at 292,913,152 bytes, stops normally, and leaves port 3498 clear. The build
runs alone under the 8 GiB ceiling. Full GitHub checks on the next pushed
checkpoint remain required. M1 and V1 acceptance remain open.
