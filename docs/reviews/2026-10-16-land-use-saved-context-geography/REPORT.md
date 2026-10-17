# Saved land-use context and geography can diverge

Disposition on October 16, 2026: the narrow geography part of KI-2026-10-12-025 remains a source-established behavior gap. A working plan's general PATCH can change its study-area label and geometry without changing its retained context. The context-save transaction synchronizes these values, but no traced table guard preserves that relationship afterward. This is source analysis, not an executed route, P2 reproduction, native database failure or installed-schema finding. KI-025 as a whole remains open and outside this investigation.

## Source identity and ownership

T3 reports this delegated research thread on branch `t3/land-use-saved-context-geography`, worktree `/home/nathaniel/.t3/worktrees/openplan/t3-fb6d8272`, parent thread `1401bb6a-70e4-42eb-a1f1-98045485f8cc`, model `gpt-6.1-sol`. Git independently reports that path and branch, a clean starting worktree, HEAD `05dd3e8da4a4572437f06e771b0a2477873e681f`, and application tree `1e0b6522002b2485d37086790808c0217ff77cfe`.

This checkout starts before the supplied parent `0875f3f341eac90adc1463a59b6422f0212e5a90`, whose application tree is `2b1916349d7379c96bf97b1708b3e4016d37384d`. Git ancestry confirms the checkout is an ancestor of that parent. The land-use API and library directories have no Git delta between these commits. The parent adds 18 migration files, from 405 to 423, but the set of migration files mentioning `land_use_plans` is unchanged. Those 13 files have no delta. These are source inventories, never installed truth. The parent contains KI-025 and the October 12 review; this older checkout does not. They were read through `git show`, without changing branches or copying their proof corpus.

Write ownership is only this new review directory and the new private directory `/home/nathaniel/.local/state/openplan/land-use-saved-context-geography-20261016`. No production, test, migration, canonical product document or existing evidence file changes belong to this stage. The root's supplied direction-check result is not independently rerun or claimed here. This research proceeds alongside separate A0 and budget evidence work.

## Governing design and contrary evidence

The contract, M1 definition, capability matrix and October 6 direction review preserve plan-owned authority, exact study geometry and workspace home as separate facts. The retained independent reviews A and B also require cross-state and sovereign/overlapping cases. They do not establish the present PATCH counterexample. The parent's current roadmap points M1 to KI-025 and `docs/product/MILESTONES.md`. Older architecture and milestone descriptions contain dated implementation claims, so current code governs this trace.

The existing working design expressly supports study-area replacement through the context editor. `PLAN_CONTEXT_DESIGN.md` says study-area edits must not silently change responsible bodies. `CONTEXT_AUTHORING.md` says migration 6 updates the geography label and geometry with saved context so frozen identity cannot retain an older label beside a newer context. Therefore, changing a working draft or fork is intentional. The gap is the independent write path that bypasses this synchronization, not permission to edit a draft.

There is substantial contrary evidence against a frozen-evidence corruption claim:

- `loadWorkingVersion` checks the selected current version is working (`openplan/src/lib/land-use-plans/api.ts:74`). PATCH refuses when no working version exists (`.../[planId]/route.ts:138`).
- Frozen versions retain their own context and identity under the content hash. `readFrozenPlanIdentity` validates that hash, and `readFrozenPlanContext` validates retained values without backfilling current context. The frozen-version rewrite trigger protects snapshots and hashes (`20260823000002_land_use_plans.sql:334`).
- Draft identity/context writes increment `draft_revision` (`20261016000003_land_use_plan_draft_revision.sql:87`). The freeze RPC locks the plan and selected version, rechecks revision, identity and exact current context (`20261016000004_land_use_plan_freeze_commands.sql:78–138`).
- Existing public-identity and frozen-rules tests explicitly retain historical values after later draft changes. No claim here says PATCH rewrites an existing frozen or adopted snapshot.

## Exact source counterexample

Use a writable current working version with a valid saved context C. Let C retain study place A, its label LA, geometry GA, independent authority assessment and saved attribution. The context-save path has already set `geography_label = LA` and `geography_geojson = GA`.

1. Submit general plan PATCH with `geographyLabel = LB` and `geographyGeojson = GB`, where LB differs from LA and GB is a different valid polygon. No authority or applicability change is needed. Label-only and geometry-only writes also reach the same branch.
2. The strict PATCH schema accepts those fields (`.../[planId]/route.ts:17–24`). The route checks write access and a working version, then constructs and writes the geography columns (`:154–162`). It does not load, compare, replace or invalidate `plan_context`.
3. The context guard restricts changes to context, descriptor and plan kind, not geography fields (`20261016000002_land_use_plan_context.sql:27–44`). The initial geography constraint only requires a JSON object or null (`20260823000002_land_use_plans.sql:22`). The draft-revision trigger increments a counter but does not compare geography with context.
4. The resulting source-defined row carries LB/GB alongside context C containing LA/GA. Its generated `plan_context_hash` is unchanged because its expression hashes only `plan_context` (`20261016000002_land_use_plan_context.sql:4–9`). Context and authority attribution still describe the original saved assessment.

The context reader selects context, hash, descriptor, kind and working pointer only (`plan-context-store.ts:17–38`). It validates retained shape and normalization, but cannot detect the separate geography mismatch. Client draft matching likewise compares context hash and identity, not those geography fields (`plan-context-recovery.ts:106–107`). The mounted editor rechecks on draft revision, which protects stale views, but that re-read still has no equality oracle.

The snapshot builder places LB in `snapshot.plan.geographyLabel` and C in `snapshot.planContext` (`api.ts:153–162`). A fresh freeze request can satisfy the existing revision and context guards because each field independently matches the current row. The trace contains no comparison between the frozen identity's label and `planContext.place.label`. The changed raw geometry GB is not copied into frozen identity; exact retained geometry remains GA inside C. Thus the demonstrated source consequence is a divergent mutable geometry plus a potentially contradictory newly frozen label/context pair. It is not replacement of retained frozen geometry by GB. Other readiness requirements still apply; no actual freeze or public rendering was executed.

## Writer custody and race analysis

The application writer census covers `openplan/src`, `workers` and `scripts`, followed by the SQL definitions referencing the table. The traced production writers are:

- General plan PATCH writes title, authority display label and geography fields; applicability uses a separate version write. The counterexample needs only the plan write, so partial success of the applicability write is not its premise.
- Context POST authenticates and scopes the actor, then calls `savePlanContext`. Migration 6 locks the plan/version and atomically writes context plus both geography fields (`20261016000006_land_use_plan_retained_study_area.sql:16–85`). Retained-place mode checks the exact stored place before an authority-only save. Exact retries return the original receipt without rewriting newer state.
- Creation calls the existing service-only transaction. It inserts context and geography derived from that context together (`20261016000007_land_use_plan_creation_commands.sql:110–119`).
- Version forking updates the working pointer after copying child records; freeze clears that pointer; adoption updates version pointers. Rule reconciliation changes working applicability and child records. These paths do not provide a second independent geography synchronizer. The fork route does not overwrite frozen context, and this report does not expand into historical-base carry-forward policy.
- Authenticated direct table writes use the plan's workspace writer policy (`20260823000003_land_use_plan_policy_compaction.sql:24`). The context guard excludes geography-only edits, so the same source-level divergence is reachable without this PATCH route. Actual grants, RLS installation and native behavior remain unverified.

Two context saves already have context-hash and lock protection. Save versus freeze already has context/revision protection. Neither requires a new race claim. The relevant ordering is narrower: context save commits, then an independent geography PATCH commits and creates divergence. In the reverse order, a successful context save restores its chosen context's geography into both fields. Row locking serializes writes; it does not enforce equality after the later PATCH. A proposed route pre-read alone would also race with the first context save when it initially observes null context. Additive database enforcement is therefore needed to protect both that ordering and direct table writers.

## Smallest proposed repair boundary, not implementation authorization

Preserve the existing context command, picker/resolver, retained-place save, exact retries and freeze/version machinery. Study-area changes on assessed plans should use that command path. Do not derive authority from geometry, force workspace-home equality, or bind `authority_label` to one item of a multi-body assessment.

The smallest coherent ownership proposal is:

1. `openplan/src/app/api/land-use-plans/[planId]/route.ts`: return a useful conflict for geography changes that conflict with retained context, including a database conflict from a concurrent first save. Keep title edits and intentional draft/fork editing available. If a context pre-read is added, reuse `readPlanContext`; missing or malformed context must not become legacy absence. Do not select the full large context for unrelated title/applicability writes without need.
2. One new additive migration, assigned through the repository's migration workflow later: enforce exact geography label/geometry agreement with retained `plan_context.place` for relevant inserts and updates, including authenticated direct writes and verified service writes. Current create/save transactions already write matching values atomically. Do not alter old migrations, rewrite frozen evidence or silently backfill existing divergent rows. Check only affected context/geography transitions if unrelated edits to historical inconsistent rows must remain available. A context save can explicitly restore the relationship; automatic geometry or authority repair is outside this proposal.
3. Focused behavioral PATCH coverage, either a new test file or an owned extension of `land-use-plan-frozen-rules-integration.test.ts`; the existing context-persistence SQL fixture and its gated wrapper; a small extension of the draft-revision fixture only where its deliberately shallow context now conflicts with the new invariant. A reader change is not intrinsically required to stop new divergence. Detecting pre-existing divergence can be a separately chosen bounded follow-up rather than an automatic record rewrite.

Do not broaden this repair into report pointers, public bounding boxes, creation's country/provider assumptions, legal applicability policy, safety or modeling. Root owns any implementation decision, compiler window and later native target authorization.

## Finite proposed evidence, with independent oracles

These are written requirements only. No executable preparation, fixture creation, imports or tests run in this stage.

- PATCH behavior: test label-only, geometry-only and combined conflicts after retained context; assert no plan or applicability write occurs. Test valid title edits, legacy geometry edits and no-working-version refusal as controls. Assert projections for any new context read, scoped plan/workspace filters, and database conflict-to-409 handling. The oracle is the independently specified saved place A, not a helper under test.
- Database behavior on a later explicitly assigned isolated stack: save A through the existing command; record context/hash, geography, revision and receipts. Authenticated label-only, geometry-only and combined divergent writes must refuse and leave all values unchanged. Same-value geography and title edits must remain valid. A new context command replacing A with B must update all three representations together, preserve the stated authority assessment, and return an exact replay. Check inserts through the existing create transaction as well.
- Ordered concurrency: two controlled schedules between a first context save and an independent geography write must leave either no retained context yet or exact agreement with the committed retained context. Reuse the existing lock-test patterns. Test a pre-save legacy route read followed by save then table update. Busy conflicts are acceptable only with unchanged state and useful retry behavior. This requires real sessions later, not mocked promises.
- Frozen boundary: freeze an otherwise ready, consistent A, fork, replace the working study area through the context command and show A's original snapshot/hash remain byte-identical. Assert a new snapshot's label and retained place match B. This is future native/reader evidence; it does not establish browser or public-artifact acceptance.
- Harmless control first: change a comment in the new guard and confirm the focused harness still passes. Named faults: `allow_patch_geography_after_context`, `omit_database_geography_invariant`, `check_label_but_ignore_geometry`, and `mask_database_conflict_as_500`. Each must fail the intended behavioral assertion. Removing the database invariant must be challenged through a direct table write so the route check cannot mask it. Restore each owned edit from retained bytes without destructive Git resets, compare hashes, then rerun the focused baseline.

Blind categories remain explicit. Mocked routes cannot establish triggers, grants, RLS or serialization. Native SQL cannot establish HTTP mapping or recovery UI. Finite ordered schedules do not prove arbitrary concurrent operations. The selected synthetic places do not establish all geography/provider coverage or legal applicability. Unit/native/reader checks do not establish identified desktop/390px journeys, usable public exports, practitioner usefulness, counsel review, hosted operation or full M1/V1 acceptance.

## Stage boundary

Only source text, Git and filesystem metadata were read. No direction/dependency/compiler/test/runtime/import/probe execution, database, Docker, SQL execution, Auth, HTTP, browser, provider, service or hosted operation occurred. No source fix, executable test preparation, push, PR, main join or release occurred. The new source pins record custody only. Parent/root receives this disposition before any implementation work.
