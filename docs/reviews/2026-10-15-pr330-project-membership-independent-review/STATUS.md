# Project workspace role correction has no remaining bounded finding

October 15, 2026. Independent review of PR330's project membership correction.
Reviewed head: `43e0e53765874d740ae162177b710bd7461a7cc3`.
Candidate: `3548253ea4f1e546253c78c596a3b700052e7831`, integrated atop
`401c44a0f7bfe4b54740e2c3d07e30f8ed36f169`.

No reproducible P1, P2 or other material correctness issue remains within this
bounded source and retained-evidence review. The correction addresses the
[original P2](https://github.com/nfredmond/openplan/pull/330#discussion_r4285653413).
This disposition accepts the source correction and its stated mocked boundary.
It does not accept changed-head browser, native database or hosted behavior.

## Ownership and preparation

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-a4f6e06c`,
branch `t3/pr330-project-membership-independent-review`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. An ancestry check permits an
ff-only advance of this branch to the exact reviewed head. The resulting
checkout is clean before review writes.

The reviewer reads the assigned AGENTS.md and newest external coordination
entries. Those entries retain disjoint workbook/report correction ownership,
the frozen V6 APP49 boundary and the promotion hold. Only this new review
directory and the private directory
`/home/nathaniel/.local/state/openplan/privatepr330-project-membership-independent-review-20261015`
belong to this review. No parent, canonical or other checkout is modified.

`npm run product:direction:check` runs from nested `openplan/` before review and
exits zero. Existing expired registry/matrix, reviewed-version and intervening
change reminders remain. The reviewer reads the relevant contract, roadmap,
capability matrix, October 6 direction review, known issues and architecture
context. This bounded correction does not amend product direction or refresh
those records. Planner-writing, prove-it and Supabase guidance apply.

## The lookup follows the project and the caller

The production diff changes only `openplan/src/app/(app)/projects/[projectId]/page.tsx`.
The other changed application file is `openplan/src/test/project-detail-page.test.tsx`.
The four implementation report/control files are also reviewed in full.

At page lines 130–193, the caller's cookie-backed Supabase client authenticates,
retains active-workspace admission, then reads the project through RLS. Only
after that read succeeds does it select `role` from `workspace_members`, filtering
by `project.workspace_id` and authenticated `user.id`. It uses `maybeSingle()`.
The service-role roster client does not supply this permission decision.

The checked-in `projects_read` policy in migration
`20260313000011_projects_module.sql` scopes project reads through the caller's
workspace memberships. Migration `20260316000024_fix_workspace_members_rls_recursion.sql`
allows callers to read their own membership rows across workspaces. The composite
membership primary key supports a single row for the two filters. These are
source-policy observations, not a live database result.

A membership query error discards even returned owner data. Missing membership,
missing role and unknown role deny writes through `canAccessWorkspaceAction`.
The existing `ReadFailureLog.check` discloses a query error. The active membership
object, selection helper and admission branch remain intact.

All nine existing permission props now use `projectRole`: posture/RTP linking,
stage-gate decisions, identity/jurisdiction, delivery, estimated cost, funding
awards, map editing, evidence bundle generation and record editing. No remaining
`membership.role` permission expression appears in this page.

## The replacement action matches the affected write tiers

The role matrix grants `plans.write`, `programs.write` and
`stage_gates.decisions.write` to the same supported roles: owner, admin and member.
It denies viewer, missing and unknown roles. Therefore replacing bare non-viewer
props with `plans.write` introduces no supported-role mismatch.

Bounded adjacent reads confirm the relevant route paths:

- Project PATCH/DELETE, location and corridor writes call
  `lib/programs/api.ts:loadProjectAccess` with `programs.write`. That helper reads
  the project, then the caller's membership in `project.workspace_id`.
- Funding-award create/update use the same helper and `programs.write`.
  Evidence-bundle creation separately checks that same write action after access.
- RTP links use `plans.write` with both caller and project workspace filters.
  Stage-gate POST checks its named write action against caller membership in the
  supplied workspace; the overview supplies the project's workspace.
- Work-plan and project record create/update resolve the project before calling
  `requireWorkspaceWriteAccess` with its workspace. That legacy helper denies
  viewers but permits unknown strings. The new page is stricter for unknown
  strings, as required by the brief. The checked-in restrictive database write
  policy uses `workspace_member_can_write` and denies unknown ranks as well.

The page's action key differs from some route keys, but their supported role
sets agree at this head. This is not a finding. Wrapper reads also show the
overview forwarding identity/stage-gate flags and the map wrapper forwarding
`canWrite`. These source reads do not prove rendered controls or successful writes.

## Retained tests and controls support their declared boundary

The ten new cases execute the real server-page permission composition with
mocked auth, membership and database results. They inspect all nine props,
including inactive tab elements, both reverse-role cases, project admin/member,
same-workspace owner/viewer, missing membership/role, unknown role and an error
with stale owner data. Assertions name the exact projection, workspace filter,
authenticated user filter, project-read order, unchanged active membership,
retained admission call and failure disclosure.

The reviewer reads the complete mutation runner and config, implementation
report/evidence, all 31 final control JSON assertion records, final shuffled
receipt, final command/source receipt, final-check runner and service logs.
Four current SHA-256 values match the report: page, test, mutation runner and
Vitest configuration. Both restoration and final-check source hashes match the
current page/test bytes.

The retained final run records 92 passing tests, zero failures and zero pending
tests across four files, with seed 330. The final command receipt records zero
exits for focused tests, lint and whitespace. These runs are read, not repeated.
The private review readback is `retained-evidence-readback.json` in this review's
private directory. It contains the observed hashes, counts and assertion records.

The harmless comment trial records all ten cases passing. The stale-active-role
trial fails both reverse-role cases at the permission-prop assertion. Each of
the other 29 faults has its intended named assertion failure, including each
individual permission prop, projection, both filters, admission, disclosure,
missing composition and premature lookup. The classifier requires the exact
executed names, appropriate exit/success result and named `AssertionError`;
empty selections, crashes and unrelated diagnostics cannot count as these kills.
The runner restores original page bytes in nested `finally` blocks and checks
unchanged test bytes. The final restoration receipt reports true. This review
does not rerun the campaign or claim to observe its historical writes directly.

The earlier failed nonexistent `collect` call, rejected zero-test selector and
lint line-limit attempt remain retained. They do not count toward passing
evidence. No decisive concern requires another focused probe. This review changes
no source, test, guard or executable probe and creates no dependency symlink.

## Runtime and promotion limits remain open

`pagePropsFor` traverses returned React elements without executing their child
components. Existing tests also mock several child editors and helpers. These
tests prove server-page prop composition under synthetic boundary inputs. They
cannot prove child rendering, every child honoring its prop, actual projection
delivery, live RLS, revocation timing or HTTP permission behavior. The membership
source guard is syntactic; mocked helper tests do not establish native auth.

The reviewer runs no database, browser, service, build, full TypeScript check,
full suite, hosted/provider operation or protected-state audit. No fresh claim
is made about canonical unrelated entries, demo/source anchors, retained
databases, frozen packets or other processes beyond leaving them untouched.
No nested delegation, push, merge, release or public comment occurs.

Frozen V6 APP49 build/browser/native evidence does not accept `43e0e5376`.
The parent retains combined correction checks and a newly identified runtime
journey, including desktop and 390px behavior, console review and relevant native
permission/revocation evidence. Promotion hold 420/latest17 versus last verified
hosted 418/latest15 remains. This report authorizes no hosted mutation or release.
