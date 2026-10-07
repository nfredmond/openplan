# Creation, context and stop recovery in T3

October 7, 2026. Bounded synthetic creation and context journeys pass in T3
preview. They find one mobile layout defect, corrected in `c3184a7e`.
This continues the [creator](CREATION_WORKFLOW.md), [context editor](CONTEXT_EDITOR.md)
and [plan-kind connections](PLAN_KIND_CONNECTIONS.md). M1 and V1 remain open.

## Created plan and retained authority

Navigation begins at the authenticated dashboard, follows Land Use Plans and
uses the displayed creator. The production application is `4e0a373e`, served
from the owned plan-kind worktree on port 3498 against isolated API 29821.
Migrations 2 through 11 are already installed. No migration probe is replayed.

The form selects the California checklist family and Specific plan. Changing
plan kind clears an earlier review acknowledgment. An uploaded synthetic WGS84
polygon identifies the study area. Separate fields identify a synthetic city
body and a synthetic tribal consultation body. The latter's jurisdiction remains
unassessed. The configured checklist refuses unresolved applicability before
sending a request. A staff assessment then selects only the city body and retains
the entered official source URL. This tests retention and selection, not a legal
finding, actual consultation or counsel approval.

Keyboard Space checks the review box. A scoped browser fetch wrapper consumes
the real creation 201 response and simulates a lost reply. The pending command
remains visible. Explicit retry sends identical bytes, receives 200 with
`replayed: true`, and opens the original plan. Native reads find one creation
command, one plan, one version and five specific-plan sections. The uploaded
area has no inferred country, state, place kind or jurisdiction reference.

The [desktop form](creation-context-acceptance/creation-desktop.png) and
[mobile authorities](creation-context-acceptance/creation-authorities-mobile.png)
retain the visible distinction. A real 1,720-byte creation draft downloads to
T3's artifact directory. Its bytes match the captured browser Blob.

## Context recovery and mobile correction

The saved plan opens its context editor. Keeping the saved area preserves its
boundary, label and source identity. Editing the consultation role downloads a
1,687-byte context draft, then sends the displayed save request. A second scoped
wrapper consumes the native 201 reply and simulates its loss. Exact retry returns
200 and the original receipt. The draft advances from revision 5 to 6 once.
One context command retains the changed assessment; both bodies and the study
area remain present.

Supplying the actual downloaded bytes to the displayed file input restores the
older context draft without a POST. Its original context hash remains retained.
Save and the reviewed-assessment action stay disabled until explicit review.
This exercises a browser File and the import handler, not the operating-system
file picker. Dirty-context messaging also appears, but this fixture lacks other
freeze requirements, so it does not independently prove the context-only freeze
gate.

The [before image](creation-context-acceptance/context-before.png) shows the
reviewed-assessment button ending at x=400.8 in a 390px viewport. The panel ends
at x=352.8. Commit `c3184a7e` gives context buttons wrapping labels, bounded width
and a 40px minimum height. It changes no request or permission behavior. The
[corrected image](creation-context-acceptance/context-fixed-mobile.png) places
the button at x=319.5 with a 57.3px height.

The first attempted reload encounters the unsaved-draft guard. The new server's
health response alone does not identify the still-open document. Using the actual
"Keep draft copy and use saved context" control preserves the draft. A subsequent
navigation clears the old page globals and loads the corrected classes. The
health response reports the expected 12-character commit. Reimport, keyboard
review and the reviewed-assessment action send no context POST. The original
hashes remain in archived copies. Returning to saved context leaves three
archived drafts and no pending context request. The
[desktop confirmation](creation-context-acceptance/context-saved-desktop.png)
shows the saved-context notice.

## Stopped creation request

On `c3184a7e`, real navigation returns to the creator. A separate synthetic
neutral draft keeps its authority unresolved. The first submission omits the
body type and is refused before transport. Entering "Not assessed" resolves
that input omission and clears review, which is acknowledged again.

A scoped wrapper withholds this new creation request before transport. The
browser retains its pending bytes. Clicking "Stop this creation request" sends
the stop command; its native 200 cancellation reply is consumed and dropped.
The [mobile pending state](creation-context-acceptance/stop-lost-reply-mobile.png)
offers "Retry stopping this request" and no creation retry. Browser storage
retains `stopRequested: true`. Keyboard Enter sends the same bytes and receives
200 cancellation again.

The [confirmed mobile state](creation-context-acceptance/stop-confirmed-mobile.png)
and [desktop restored copy](creation-context-acceptance/stop-restored-desktop.png)
show the stopped record. Restoring its draft creates a new local instance with
identical fields, no new request and review unchecked. Native read-only SQL finds
one cancellation, zero creation commands and zero plans for this command/title.
No stopped command or earlier one-shot producer is rerun to manufacture evidence.
Reload with a pending stop and the already-created stop branch remain separate
browser acceptance cases.

## Checks and remaining limits

The [verification record](creation-context-acceptance/verification.json) retains
artifact hashes, source identities and limits. The
[record checker](creation-context-acceptance/verify-records.py) reads private
journals without writes. Its [controls](creation-context-acceptance/record-controls.json)
pass 23 observations and a harmless added note, then detect 23 targeted altered
observations. These are evidence controls, not fresh product mutations. Its first
run incorrectly expects a full health SHA; the actual health contract returns
12 characters. A missing-command fault also exposed an unchecked list access in
the checker. Both are corrected and all controls rerun. Neither changes the app.

The existing [53 focused component tests](creation-context-acceptance/focused-tests.log),
changed-file ESLint and [production build](creation-context-acceptance/build-status.json)
pass. Tests run with one worker; the build runs alone under an 8 GiB ceiling.
The [server record](creation-context-acceptance/server-status.json) confirms cwd,
a 246,407,168-byte memory peak, normal stop and clear port 3498. The earlier BCA
service remains stopped after its separate 5 GiB OOM failure. Its partial test
log is not a passing suite.

T3 snapshots report no added console entries during these journeys. Bounded
output omits four historical entries from preview startup and earlier server
stops. Tool corrections include the supported `Space` key spelling and a native
context-journal projection using `saved_context`, not a nonexistent `receipt`.
No product guard is weakened. Raw private journals remain outside Git.

These synthetic agent journeys do not establish practitioner or counsel
acceptance, all geography cases, screen-reader or all-browser behavior, frozen
edition and publication presentation, or scientific validity. Current GitHub
checks, main integration and release disposition remain separate work.

The subsequent [checklist wording correction](CONTEXT_COPY_CI.md) retains a
full-QA failure, unchanged copy guard, corrected sentence and its own build and
T3 rendering evidence. It does not relabel the earlier source-specific journey.
