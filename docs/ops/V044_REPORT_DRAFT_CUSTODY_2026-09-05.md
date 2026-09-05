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
