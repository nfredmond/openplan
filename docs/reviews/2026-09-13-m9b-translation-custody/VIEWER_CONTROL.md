# Private history entry point correction

Do not tag the initial v0.58.0 candidate1b0783ca. Its CI, shuffled, RLS, workers
and upgrade checks passed, but final source review found that viewers were offered
the private-history button even though the staff-only read route correctly
returned403. That is a visible permission mismatch. No private history exposure
was observed. The initial candidate was never tagged or published.

Correction3397252c shows the control only when the panel's existing canWrite
permission is true, matching the route's engagement.write permission. The new
viewer test fails before the fix while its staff control passes. Afterward all49
focused panel/history/route tests pass. A harmless comment survives; forcing the
control visible fails the viewer case, and hiding it from everyone fails the
staff case. See history-viewer-controls.json. Focused changed-file lint passes.
No database migration or route permission changed.

Real browser acceptance is in progress with the identified checkout on3260.
The script creates a synthetic viewer via the normal manual-invitation and
signup screens, preserving existing users' roles. It must verify staff history
reachability, absence of the viewer control, actual viewer HTTP403 and no leaked
history at desktop1440 and390px, then inspect screenshots/console. Raw scripts
and captures are private in response-write-probe-20260913. No invitation email
is sent by this workflow.

The first launch accidentally used the default dev bundler, which rejected the
shared node_modules symlink and exited. The owned webpack launch succeeded and
which-openplan.sh confirmed3397252c. The first browser script expected a signup
link after opening an invitation; the real route redirects directly to signup.
An archive glob then included a directory, preventing that script edit and
causing an unchanged second attempt. Both are retained failed runner attempts,
not passing browser evidence. The third attempt uses the corrected expectation.

After browser acceptance, stop only the owned dev server, run applicable final
QA/shuffle, update release evidence and push directly to main. Inspect CI on the
new release commit before tagging v0.58.0. Initial candidate CI cannot stand in
for the new control. The next unreleased translation-write reproduction is
78333d50 and its NEXT.md preserves the broader remaining work.


## Completed browser acceptance

The final invitation/signup/join journey passed for a new synthetic viewer and
the existing owner on identified3397252c. At1440 and390px, the viewer has no
history entry point, a direct history request returns403 without history data,
and the owner reaches the original/corrected/withdrawn records by keyboard.
Both widths have no horizontal overflow. Header, role notice and staff history
captures were inspected. See history-viewer-browser.json for results and hashes.

The final console contains the two deliberate403 requests and three unused
preload warnings on the staff page, with no page exceptions. Cancelled map and
first-effect history requests are retained separately. An additional runner
correction selected campaign cards by their nested heading because their full
accessible link name also includes status/metadata. The first successful run
was repeated to capture the header and role notice rather than the middle of
the long language list. No application change followed3397252c.

The owned webpack server1590313 was stopped after acceptance. Final local QA
and shuffled checks are next, then corrected main CI and publication. Existing
local database/worker and migration328 evidence remains unchanged by this
UI-only correction. The prior release candidate's18-minute CI is not a failure;
it passed, and tagging was held for this demonstrated permission mismatch.
