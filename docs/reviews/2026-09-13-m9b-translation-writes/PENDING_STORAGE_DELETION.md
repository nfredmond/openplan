# Pending translation copies after storage changes

Continuation after `702e2449`, in the owned translation checkout. This is
unfinished M9b work and is separate from the header patch now on main at
`b330bcc8785dfbe54b6a591c7aafdf7ab321b8da`.

## Reproduced and repaired

Four new regression cases failed before the repair. A native storage refresh
could discard a known in-flight request if its stored copy was deleted or
corrupted, or replace the page's words with a differing valid payload under the
same request id. A refused request deleted before conflict review also vanished
before its words could be archived. This could unblock a new request while an
earlier dispatched request remained unconfirmed.

Recovery now compares every known page request with loaded storage and keeps
missing or differing copies in memory. The page's payload stays available for
download and exact retry. Differing stored bytes remain separately recoverable.
Storage disappearance is not treated as a server acknowledgement. A definite
refusal phase also survives a failed phase write and subsequent storage event.

Successful confirmation explicitly removes the matching memory copy before
refreshing recovery. Reopening a refused request first retains that page copy
and archives it, then removes its memory copy. This prevents both lost copies
and resurrection of confirmed or archived requests. The memory-only explanation
no longer says the attempt was never sent, since the storage failure can occur
after dispatch.

## Checks

Eight focused suites passed 140 tests. TypeScript and changed-file lint exited
zero. The recovery suite contains nine integrated hook cases. Its mutation runner
reported 13 expected outcomes: baseline plus two harmless survivors, and ten
targeted failures. They cover missing/replaced page copies, separate stored-copy
visibility, identical-content handling, retention before archiving, clearing
confirmed/archived memory, retaining definite refusal and truthful dispatch text.

The old clear-volatile-cache mutation now survives because the new page-memory
merge reconstructs that cache. It is explicitly retained as a harmless control;
it is no longer counted as a killed fault. The earlier mutation report remains
available in git history. The runner initially refused an ambiguous text match
after the same comparison was added at a second location; its target was made
specific before the final run. An initial regression invocation used the repo
root instead of the package root and did not run the tests; the corrected-root
run produced the four actual failures. Failed logs remain private.

These tests use jsdom, mocked HTTP and real Blob contents with anchor delivery
stubbed. They do not prove native storage event timing or browser downloads.
The expanded real browser runner is checking those separately at 1440 and 390px:
delete the retained request in another tab while withholding a successful server
response, download the page copy, lose another exact retry acknowledgement,
reload the re-retained request and recover the original server receipt. It then
continues through correction, conflict, archive, withdrawal and original history.
Both widths completed with child exit 0 and the command grant revoked. The
native-deletion downloads were independently rehashed and parsed against the
original requests; all three dispatch payloads matched. Original private history
remained after correction, withdrawal and recreation. Desktop and phone recovery
screens were inspected, including wrapped controls and proposed wording. Each
console had the two deliberately aborted requests and expected 409 refusal,
with no page exceptions. See pending-storage-deletion-evidence.json.

The first browser instrument failed while its route callback was still waiting
for the deletion notice. The main journey had no barrier requiring that callback
to finish before advancing. The corrected instrument brings the affected page
forward and awaits the callback; the first failure is retained and is not counted
as acceptance. A further injected error in the second callback now fails the
whole run with its explicit error, even after the first callback has resolved.
That control exited 1 as intended and revoked the temporary grant too. Native
corruption/replacement during dispatch were not separately exercised in Chrome;
those boundaries have the jsdom tests above.

## Release and next work

Header patch local gates and main landing are complete. Final jobs on exact
commit b330bcc8 are CI 34778941590, RLS 34778941592 and Upgrade 34778947466.
All three workflows and all their jobs passed before tagging. v0.58.1 was published
at 2026-09-13T20:05:51Z: https://github.com/nfredmond/openplan/releases/tag/v0.58.1. The patch
checkout is `/home/nathaniel/.local/state/openplan/workspace-switch-v0581-2026-09-13`.
Its production browser build on 3261 was candidate 1eef5f49; all application and
worker source is identical between that candidate and the final release commit.

The translation checkout's dev server is restarted on 3260. Identify it before
reuse. Its database remains `supabase_db_openplan-restore-target-2026091050` with
331 migrations; the ordinary command grant stays revoked outside the wrapper.
Do not downgrade/reset it or merge this unfinished branch to release the header.

Continue machine-acceptance journeys, durable generation, retained publication,
dispatch accounting, cache
provenance and legacy producer conversion. Full feature QA, shuffled, isolated
RLS, worker/upgrade/restore and final main CI still precede the translation
release. The full V1 contract remains active, with local/free operation, separate
scientific validation and no human-review release gate.
