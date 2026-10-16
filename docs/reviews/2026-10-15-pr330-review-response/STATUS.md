# Three PR review findings have reviewed source corrections

October 15, 2026. Root reads the complete automated review of PR 330 at
`401c44a0f7bfe4b54740e2c3d07e30f8ed36f169` and checks all three findings against
the application source. Each has a reproducible source path. Corrections are
assigned to separate GPT-6.1 Sol high worktrees. At intake, no correction is
accepted. The later checkpoints below record implementation and review.

| Finding | Source-backed cause | Assigned correction |
| --- | --- | --- |
| [P1 workbook pagination](https://github.com/nfredmond/openplan/pull/330#discussion_r4285653394) | Offset pagination orders by mutable updated_at. Editing a project between pages can move it across the page boundary, omit it and duplicate another project without changing the total row count. | Use an immutable cursor or a stable database snapshot. Exercise a real between-page edit in the route test, smaller response caps, workspace scope and the 2,000-row limit. State any remaining concurrent-write boundary. |
| [P2 report fallback](https://github.com/nfredmond/openplan/pull/330#discussion_r4285653407) | A missing-column error triggers a narrow project query without jurisdiction_context. The new strict jurisdiction reader rejects that omitted projection and turns the documented fallback into HTTP 500. | Preserve report generation with an explicit schema-pending disclosure. Keep the ordinary projection guard and distinguish unavailable schema from a planner's unresolved declaration. Check the actual route and packet output. |
| [P2 project membership](https://github.com/nfredmond/openplan/pull/330#discussion_r4285653413) | The page loads membership for the active workspace, then supplies its role to controls that write to project.workspace_id. The two workspaces can have different roles. | Resolve membership for the project's workspace and use it for project control gates. Exercise both opposite-role cases and fail closed on missing membership or failed reads. |

The independent artifact reviews remain evidence about their frozen downloads.
The small-workspace browser journey and stable native pagination fixtures did not
exercise concurrent edits between pages. Their successful exported rows do not
refute the P1 finding. The older report and page tests likewise do not establish
pending-schema or different-workspace role behavior unless they exercise those
specific paths and assert the actual query projections.

The three implementations own disjoint source scopes: workbook export route and
focused tests; report generation and directly necessary payload/render helpers;
and project detail page and focused membership tests. The root owns integration
and this response record. Focused expensive checks run serially under the shared
lock, with one Vitest worker, private caches and bounded memory. No child starts
a build, service, browser or database fixture. Changed tests and guards require
a harmless survivor, an intended failing behavior and exact restoration.

The existing V6 APP49 runtime, source anchor, protected databases, retained
artifacts, failed trials and original acceptance records remain untouched.
They are not acceptance for a future corrected application head. Current main
and hosted promotion remain held; no hosted migration, provider change or new
release occurs. Root will read the completed correction reports, join verified
changes, obtain proportional independent review and update the existing PR.

The initial CI read during this review wake has eight successful jobs, five
running jobs and one neutral Vercel review. It does not establish completed CI.
T3 owns continued PR monitoring; root starts no polling loop or duplicate suite.

The later summary-comment update marks the automated code review completed on
`401c44a`. It adds no finding, fix or approval of the corrected code. The three
inline findings remain open engineering work. A bounded task-state read confirms
all three assigned correction tasks are still running; none is restarted.


The project-membership child completes at `3548253ea4f1e546253c78c596a3b700052e7831`.
Root reads the full source, tests, report, evidence and control runner, then
checks all four source/runner hashes against committed bytes. The private final
receipt records 92 passed tests and no failed tests. The final 31-control receipt
matches the report, including the harmless survivor and exact restoration.
Root joins the correction locally as `43e0e53765874d740ae162177b710bd7461a7cc3`.
It is not pushed yet. The correction uses the authenticated client's role in the
project's workspace after the RLS project read and supplies all nine write flags.

A new Sol-high independent reviewer examines this bounded correction at the
joined head. The existing workbook and report correction assignments continue.
No duplicate suite, service, build, browser or database operation starts here.
The previous APP49 build and journey remain frozen evidence about their original
source. Independent review and changed-head runtime acceptance remain pending.


The workbook correction completes at `49d198d8ff7acc2dcd15f056d8030832a650c702`.
Root reads the source and test diff, report, evidence, bindings and control runner.
Nine source bindings, 26 accepted trial report hashes, three restored source
hashes and the final 24-test receipt match the committed candidate. Root joins
it locally as `5f2df554d794cf428ca75744d099f914b5272c6d`, after the membership fix.
A new Sol-high independent reviewer examines this bounded reader correction.

Queries now use ascending project ID and a strict cursor, then sort collected
rows by their received update timestamps for workbook presentation. The
between-page edit test checks exact original IDs after the count assertion;
restoring the old offset reader fails that ID assertion. Separate page reads
still do not create an atomic content snapshot or guarantee all concurrent
insertions, deletions, identity rewrites or visibility changes. Native UUID
comparison, PostgREST transport and changed-build browser downloads remain
unconfirmed. Existing frozen artifacts retain their original source boundary.
No push, operating stage, duplicate suite or hosted change occurs here.


The independent membership report finds no reproducible P1, P2 or other
material correctness issue in its bounded source review of `43e0e5376`.
Root reads the full report and joins it as `803827c30`. Child rendering, actual
RLS/revocation and changed-head browser/native permissions remain unconfirmed.

The report fallback correction completes at
`f956f414ffd1e286163e6c111a3b5314b404cd6f` and joins as
`bba8ceb6893243322a0fab06710bde3ec418a776`. Root reads the full source/test diff,
report, evidence and control driver. Eleven source bindings, three final process
receipt hashes, the 101-test report and 23 accepted control assertion records
with restored source hashes match the candidate. Unknown read failures and
malformed existing jurisdiction refuse generation; missing jurisdiction uses a
separate hashed schema-pending report object. Readable place and cost remain.
A new Sol-high reviewer examines this bounded correction independently.

The combined application tree is `c89e9ec4eeddfc973641e8683df7bc9d38113838`.
Root runs one combined focused cohort under the shared lock, with one worker,
shuffle seed 330, 1,536 MiB service memory, zero swap and a 1,024 MiB Node heap.
Whole-application TypeScript follows serially if that cohort succeeds. No new
build, database, preview or hosted operation starts. The final outcome is
pending; earlier individual results do not substitute for the combined check.


The combined focused cohort exits zero: 217 tests pass across nine files, with
no failures or pending tests. Recorded peak memory is 631,390,208 bytes, swap
allowance is zero and all sampled memory-event counters are zero. The real
route/page tests retain their mocked database/authentication boundary; the
combined run does not establish native transport or browser acceptance.
Whole-application TypeScript runs serially at the same fixed source head.
Its result remains pending. The workbook independent review completes without
a material P1/P2 finding; root reads the full report and evidence. Its report
join waits until the compiler finishes, preserving exact before/after identity.


All three bounded independent source reviews now find no reproducible P1, P2
or other material correctness regression within their assigned corrections.
Root reads the full final report and evidence for each. Workbook review
`609556e78` joins as `4f0503315`; report review `fa1ae73b4` joins as `5ab652fb5`.
These report-only joins preserve application tree
`c89e9ec4eeddfc973641e8683df7bc9d38113838`.

Whole-application TypeScript exits zero in 186.389 seconds, using the application
`tsconfig.json` with `--noEmit --incremental false`. Peak memory is
6,098,300,928 bytes against an 8 GiB cap, with zero swap allowance and all sampled
memory-event counters zero. The focused cohort takes 40.421 seconds. Exact head,
application tree, tsconfig hash and tracked application bytes match before and
after both checks at `bba8ceb689`. No application edit occurs during either run.
[Combined evidence](combined-checks.json) records command and receipt identities.

These are source, focused synthetic and compiler results. Native PostgREST/UUID
pagination, current multi-workspace RLS and changed-build desktop/390px journeys
remain open. The old APP49 build and artifacts do not accept the corrections.
Root next tests the stable reader against actual transport on a new isolated
fixture target. No old proof database or frozen packet becomes a test target.
The main/hosted promotion hold and prohibition on a new release remain.


The native workbook proof completes at `2ce251264` and joins locally as
`72b119cc9`. Root reads its full report, route probe, controller, extraction,
safety checks, publisher and packet verifier. The parent readback confirms 29
packet hashes, 962 current/extracted source bindings and all six owned helpers
stopped without OOM. A private copy of the verifier reclassifies 15 retained
accepted trials and four altered-cell faults; all six real XLSX hashes and XML
values match the published records. No native suite is repeated.

This accepts the bounded cap/cursor/UUID and tested workbook-value evidence.
The meaningful old-reader control returns four rows while duplicating one UUID
and omitting another. All five protected database fingerprints, 22,633 file
fingerprints and fixture rows match within the recorded interval. Complete
new-target catalog preservation remains unaccepted: `pg_class` differs and the
before record retains only a digest. The original assertion failure stays.
No cause, full RLS, browser, native Excel or atomic-content result is invented.

The fresh browser runtime remains pending. Root filesystem capacity is about
3.1 GiB, below the retained launcher's unchanged 8 GiB free-space guard. A new
Sol-high preparation task examines a separate memory-backed working root and
durable compressed output custody. It may prepare and test stand-ins only.
No real database, helper, build or web stage starts from that preparation.
No global cache deletion or old packet change is authorized by this step.
