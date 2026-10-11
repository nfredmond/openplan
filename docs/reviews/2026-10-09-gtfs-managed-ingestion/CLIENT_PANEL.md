# Retained planner import progress

October 10 candidate interface. All four existing import doors use retained
requests when this installation enables managed ingestion. The operational
switch remains opt-in. Candidate migrations 28 through 31 are not released.

## Planner behavior

Before a URL, catalog, ZIP or refresh submission leaves the browser, its exact
intent and request UUID are saved under installation, workspace and session
actor. Browser storage failure prevents an untracked request. ZIP bytes are
not stored in browser history. A 202 reply does not announce completion or
adoption. Scoped committed reads distinguish queued processing, unavailable
progress, unconfirmed admission, failure, cancellation, ready review and current
use. Polling reads without automatically repeating writes or decisions.

A planner can recover the server's saved input with the original request UUID.
If it remains unavailable, an explicit resupply sends the original saved intent;
a ZIP request requires its original file. Terminal versions cannot restart under
the same identity. A fresh import keeps its bytes and version separate. Browser
record removal neither cancels processing nor retracts a decision.

Workspace members can open recent versions or older per-feed history without
the original submitter's browser record. This read does not impersonate that
submitter or reconstruct their intent. Legacy versions retain their registry
history; unavailable managed progress does not become empty transit service. Missing current and historical
counts appear as not recorded. Actually recorded zero counts remain zero.

Completed review reads actual parser route and stop counts, not derived service
rows. It binds adoption to the exact completed version and current predecessor.
A reduction greater than 20 percent requires explicit acceptance. Adoption and
cancellation retain exact commands before sending. Lost replies preserve those
commands for an explicit identical replay. Confirmation validates the exact
receipt, then reads current state separately. Historical adoption receipts do
not imply current use. Viewers can read review and cannot issue decisions.

Controller disposal ends browser transport and prevents late account or
workspace replies from appearing in the next scope. Newer progress reads
supersede older reads. Both HTTP acknowledgement and JSON bodies are bounded;
stalled or oversized responses remain unavailable. An enabled but misconfigured
worker cannot fall back to untracked synchronous imports.

## Checks and limits

[Controlled checks](client-panel-controls.json) retain baseline, harmless and
restored passes and 48 intended failures. These exercise identity before
transmission, same-input recovery, exact UUID replay, terminal refusals, current
roles, progress scope, stale responses, exact decision receipts, body bounds,
transport deadlines, shrinkage acceptance, all four import doors, private
configuration exclusion and the actual Data Hub mount. Seven additional broken
fallbacks fail when they turn missing counts into zero, while recorded zeros
remain a positive control. Mutation edits restore
in `finally` without resetting unrelated work.

The source mount inventory checks the session actor and workspace actually
passed to the panel. It does not establish rendered navigation. Component tests
use controlled HTTP, browser storage and DOM events. They do not establish T3
screenshots, desktop or 390px usability, actual app-cookie authorization,
physical input devices, native file selection, usable downloaded artifacts or
practicing-planner acceptance.

[Final regression](client-panel-tests.json) passes 70 files: 1,640 tests pass,
17 live-database cases are skipped and none fail. Scoped TypeScript and
changed-file lint pass. All expensive checks run serially under 1 GiB limits.
The regression peaks at 402.5 MiB. Browser
preparation is separate unfinished work. Installed worker CLI operation,
complete database/Storage/private-file restore, capacity, live application roles,
identified-build T3 service-coverage/project-geography journeys, GitHub CI,
integration and release verification remain open. No scientific claim changes.
