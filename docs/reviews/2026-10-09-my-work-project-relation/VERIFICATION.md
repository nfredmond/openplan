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
