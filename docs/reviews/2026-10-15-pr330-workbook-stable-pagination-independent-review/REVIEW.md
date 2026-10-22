# Independent review of PR 330 workbook pagination correction

No material P1 or P2 finding remains within this bounded source and retained-evidence review. The correction addresses the [reported mutable-sort omission and duplication](https://github.com/nfredmond/openplan/pull/330#discussion_r4285653394). Accept the source correction for integration review. This disposition does not establish native transport, browser acceptance, an atomic snapshot or release readiness.

## Reviewed identity and ownership

The reviewed head is `5f2df554d794cf428ca75744d099f914b5272c6d`. It joins workbook candidate `49d198d8ff7acc2dcd15f056d8030832a650c702`, based on `401c44a0f7bfe4b54740e2c3d07e30f8ed36f169`, after membership integration `43e0e5376`. The three workbook route/test files match the candidate exactly at this head.

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-e88fc771`, branch `t3/pr330-workbook-pagination-review`. It starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwards only this branch to the assigned head. The integration owner's checkout remains `/home/nathaniel/.t3/worktrees/openplan/t3-e33fc359`. I read repository AGENTS and the external coordination record, including the newest 16:51:24 UTC workbook assignment and 16:50:12 UTC membership assignment. Active services and browser processes belong to other lanes and remain untouched.

Ownership covers only this new report directory and `/home/nathaniel/.local/state/openplan/privatepr330-workbook-stable-pagination-independent-review-20261015`. No application source or test writes occur. Membership review and the pending-schema report correction remain separate assignments. This review neither accepts nor rejects their changes.

The nested `openplan/` command `npm run product:direction:check` exits zero. Existing registry expiry, review/package version and intervening-change reminders remain. I read the applicable contract, roadmap, capability matrix, direction review, known-issue and architecture context. This bounded correction does not amend product scope or resolve whole-product review reminders. Planner-writing, prove-it and the Supabase skill guide the review.

## Source disposition

The original defect depends on an unread row moving across a mutable `updated_at DESC` offset boundary. In `openplan/src/app/api/projects/export/workbook/route.ts:53`, every request instead uses `id ASC`; subsequent requests add strict `id > lastId`. Line 71 advances from the last received row, rather than a requested page size. With fixed IDs and visibility, an ordinary field edit cannot move an unread row behind this cursor. The query uses the same database column for ordering and comparison.

Every page retains the existing selected-field projection, workspace predicate and authenticated user client. The diff changes only the workbook route and its two test files outside the correction's documentation. Authentication, viewer access, unavailable membership, query-error refusal and awaited serializer behavior remain on the same paths. No new service-role access, schema operation or write enters the route.

The request limit is `min(1000, 2001 - receivedRows)`. Short pages continue, including the synthetic caps of 137 and two. At exactly 2,000 rows, one further read requests a single sentinel row; an empty result permits export, while row 2,001 produces the existing HTTP 409 `row_limit`. Later errors or null data return HTTP 500 before serialization. The loop is bounded by received rows and does not rely on an exact total count.

The installed donor `@supabase/postgrest-js` is version `2.110.7`. I read `PostgrestFilterBuilder.ts:319`, `PostgrestTransformBuilder.ts:366` and `:492`, plus query cloning and the fetch call in the builder sources. These methods produce `id=gt.<value>`, `order=id.asc` and `limit=<n>` through URL search parameters. They return the builder, and awaiting it dispatches the composed URL. No offset or inclusive cursor is introduced by this method chain. Source inspection establishes construction, not an actual server response.

The project schema declares a UUID primary key. PostgreSQL 17's upstream `uuid_out` emits lowercase canonical strings, while `uuid_gt`, the B-tree comparator and sort support use the same byte comparison. Canonical hexadecimal strings have the same relative order, supporting the route's final ID tie-break. This is an inference from the [PostgreSQL 17 UUID implementation](https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/utils/adt/uuid.c), read October 15, 2026, and the local schema. It is not verification of the retained database binary or a live UUID query. The private source snapshot has SHA-256 `898f0b3491934a26622cbddcf90cd6cc80c81c967057ca36d832df6233de04d2`.

Line 88 sorts collected rows by received `updated_at` instant descending, then microseconds within a millisecond, then ID ascending. The tests exercise equivalent instants with UTC offsets, microsecond differences and ID ties. The sorter preserves those presentation semantics for normal finite PostgreSQL timestamp output. It does not reread earlier rows. Unsupported timestamp forms and special non-finite values are not established by this review.

The serializer, round-trip contract, workbook limit, place fields and layout implementation remain byte-identical to the base pins. Literal operator-prefixed text, decimal strings, unknown price year, field order, workbook sheets, download headers and private/no-store behavior retain their existing implementation and focused checks. This is not a fresh native spreadsheet layout assessment.

## Regression and control evidence

I read the full correction STATUS, evidence, source bindings and 242-line control runner, both route tests, the route diff and the unchanged serializer. I inspect the retained private reports rather than repeat the 24-fault campaign. `evidence.json` in this directory records the readback and source hashes.

All nine base/candidate source bindings match local Git objects and current bytes. All 26 accepted trial hashes match the retained reports. Reclassification confirms one harmless 17-case route cohort, 24 intended single-assertion failures and the restored 24-case cohort. Both retained restoration receipts match the three candidate route/test pins. The original reproduction, failed Node-environment cohort, corrected jsdom cohort and rejected cursor trial also match their public hashes.

The concurrency regression changes the unread third row before the second response, after the first page has been projected into fresh objects. It verifies that the edit executes, then checks count, exact ID multiset and presentation order. The old-reader trial fails at the named exact-ID assertion on test line 196. Its preceding count assertion therefore passes. All timestamps in this adversarial setup use compatible UTC forms, so the fake's lexical timestamp order reproduces this particular old-reader trigger.

Both fakes apply workspace scope, projection, cursor and response caps. The pagination fake retains offset support for the old-reader control. Every-page query assertions check the exact projection and workspace predicate. Their fake IDs are `project-*` strings, not UUIDs. These tests cannot establish UUID parsing, actual database comparison, RLS, cookie authentication or permission freshness.

The classifier checks active test identity/count, suite/runtime failures, recorded exit code, one failed assertion and its diagnostic. Independent in-memory reclassification keeps a harmless metadata addition and refuses the eight recorded malformed-report cases. The evidence reader also accepts a copied input, refuses changed bytes against its hash and accepts the restored original. Candidate and retained inputs remain unchanged throughout. These are receipt-reader controls, not new product trials.

Separate process-exit JSON receipts exist for the two resumed fake controls and final restored cohort. Earlier trial exit codes come from the retained control summary and runner output; this review does not recreate their processes. The runner's final restoration and report checks support those historical outcomes without turning them into fresh executions.

The missing-DOMParser run and the initial cursor-fake diagnostic mismatch remain visible failures. Neither counts as an accepted kill. The corrected fake-cursor trial fails at the earlier HTTP 409-versus-200 assertion, as documented. Resource and lint receipts remain historical candidate evidence; I do not rerun ESLint, Vitest or a resource-limited compiler service here.

## Limits and integration follow-up

This review runs the direction check and a lightweight read-only source/receipt audit. It makes no database connection, fixture, browser, app service, build, full TypeScript check, full suite, hosted/provider/configuration/migration change, nested delegation, push, PR mutation, merge or release. Only this report is committed locally. PR 330 is registered with this review thread through the app's linking tool.

The keyset reader does not promise atomic contents. Later updates can leave already-read values stale. Inserts behind the cursor, deletes, ID rewrites and visibility changes remain outside its identity-preservation guarantee. No current native performance or request-capacity claim follows from a maximum of 2,001 collected rows.

The [older native pagination report](../2026-10-15-workbook-live-pagination/REPORT.md) proves its pinned offset reader under stable data. The frozen V6 APP49 browser captures prove that identified build's journey. Neither accepts the changed keyset reader. No retained database, source anchor, packet, demo, other process or canonical unrelated change is modified here.

The integration owner should execute the correction STATUS's native plan on a separately authorized disposable fixture, using the integrated exact head and actual client/PostgREST. Use canonical UUIDs with nonsequential input order. Retain request parameters, IDs and values at caps 1,000 and 137 for 0, 2,000 and 2,001 scoped projects. At cap two, update the unread third project's timestamp after the first response and require the four original IDs exactly once. Preserve the old-reader failure, harmless survivor and exact restoration. Keep later-page errors, foreign workspace exclusion and live RLS separate from browser/session evidence.

A fresh identified-build browser journey still needs real navigation, desktop and 390px download evidence, console review and usable workbook inspection. This review does not run or accept that journey. The recorded candidate 420/latest17 versus hosted 418/latest15 promotion hold remains unchanged; this report does not refresh hosted state or authorize promotion.
