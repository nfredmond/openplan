# Report drafts must be saved before generation

The clean `a985cc8f` first-week run reproduced a report defect during Safety.
Two summary updates exceeded the unchanged 2,000-character server limit and
received generic 400 responses. Generate remained available and created a PDF
from the older saved summary after the first rejected save. The planner then
shortened the draft, saved the selected acquisition, and generated a replacement.
The original report and both artifacts remain retained.

Evidence is in first-week run `2026-09-05T19-31-47-121Z`, job `04-safety-case`,
finding `f2`. Report `2d541fcf-152b-495e-bda2-699492448822` generated artifact
`9ee98983-7c8c-4efd-9211-0bb0641f3ec3` at 20:09:41 UTC after the 20:09:28
rejected save. The later corrected artifact is
`92db9440-7d49-49d9-9986-844cf74751f2`. The agent's final yes outcome does not
pass the release gate because its console retains both rejected requests.

Independent private-storage retrieval confirms the old artifact is 320,592
bytes with SHA-256
`7aa84e1ac5b68b6caf94e0dc1541345a371f9a77d17f60537b7014ac9d83736d`.
Its text also falsely says the project has no crash data. Acquisition
`d56d06e6-38c9-4490-9aa3-848db65cca9b` already existed, but had not been saved
as selected report evidence. Neither the old PDF nor its record was changed.

The run was interrupted after Safety completed. Its two setup journeys and
project handoff completed; Engagement failed after three auto-review rejections
of insufficiently identified browser controls. The later jobs are unfinished.
None is promoted to passing. All four remote workflows passed on `a985cc8f`,
which is evidence for that checkout, not this correction.

## Correction and scope

The existing report controls now disclose the title and summary limits and
validate trimmed text before sending a save. They retain the entire draft,
including overlong text. No input-length attribute silently truncates a paste.
The API and controls share the unchanged title limit of 160 and summary limit
of 2,000. API authorization, write routes and database schema are unchanged.

Generation requires a successful save of the visible title, summary, status,
model citations, named-corridor selections, orthophoto choice and crash
acquisition. A carried acquisition is not mistaken for a saved selection.
Failed saves cannot advance the saved baseline; edits made during a save remain
pending. Repeated saves compare against the last successful save, including
before refreshed server props arrive. Generation and saving cannot overlap,
and controls are locked while a packet is being generated. Existing downloads
are explicitly identified as the previously saved version when edits are pending.

This guards local unsaved inputs. It is not a new cross-session transaction,
optimistic concurrency mechanism or scientific acceptance rule. It changes no
model result, holdout access, default, claim tier or frozen artifact.

An empty packet selection now says no acquisition is included in the packet,
not that the project has no crash data. It explains how to select, save and
generate the evidence without implying that no collisions occurred.

## Verification so far

Eight of the first nine new component cases failed against the old behavior.
The restored six focused suites pass 132 tests, including the generation
route. TypeScript passes. One initial TypeScript error came from inferred
non-null evidence IDs; an explicit nullable draft type corrected it.

A harmless comment survived. The first attempt to test the generation handler
removed a button's DOM disabled attribute, but React still suppressed its event.
Removing the handler guard then survived. That test did not prove the guard.
The corrected test wraps the real Button and invokes its actual supplied
handler directly, while separate tests retain rendered-button assertions.
A second harmless comment survived the corrected 60-test mutation suite.

Twenty-eight semantic mutations then failed their stated assertions:

- invalid-save refusal; unsaved, invalid, saving and generating handler guards;
- the Generate button's disabled state;
- each of the seven independent draft and evidence comparisons;
- concurrent-save refusal;
- omitted or prematurely advanced saved state; overwriting a newer draft;
- treating carried evidence as saved; using stale props on a subsequent save;
- the generation input lock and both generated-status updates;
- widened title/summary limits, blank-title acceptance, incorrect whitespace
  counting and silent summary truncation.

The original survivor and all subsequent runs are retained under
`~/.local/state/openplan/release-checks/v044-2026-09-05/` as
`report-draft-mutation-*.json` and `report-draft-mutation-results.json`.
No semantic mutation remains in the checkout. Unit tests do not prove visual
layout, browser reachability, independent stored bytes or cross-tenant isolation.

The empty-selection wording has a separate behavioral regression. A harmless
comment survived all 28 packet tests; restoring the false project-absence wording
failed the new assertion with the other 27 tests passing. The corrected wording
is restored. Logs are `report-empty-selection-{before,noop,mutation}.log`.

Rebuilt desktop/390px proof, the full QA gate, current CI and a fresh complete
twelve-journey outcome gate remain required before release.

## First rebuilt attempt and layout correction

On `f5ee2ef0`, full QA passed 12,968 app tests, 135 live isolation checks,
the production dependency audit and build. The browser proof created a separate
QA report `fcf256aa-91a6-44fa-b483-a0b22ec6aa49`. It retained the full invalid
draft and made no invalid save or generation request at desktop or 390px.
The valid shortened narrative and selected acquisition saved and survived reload.
The proof then stopped at a duplicate hidden format selector. No passing browser
claim is made for this attempt; its initial PDF and screenshots are retained.

Visual review also found an introduced layout regression. Content-sized text
expanded the new form group's grid beyond the clipped workspace panel. The page's
document width stayed normal, so that check alone missed it. Minimum widths on
the group and its article did not fix the containing grid. Giving this summary
fixed field sizing reduced the measured input from 17,464 to 458 pixels at desktop,
and from 19,955 to 242 pixels at 390px. Full draft text remains scrollable and
manually resizable. Switching back to content sizing reproduced the overflow.
These were temporary browser-style diagnostics, not edits to saved report data.

The first diagnostic assertion also compared two equally oversized elements,
and was corrected to compare the panel against the viewport. Failed diagnostics
are retained alongside the successful sizing experiment. The tracked
`report-draft-stays-readable` regression measures actual controls at both widths,
requires the full draft, and refuses to count a missing report as passing.
Rebuilt proof of the correction and the complete release gate remain pending.

## Rebuilt correction proof

On clean `49b72040`, full QA again passed 12,968 app tests, 135 live isolation
checks, the production dependency audit and build. The broader audit retains
10 development advisories, two high, six moderate and two low. It is not clean.

The visible front-door journey created QA report
`f31c01a3-7b7a-4897-9c41-66534350450d` in workspace
`5922324f-ef76-448e-aeb4-3c3f268807ea`. At desktop and 390px, all 2,152 draft
characters remained, field limits were visible, no invalid PATCH or generation
request occurred, and a valid edit still required saving. Reload retained the
new narrative and acquisition `d56d06e6-38c9-4490-9aa3-848db65cca9b`.
Generation then completed and actual PDF downloads succeeded at both widths.
Six screenshots were inspected. Console and page errors were empty.

Independent scoped database reads confirm the saved narrative and selection.
Private-storage retrieval matches the native browser downloads exactly:

| Packet | Artifact | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| No selected acquisition | `519e48b5-0df7-497c-a77b-eb8117988e60` | 327246 | `15219f4adfb43344a1c0d117e520913788f8f5c099b29509d5ef483f2b5946e7` |
| Saved narrative and selected acquisition | `7f67062d-1e27-4cf4-aeb8-f5afd9313d77` | 466639 | `43f09f686b52128a6c9f126de3c66573348e964680a0f8cc96528f1ff5306c4c` |

All nine empty-selection and twelve selected-evidence PDF pages were rendered
and inspected. The first packet describes missing packet selection, not absent
project crash data. The second includes the saved narrative and exact acquisition,
4,781 reported collisions, 4,123 mapped records and the missing-coordinate and
publication-cutoff limits. The map and source disclosures remain legible.
Existing split-card pagination is retained as layout debt, not lost content.
Disabled Generate text is hard to read in the dark theme and is queued as 062;
the adjacent save instruction is visible and the workflow completes.

The actual tracked layout regression passes at both widths. A harmless CSS
property survives; restoring content sizing fails on a 17,514-pixel panel in a
1,440-pixel viewport. The first wrapper injected into the sandboxed preview and
caused console errors; the next rejected an empty style. Both failed attempts are
retained. The final main-page-only wrapper completes with no errors or writes.
The report preview sandbox was not relaxed. Restoring the original draft before
the regression runner takes its final screenshot means the mutation's failure
measurement, not that cleanup screenshot, is the clipping evidence.

Byte-verifier no-ops survive; changed or missing bytes fail. Old saved narrative,
missing selection and changed PDF text fail their named checks. An initial PDF
text mutation replaced only one of two narrative copies and survived; replacing
both exposed the intended missing-narrative failure. This tests content presence
and stored-byte concordance, not upstream accuracy or every possible contradiction.

Raw evidence is in `report-draft-after-corrected/`,
`report-layout-regression-proof-final/`, `report-draft-storage-proof-final.json`
and the corresponding logs under the local release-check directory. Earlier
reports and artifacts remain unchanged. Full twelve-journey acceptance and exact
final-checkout CI remain required before tagging.
