# Checklist recovery HTTP and T3 evidence

October 7, 2026. This continues the [staff recovery control](RULE_RECONCILIATION_UI.md).
Authenticated HTTP and a bounded T3 recovery journey now pass. The mobile
journey finds and corrects one layout defect. This does not close M1 or V1.

## Native HTTP and interruption custody

Production build `3f1b6a88` runs against the isolated API on port 29821 with
migrations 2 through 11 already installed. No migration probe is replayed.
A new synthetic workspace receives a plan through the creation API. The content
API changes its initial section to a policy and adds an unkeyed section. Both
authored nodes must survive reconciliation, including the policy's evidence URL.
The plan uses the local-unconfigured checklist and explicitly unresolved authority.

The two recorded phases make 30 HTTP requests. Wrong actor, workspace, origin
and assistant headers return 403. Stale revision and descriptor hash return 409.
A deliberately dropped 201 reply leaves the exact request available. Explicit
retry and recovery-copy recheck return the original receipt without another
section. A changed byte returns 409. Every reconciliation response uses private,
no-store caching.

The first phase stops at `OP409` when fixture setup tries to demote the workspace's
only owner. The owner-floor safeguard is working. Its journal remains interrupted.
A separate continuation first verifies the existing nodes, revision, command and
membership. It creates a second synthetic owner, then proves that replay fails
with 403 after the original actor becomes a viewer. It restores that actor's
owner role. No completed producer or command is blindly rerun.

Two simultaneous copies of one command return 201 and 409; explicit retry returns
200. Two different commands for the same revision also return 201 and 409.
Native reads find three command records for three successful reconciliation
operations. Each operation adds one keyed section. The two authored nodes remain
byte-equivalent in the selected content fields. Synthetic fixtures are retained.

The [record controls](rule-reconciliation-acceptance/record-controls.json) pass
the baseline and harmless control and detect 24 altered observations. The first
content-kind fault accidentally targeted an already-unmodified section and
survived. The corrected fault selects the policy explicitly and fails for the
intended reason. These are controls on recorded evidence, not new product
mutation results. Earlier backend and mounted-UI mutation reports remain separate.
The checker requires the private journals in its own directory; it performs no
network or database writes.

## T3 journey and mobile correction

T3 reports an attached preview again and saves screenshots. On the identified
`3f1b6a88` server, navigation starts at the authenticated dashboard, follows
Land Use Plans, and opens the synthetic plan card. Native DOM link clicks are
used after focused link clicks return without changing the page. There is no
alternative browser.

A separate, journaled content-API request removes the blank section to prepare
the recovery case. At 390 by 844 CSS pixels, entering unsaved section text
disables checklist review. Restoring the original text enables review again.
The displayed checkbox and apply button submit the reviewed request. A scoped
fetch wrapper consumes the real 201 response and simulates a lost reply. The
browser retains its pending command and displays recovery controls.

The [before image](rule-reconciliation-acceptance/mobile-before.png) shows a
long recovery button extending to x=414.5 in a 390px viewport. Commit `4e0a373e`
allows the control's button labels to wrap, bounds their width to the panel,
and retains a 40px minimum height. It changes no request or permission behavior.
The [fixed mobile image](rule-reconciliation-acceptance/mobile-fixed.png) and
measured bounds place both long buttons inside the panel at x=352.8.

The download button produces a real 504-byte JSON file in T3's browser artifacts.
Its bytes match the browser Blob and the exact submitted command. Supplying those
downloaded bytes to the visible file input restores the request without sending
it. This exercises the import handler through a browser File; it does not prove
the operating-system file picker. Explicit retry returns 200 with the same
section ID and revision. Pending-copy cleanup leaves no pending request.

After rebuilding `4e0a373e`, reload sends no reconciliation request. Preserving
and restoring a local copy also send nothing. Keyboard Enter on the focused
retry button returns the original 200 receipt. The draft stays at revision 10
with three content nodes. One archived recovery copy remains. The
[mobile confirmation](rule-reconciliation-acceptance/mobile-confirmed.png) and
[desktop confirmation](rule-reconciliation-acceptance/desktop-confirmed.png)
show that outcome. The two original authored nodes and evidence URL remain intact.

Console review identifies four historical entries, all before this journey:
two Electron preview startup errors and two connection refusals during an earlier
server stop. The current journey adds no reported console entries. Snapshot
output is bounded and later snapshots omit those same four historical records.

## Checks and remaining scope

The [verification record](rule-reconciliation-acceptance/verification.json)
retains build identity, file hashes, response counts and explicit limits.
The [47 focused tests](rule-reconciliation-acceptance/focused-tests.log),
changed-file ESLint and the [production build](rule-reconciliation-acceptance/build-status.json)
pass. The build runs alone under an 8 GiB ceiling and reports a 5.6 GiB peak.
The owned server's cwd and health identify the checkout and `4e0a373e` build.
Its peak is 272,289,792 bytes. It is stopped after acceptance, and port 3498 is clear.

The separate BCA full-test service remains stopped after reaching its 5 GiB
memory limit. Its partial log is not a passing suite. No protected BCA,
engagement or demonstration service is restarted or stopped by this work.

This is one synthetic agent journey with unresolved local authority. It does
not prove complete plan creation, legal checklist selection, context authoring,
frozen-edition/publication presentation, all-browser storage, screen-reader
access, practitioner acceptance or scientific validity. Those M1 and V1
boundaries remain open. GitHub checks on the pushed checkpoint remain required
before integration; this note is not a release declaration.
