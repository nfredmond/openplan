# Transit review on the light-mode join, October 11

Frozen source `bf1f6ffa710b11b7f36747a676943edab667a4ae` joins main
`5ad451c577affc65fa0d9f5f7e37111c047d6b9b`. Its production build identifies
`W4maaz9jts1wco0KXcWbA`. The independently copied locked dependencies execute
native SQLite, esbuild and MapLibre checks. Only earlier build cache is reused.
The external branch join `a6e182636dff64290cb0fa6f955d9abe94e5c0a9` has the
same tree, `f9ec353e70dbd421bc4b7e88cd85f28e90a71475`. The observed browser
commit remains bf1; that identity is not relabeled as a6.

## Checks and build

[Selected checks](light-mode-join-20261011/light-mode-main-join-checks.json)
pass product direction, changed guard lint and 157 test files. There are 2,970
passed tests, 45 skipped and none failed. Deleted main tests are excluded using
the ACMR diff filter. This lane deletes no tests. The serial service uses 1 GiB,
no swap and one CPU, with a reported 553.3M peak.

[The actual-status build](light-mode-join-20261011/build-success.json) completes
140 pages in 175.092 seconds. It uses one worker and one CPU, a 6 GiB Node heap,
a 10 GiB service cap and no swap. Its largest sampled usage is 6,789,115,904
bytes; the journal rounds the peak to 6.3G. Earlier memory failures stay recorded.

## Identified T3 read

[Fresh observations](light-mode-join-20261011/candidate-adoption-production-browser.json)
and [ten inspected captures](light-mode-join-20261011/candidate-adoption-browser-artifacts.json)
follow native Dashboard, Data Hub, Projects, project, Travel modeling and model
navigation in light mode. Desktop is 1280 pixels; the responsive read is 390
CSS pixels with a desktop user agent. No physical phone acceptance follows.

CTA displays its exact completed version, 132 routes and 11,138 stops, ready for
review with no predecessor in use. Its registry says Not adopted. BART displays
its current version, 14 routes and 287 stops, and the historical-receipt caveat.
The cancelled TriMet version remains one terminal panel. CTA does not appear in
the model's adopted feed options. BART's selected feed disclosure names the exact
archive, checksum and schedule end. Each checked document matches its viewport
width. The inspected desktop feed capture replaces one initial capture that
showed the top of the model rather than the intended control.

The actual coverage POST sends the saved Oakland geometry, 60,606 serialized
bytes, with SHA-256 `007c5ce9a3bea160193427fe1e6f769c33c239b3b448cd9e40ab623d9acdd8fd`.
It returns 238 published stop-service rows, matching the fresh native envelope
query. This counts schedule rows, not distinct stops, exact polygon coverage or
observed operation. No adoption or model execution occurs. Native records match
before navigation, after the read and after controls.

The observer interval begins at 10:40:05.586 UTC and the health read ends at
10:44:45.703 UTC. No new application, console or observer error is recorded in
that interval. Three earlier Electron/instrumentation errors remain in the
historical record. A tool expression syntax error precedes the corrected async
health read; it does not establish an application error. Request-method capture
is added before a second actual coverage POST; the first observation remains.

[Observation controls](light-mode-join-20261011/candidate-adoption-browser-controls.json)
pass three positive and 46 targeted broken cases. Separate
[native scope controls](light-mode-join-20261011/candidate-adoption-native-scope-controls.json)
pass three positive, seven refusal and seven omitted-guard cases. These mutate
copies of observations or extracted guards, without app, database or capture
writes. The preview later reads inactive with no PID and success status. A
follow-on PID ownership check refuses because its process is gone; that
follow-on stops no other process. The stopping actor is not established.

## Remaining boundaries

This joins visual changes with the transit read, not current-head full CI,
scientific validation, practicing-planner acceptance or agency commissioning.
Earlier native RLS, archive and capacity proofs retain their original revisions.
Nathaniel confirms that the relaunch agent still owns hosted coordination.
Preserve its main-merge hold and the exact M28 through M31 schema-first handoff.
No hosted schema, deployment, demo, release or other lane process changes occur.
Continue independent installation and recovery work within existing M3.
