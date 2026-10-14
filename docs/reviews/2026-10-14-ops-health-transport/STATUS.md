# Deep health cancels its actual backend reads

October 14, 2026. Unmerged correction to PR #326, based on ebffb5ebe.

The original response deadline raced the SDK promise without stopping its read.
Each probe now owns a distinct SDK fetch transport. The transport combines its
probe and caller signals with an inherited Request or RequestInit signal. It
refuses cancelled work before constructing the client or starting another fetch.
Final cleanup retires that transport and aborts an unfinished read.

Four eight-case cohorts pass, including harmless and restored source. Eleven
targeted faults fail for the intended reason. The checks use the installed
Supabase client against an owned local HTTP server. They verify the actual query
projection, caller cancellation, both inherited signal forms, retired transports,
and actual socket closure at database and Storage deadlines. The classifier
accepts two valid failure records and refuses six unrelated or incomplete ones.
See [controls](controls.json), [classifier controls](oracle-controls.json) and
[source bindings](source-bindings.json). The controller restores source and test
bytes in finally. The first campaign rejected a failure lacking its specified
assertion message. The corrected test records that message explicitly; its failed
private evidence remains retained.

The eight-second bound applies separately to each read. This does not establish a
whole-request wall-clock limit. Local HTTP fixtures do not establish native SQL,
RLS, hosted backend access or GitHub deployment-event delivery. Workflow YAML has
static review only. The configured Management API project and deployment backend
must refer to the intended same installation; set comparison alone cannot prove
that pairing. No production setting, schema or default worker changes.

See also [error-report recovery](../2026-10-14-ops-error-report-recovery/STATUS.md).
Related regressions, static review and exact updated-head CI remain separate.

Scoped TypeScript and changed-file lint pass. Three shuffled related cohorts
pass; counts are in [related evidence](../2026-10-14-ops-health-transport/related-tests.json).
[Frozen static review](../2026-10-14-ops-health-transport/INDEPENDENT_REVIEW.md)
finds no further concrete defect. The socket fixtures stall before headers,
so cancellation during response-body reading is not directly established.
Exact updated-head CI and hosted checks remain pending.

The isolated join with main325/eef4253 passes 87 relevant cases. The separate
aerial/main325 join passes 201 cases and preserves all 120 recorded worker
source hashes. Only additive changelog entries conflict in either join. See
[joined tests](joined-tests.json). These do not replace fresh head/main CI.
