# Project row jurisdiction type repair

This bounded repair starts at local commit `80e3035098159deb3127bbb277226ae6f5872870` in
`/home/nathaniel/.t3/worktrees/openplan/t3-42303f19`, branch
`t3/project-row-jurisdiction-type-repair`. The worktree was clean before the local
fast-forward. No fetch or parent worktree change was needed.

## Selected rows carry raw jurisdiction JSON

The project-detail page explicitly selects `jurisdiction_context` at line 166,
asserts the returned row as `ProjectRow` at line 188, and passes the field into
`identity.jurisdiction.context` at line 1337. The existing identity editor passes
that value to `ProjectJurisdictionEditor`. The latter accepts `unknown` and calls
`readProjectJurisdiction` before interpreting it.

Migration `20261017000016_project_jurisdiction_context.sql` adds a nullable `jsonb`
column. Its column comment identifies null as legacy context. The application
reader treats an absent projection as an error, permits explicit null for legacy
fallback, and rejects malformed non-null JSON through its strict schema.

`ProjectRow.jurisdiction_context` is therefore a required `unknown` field. A
selected row carries the key even when its database value is null. Optionality
would falsely permit a row projection that omits this field. `unknown` includes
null and permits invalid raw values to reach validation. It does not promise a
validated declaration or coerce missing and invalid values to legacy null. Like
other manually asserted database row types, it cannot establish the actual
response shape at runtime. The strict reader still owns that check.

The only production source change is this field declaration and its comment.
No query, runtime behavior, editor behavior, migration, validation schema or
geography adapter changes. No place or jurisdiction literal enters the shared
row type.

## Consumers and fixtures

The shared type has three production consumers: the project-detail page,
`project-delivery-board.tsx`, and `project-posture-header.tsx`. Two tests construct
complete typed rows. Their fixtures now include `jurisdiction_context: null`:

- `the-deliverable-update-control-is-reachable.test.tsx`
- `the-record-reassignment-control-is-reachable.test.tsx`

`a-rejected-claim-is-not-money-you-drew.test.tsx` already asserts a deliberately
partial object as `ProjectRow`. This repair does not broaden that assertion or
claim it proves the full row boundary. No other same-type fixture was found by
the repository-wide symbol and import search. Unrelated local types also named
`ProjectRow` remain separate.

The page suite already asserts the complete actual query projection. Four new
cases also render the existing editor through the real page and identity wiring.
They check legacy null, valid unresolved JSON, malformed JSON and undefined.
They assert the database mock's selected column and the resulting disclosure.
They do not assert source text or merely match imports.

## Verification record

Results and check scripts accompany this note. The scripts replay against the
private `app/` source copy and its dependency link; run them from the private
directory under the same mutex and systemd limits. The source manifest binds
the four edited files to that private copy. Private source,
dependency links, caches and raw logs live in:
`/home/nathaniel/.local/state/openplan/project-row-jurisdiction-type-repair-20261015`.
The dependency tree is reused from
`/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules` without
installing or changing it. Each check uses a systemd user unit with 1 GiB memory,
zero swap, 50 percent CPU and a 640 MiB Node heap. After the parent's mutex
instruction, subsequent verification controllers take
`/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock`.
Vitest uses one worker and a private Vite cache.

The direction check ran from the actual nested package. It exited zero with
reminders about expired registry and capability reviews, the review's v0.66.0
baseline versus package v0.68.0, and intervening substantive changes. Those
reminders do not establish refreshed product review or acceptance.

The initial scoped `tsc` command traversed imported files and exhausted the
640 MiB Node heap, with a 732.2 MiB cgroup peak and zero swap. This attempt
provides no compiler verdict. The bounded replacement uses the installed
TypeScript compiler API, the existing compiler options, normal import resolution,
and explicit source roots. It requests syntactic and semantic diagnostics for
those roots in smaller groups. It introduces no ignore, broad cast, exclusion or
new `skipLibCheck` setting. Imported declarations still participate in checking,
but imported implementation files outside the named roots do not receive their
own diagnostic pass. This is scoped evidence, not full-project TypeScript.

## Results and mutation controls

All final scoped compiler groups return zero diagnostics. They cover 10 explicit
source roots across the page/type pair, two production consumers, the page test,
three consumer fixtures/tests, and two jurisdiction tests. Test-file groups load
the installed `@testing-library/jest-dom/types/vitest.d.ts` augmentation that the
full project receives through other test imports. The first isolated test-file
attempt omitted that context and reported 134 missing matcher diagnostics; the
private harness was corrected, with the failed attempt retained privately.

The six-file Vitest slice passes 121 tests. Its files are the page suite,
`project-jurisdiction.test.ts`, `project-jurisdiction-editor.test.tsx`, both
complete typed-row fixture suites and the existing partial-row assertion suite.
The final serialized controller exits zero, peaks at 531.3 MiB, and uses zero
swap. `results.json` records each expected outcome.

| Control | Observed result | What it establishes |
|---|---|---|
| Append a comment to the row type | Scoped compiler exits 0 | The compiler control can report a survivor. |
| Remove the new field from the private row type | Exits 1 with page TS2339 at 1337,46 | The check catches the original missing-field defect. |
| Append a comment to the private page | Six selected cases pass | The page control can report a survivor. |
| Pass `context: null` in the page identity object | Three raw-context cases fail on missing expected disclosures | The page tests observe the actual editor context prop. |
| Omit `jurisdiction_context` from the page's actual query projection | Four new cases and the existing complete-projection case fail | The mocked database query must select the field. |

All faults affect private copies. The controller restores original bytes in
`finally`, with restoration hashes recorded. The tests use the real page,
identity editor and jurisdiction editor, while mocking database reads.

Isolated TypeScript transpilation of `_types.ts` before and after the repair
produces identical 11-byte JavaScript, SHA-256
`8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881`.
This confirms erasure for this type module. It does not compare Next.js bundles
or establish a successful production build. `git diff --check` also passes.

## Boundaries retained

The task reports that frozen actual-source build v2 compiled webpack, then
failed TypeScript with the page's TS2339 and six separate report-test diagnostics.
It reports exit 1, peak 7,319,392,256 bytes under a 10 GiB cap, zero swap and no
memory events, so that build failure was not an out-of-memory result. It also
reports no accepted build result, build-files receipt or BUILD_ID. This repair
neither reruns nor independently re-establishes those frozen build facts.

The frozen candidate, partial `.next`, build intents, receipts, original f299
and helper anchors remain outside this work. No source recapture, v2 runner,
service, database, host, provider, browser, full QA, full-project compiler or full
build runs. No PR, push, merge, release or runtime acceptance claim follows from
this local repair. `report-generate-route.test.ts` remains untouched. Its six
known diagnostics belong to the other child and remain a parent join boundary.
The scoped roots do not include that test, so their zero-error result cannot
clear those diagnostics. Parent independent review, join, full TypeScript,
a new app binding and a new build remain necessary.

The compiler controls cannot detect a wrong database projection or invalid
runtime JSON. The page tests check the selected field and raw-value wiring with
a mocked database; they cannot prove native query behavior, RLS, production
response shape, browser rendering or practitioner acceptance. The existing
jurisdiction tests exercise validation and identity changes without live data.
