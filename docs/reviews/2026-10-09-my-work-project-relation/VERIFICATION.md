# My Work project relationship after restore migration

T3 acceptance on identified build `b1b0fc56f8e2` opens My Work through the
navigation rail and reports stage-gate decisions unavailable. The isolated
database has migration 27 and both project foreign keys. A direct PostgREST
read reproduces HTTP 300 with `PGRST201`: the unqualified `projects!inner`
embed matches both the original project-ID relationship and the added composite
workspace relationship. An explicit relationship returns 200. An empty result
establishes successful query resolution, not nonempty rendering or permission
isolation.

The source names `stage_gate_decisions_project_id_fkey` and retains `!inner`,
the caller client and the workspace filter. This original relationship also
exists before migration 27. Both database constraints remain intact. A source
search finds no other direct or reverse project embed for the four affected
tables in application code; other project embeds belong to unchanged relations.

All 57 focused query, board and page tests pass. The existing latest-decision
case now asserts the executed projection because its in-memory fake does not
model ambiguous foreign keys. A harmless source comment passes all 31 query
tests. Restoring the ambiguous embed fails only that targeted projection case;
restored source passes all 31 again. These controls do not prove native query
resolution, RLS or rendered behavior. The initial root-level ESLint invocation
uses the wrong relative paths; the corrected nested-package command is separate.

Private controls are in `my-work-project-relation-proof-20261009` under the local
OpenPlan state directory. Nonempty authenticated reads, rebuilt desktop/390px
acceptance and GitHub checks remain pending. PR 177 must include this correction
before it lands; earlier green checks cannot override the reproduced defect.

## Nonempty native and rebuilt acceptance

The actual project page records a synthetic Hold on its displayed programming
eligibility gate, with an explicit synthetic rationale and no cited model run.
The API readback retains decision `e1409ff4-3cb6-4224-88cc-597f0838c3a5` against
the existing synthetic recovery project. The template remains visibly an interim
unconfigured default. This is no agency approval or scientific finding.

Using the synthetic owner's authenticated session against the isolated
PostgREST service, the exact fixed source projection returns 200 and that
nonempty held decision with its project name and ID. Harmless query whitespace
also returns the row. Restoring the unqualified embed returns 300/PGRST201;
the restored query returns the row again. The original build still displays
the unavailable warning for the same saved hold. `controls.json` retains these
outcomes. They do not replace the separate full permission-isolation suite.

Production source `f76b0516d2d263dc08892d742ce245a2e792ae8d` builds in
2 minutes 3.282 seconds with a journal-reported 7.2 GiB memory peak under an
8 GiB cap, no swap and two page workers. Log SHA-256 is
`654835a8c530c2a453757b55113c325e707012306d4af295b13fd69cda1abfed`.
Corrected targeted ESLint passes. The owned server at port 3522 reports the
same commit and version 0.68.0; PID 1803734 has the expected fix-checkout cwd,
and invocation `f4e8787928e440f597c09e19ba8c5f8f` identifies the instance.

T3 opens Projects and follows My Work through its navigation link. The unavailable
warning is absent and the saved hold shows its project, gate, date and complete
rationale. Desktop and 390px images are inspected. The held-item panel has equal
client and scroll widths of 888px and 270px respectively; document widths match
1280px and 390px. No new console entry appears after the corrected-build journey
starts at 22:27:53 UTC. Image identities and hashes are retained in
`browser-acceptance.json`. No temporary browser styles are used.

This verifies the affected read and rendered nonempty result. It does not prove
every stage-gate workflow, native mobile behavior, practitioner acceptance or
the whole v1 contract. Current-head GitHub checks and final integration remain
separate from the completed local evidence.
