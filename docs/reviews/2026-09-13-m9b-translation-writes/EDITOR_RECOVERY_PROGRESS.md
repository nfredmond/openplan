# Translation editor recovery, September 13, 2026

This continues `3dab47cc` in the owned translation-command-workflow checkout.
It is still unfinished development, not a release or a main merge. The old
usage-reset handoff remains historical; start here on the next continuation.

## Changed behavior and defects found

The earlier unsent-draft remount failure now completes in real Chrome. An unsent
proposal retains its exact words and the source/translation version it started
from, even after a reload and another editor's correction. A stale proposal is
refused, current wording is shown alongside the retained copies, and an explicit
review reopens it against that newly observed version with a new request identity.

A further regression test reproduced another loss: accepting or withdrawing the
saved copy discarded a different unsaved draft in the same field. Both cases
failed on the old code with the original wording in place of the proposed draft.
Confirmation now clears only the matching saved draft. Newer words, source,
identity, revision, reason and other-language drafts survive delayed replies.

Screenshot inspection caught recovery buttons spilling outside their panel at
390px even though document width equalled viewport width. Recovery buttons now
wrap within the available space. The browser assertion measures each button
against its own panel. Source availability is now described as availability for
translation, not as proof that a draft campaign was published.

## Evidence and its boundaries

Six focused suites completed with 135 passing tests. TypeScript and changed-file
ESLint completed with exit 0. An initial lint command used the repository root
instead of the app package and exited 2; the package-root invocation is the actual
lint evidence. New tests are not evidence for unrelated workflow guards.

`prove-translation-draft-custody.py` produced 32 expected outcomes: baseline and
three harmless comments survived; 28 targeted changes failed their named JSON
assertions. Checks cover raw text, damaged/other-scope copies, original-address
consistency, duplicate drafts, write/archive/removal failures, concurrent changes
during archival, remount retention, frozen starting versions and delayed-save
cleanup. Source hashes match the restored files. The first runner preparation
refused an ambiguous replacement before changing source; it was narrowed to the
reader. These checks use jsdom and mocked editor HTTP, not installed SQL or real
browser storage failures. Other new write-recovery/UI guards still need controls.

The identified webpack server at 127.0.0.1:3260 served this owned checkout.
`which-openplan.sh` verified the listening process; exact application source hashes
are in `translation-editor-browser-evidence.json`. Main remained `88fb20b6` with
CI and RLS successful when checked; that is not CI for these development edits.

The final 1440px and 390px journeys entered through sign-in, Engagement, campaign
creation and Setup. They used keyboard actions, saved raw original wording,
aborted its acknowledgement, reloaded, replayed the identical request, required
a correction reason, saved a correction, reloaded an unsent draft, made a
competing browser correction, observed a stale-write refusal, reviewed current
copies, archived/reopened the proposal, saved a new revision, withdrew and
recreated it. History selection exposed the withdrawn original; all six retained
history records and the original record were checked. Downloaded archived request
bytes matched their local retained SHA-256 values. Screenshots were inspected.

The first rerun completed writes but selected the recreated history entry while
the test searched for the original. The runner now selects the original retained
identity using the visible history chooser. That failure did not establish loss.
Console inspection found the deliberately interrupted command and 409 conflict,
with no page exceptions. Other recorded aborted reads accompanied navigation and
refresh; they are preserved in the private artifacts, not erased from the record.

The harmless layout control survived both journeys. Forcing recovery buttons to
1000px at 390px failed the panel-bounds assertion after the competing correction.
The browser runner now executes under a Python finally block that revokes its
temporary database grant even if Node exits abruptly. A normal zero-exit control
and an abrupt exit 23 both revoked the grant and retained their actual exit codes.
An older cleanup summary filename was overwritten by the later mutation run;
its copied result was correctly renamed as post-overflow, not used as the
successful journey's cleanup record. Current scripts use distinct output names.

The app stack is still the explicitly disposable
`supabase_db_openplan-restore-target-2026091050`, at migration 330 through
20261014000011. Authenticated command EXECUTE is revoked outside the contained
browser run. No demo, original checkout, account credentials or reminder
constraint was changed. Browser fixtures are synthetic and retained locally.

## Continue from here

Recheck ownership and the server before opening another browser. The own webpack
server was still running at this checkpoint; browser/test jobs completed. Do not
assume tool handles survive a reset. Start with this file and NEXT.md, not the old
v0.47/v0.48 release prompt. v0.58.0 is already published.

Complete remaining write-recovery guards, malformed/quota/interruption browser
cases and private-role access. Review unsaved-draft archival on read/write failure
before calling that recovery complete. The new accept/withdraw draft protection
has component and targeted mutation evidence, not a new machine-acceptance browser
journey. Saved command reasons and exact source still need to be exposed through
the private history reader/UI without inventing missing legacy facts.

Generation, retained publication, durable attempt/spend accounting, cache
provenance and retirement of legacy direct producers remain open. The command
migration deliberately keeps its ordinary grant revoked until integration is
complete. Full QA/shuffle, isolated RLS, applicable worker/upgrade/restore checks
and final main CI are still required before a release. Continue the full M9b and
V1 roadmap afterward; neither is complete and no human review is a release gate.
