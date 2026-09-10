# OWP full recovery implementation

Status: implementation and verification in progress. This is not a completed recovery or v1 claim. v0.48.0 is [published](https://github.com/nfredmond/openplan/releases/tag/v0.48.0) at `e39258b92f119d5b7d8326155f99188d43a7eaf3`; its final QA, shuffled, RLS and upgrade checks passed before tagging. Development continues under Nathaniel's September 9 direction without human-review gates.

## Scope and ownership

The isolated checkout is `/home/nathaniel/.local/state/openplan/owp-full-recovery-2026-09-09`, branch `work/owp-full-recovery`, based on main `aed2f3d3`. This work owns the existing disposable restore drill, its supporting scripts/tests, recovery documentation and this evidence. No application workflow, migration, financial guard or pending reminder constraint has changed. No other active coding session was observed at takeover.

Extend the existing M2d.4/M3 recovery path. `--full-archive` uses a fresh source and target, captures the complete custom PostgreSQL archive and the Storage volume, restores into a new database made from `template0`, retains the target's bootstrap database, and compares table data, large objects, materialized views, sequence positions, schema, database ownership/ACL/settings and file bytes. Source API/Auth/Storage writers stop during capture. The drill creates no workers or scheduled SQL jobs. Runtime images and cluster role definitions must match. Settings values and credentials remain private; evidence contains their hashes.

A separate schema-only replay supplies the expected PostgreSQL-normalized definition. The original source schema hash remains retained and source data is checked again before restoration. This handles PostgreSQL flattening redundant AND parentheses without weakening the comparison to row counts or stripping meaningful SQL syntax.

The existing representative mode remains available. Auth fixtures now use the local Auth producer and retain identities, allowing actual password sign-in after either restoration mode. Cleanup records which projects this invocation created and refuses to start or stop an existing project. Optional `OPENPLAN_RESTORE_KEEP=1` retains only the owned test projects and private scratch files for subsequent browser acceptance.

The two-cycle fixture uses the actual work-program save, review, adoption, actuals, reporting, reimbursement, reconciliation and closure commands. It preserves a 20.00 original carryover approval after correction to 19.00, leaves a prior 3.00 unpaid claim, 15.00 commitment and 1.00 refund outstanding, and records 8.00 of new successor work. Total incurred cost across the fiscal and overlapping calendar cycles is 20.35. Exact retries and attempted reuse of the old physical source are exercised. A separate Python calculation reads retained source records rather than importing application calculators.

## Findings and errors retained

- The first launch ran from the repository root and selected a different CLI cache, which began pulling newer service images. That owned process was stopped. The package-root CLI is 2.111.0; its restarted probe reports the same images as the original source: PostgreSQL `17.6.1.156`, Auth `v2.194.0`, PostgREST `v14.15`, Storage `v1.67.20`. The entry script now changes to the app root itself.
- An exploratory full copy of the older disposable verification database restored 67 reconciliation versions and the retained baseline. Auth sign-in worked on the copied target. That capture was not quiesced and is not a recovery-point acceptance claim.
- Full drill 1 restored table contents but rejected a schema-text difference. PostgreSQL removed redundant parentheses from the engagement slug CHECK. Independent schema replay now normalizes the captured definition through PostgreSQL itself; other definition changes remain detectable.
- A mutation of the role guard escaped an incomplete mock and attempted Docker operations against placeholder names `auth`, `rest` and `storage`. None existed and no container stopped. The tests now stub that boundary and detect reaching it before role validation.
- Full drill 2 restored 285 tables and one file but stopped on a restart-time HTTP 502. The progress message claiming RLS had begun was incorrect. Readiness is now checked before the explicit login/download markers.
- The table census used SQL `LIKE 'pg_%'`, whose underscore wildcard also excluded `pgsodium`. It now excludes only the literal `pg_` prefix and includes large objects, materialized views and sequence positions.
- Full drill 3 restored 287 tables and the file, and signed in successfully. Its live RLS suite exposed the real database-owner defect: creating the recovered database as `supabase_admin` changed the meaning of `pg_database_owner` and denied operations in `public`. The implementation now recreates the original database owner, database grants and settings and includes them in custody comparison. That failed RLS result is not regraded.
- The two-cycle producer probe completed, but it was added after drill 3's capture. It was not part of that archive. Drill 4 stopped because the independent reader expected the HTTP route's combined `closures` field in the narrower RPC response. It now reads the closure records separately. Integrated acceptance remains pending.

## Verification status

TypeScript checking passed after adding the producer fixture. Focused Python tests and mutation controls cover ownership, runtime/role matching, nonempty targets, scheduled jobs, source and target comparison calls, missing/changed tables and schema, archive paths/bytes, sequence positions, read-process failure and service readiness. Harmless mutations survive. Updated database-properties and reconstruction checks are still being completed; do not infer final acceptance from the earlier test counts.

Current live run: `full-drill-5`, with owned projects retained for browser verification. Scratch evidence is under `/home/nathaniel/.local/state/openplan/owp-full-recovery-evidence-2026-09-09`. Raw archives, settings, Auth responses and credentials must remain outside git. Next: finish the integrated restore, compare independent reconstruction before/after, run restored-target RLS, inspect desktop/390px/keyboard/download/retry journeys on an identified build, finish applicable QA and inspect final main CI before release.

## Scope limits and source basis

This verifies the default local CLI database and Storage topology. It is not a production cutover, a migration of custom cluster roles or delegated database grants, a remote/hosted restore, or complete recovery of external worker directories, encryption configuration, external Auth providers, mail or outgoing services. Those remain in M3. An archive preserves recorded evidence; it does not validate real agency eligibility, bank transactions or prescribed forms. Unresolved fund availability must not be inferred from a gross budget or this synthetic scenario.

PostgreSQL documents [restoration into an empty template0 database](https://www.postgresql.org/docs/17/app-pgrestore.html). Supabase's [platform-to-self-hosted guide](https://supabase.com/docs/guides/self-hosting/restore-from-platform) separately identifies configuration, identities and object-storage requirements; its filtered platform migration is a different topology. The default-local procedure here is being established through actual matching-image restoration and access tests, not assumed from the capture examples.
