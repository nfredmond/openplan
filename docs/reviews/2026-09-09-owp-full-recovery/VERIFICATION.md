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

## Retained two-cycle target checkpoint

Run 5 retained `openplan-restore-source-3112923` and `openplan-restore-target-3112923` under `/tmp/openplan-restore-drill.ESjqA3`. Complete capture/restore now compares 287 tables including large objects, sequence positions, the compiled schema and database properties. Both the full inventory and independent two-cycle reconstruction match before/after. Password sign-in and private file bytes pass. The recorded balances are 3.00 prior claim, 8.00 successor claim, 15.00 commitment, 1.00 refund remaining and 20.35 incurred, with five physical entries. Original 20.00 and corrected 19.00 carryover approvals retain their separate identities.

The combined script then stopped on an inherited one-member assumption in its evidence relationship count. The additional independent reviewer made that count two. The query now binds membership to the document uploader; it accepts both legitimate members and rejects absent uploader membership. The first adverse attempt hit the existing last-owner protection, so it was not counted. A corrected rolled-back probe first supplied a second owner and then removed the uploader membership; the actual query returned `0:false`, while baseline and harmless control return `1:true`. No source or durable membership change remains. The restored-target RLS suite is running separately. Complete script rerun and browser/QA acceptance are still pending.

Database metadata includes the original owner, normalized grants, locale/encoding, connection limit and a hash of database/role settings. Private settings are applied over stdin and excluded from public evidence. This repairs the `pg_database_owner` defect rather than granting broad public-schema access. A producer-derived fixture supports adversarial reconstruction tests, including lost approval authorship, changed costs, duplicate physical identities, overmatched cash and mixed currencies. Optimized Python is refused so assertion removal cannot turn the verifier green.

## Completed archive drill and local environment correction

Full drill 6 completed end to end using owned projects
`openplan-restore-source-3390964` and `openplan-restore-target-3390964`, retained at
`/tmp/openplan-restore-drill.yBEWX9`. It restored 287 tables and one Storage file,
matched the full inventory and independent two-cycle reconstruction, signed in,
verified bytes and uploader relationships, and passed live RLS. Run 5's separately
invoked restored-target RLS also passed all 321 tests in 40 files.

The older report fixture referenced a nonexistent, out-of-scope Storage path and
the KB fixture advertised zero chunks despite retaining one. Those were test
fixture defects, not demonstrated production losses. Run 6 uses the actual
supported inline HTML artifact shape and correct KB metadata.

The first full local QA attempt stopped at ESLint: shared main `node_modules`
contained Next/eslint-config-next/plugin 16.2.11 while this checkout's lockfile
requires 16.3.4. Its missing newer rule is an environment mismatch, not a reason
to remove the source's download exception. The worktree's dependency symlink was
removed and replaced with its own `npm ci` installation. Earlier browser
inspection against 16.2.11 is exploratory; acceptance will use locked dependencies.

Focused restoration tests currently pass 27 tests. Full local ops tests passed
all runnable suites; native layout could not run because `xvfb-run` is absent.
That unchanged suite remains mandatory in final CI. Full QA and browser acceptance
are still in progress; none of these partial results counts as release completion.

## Browser-discovered library defect

At identified v0.49 candidate `56ce1ac5825446d1418211e5b55cb7a0ccbebf91`, the
1440px browser journey restored the old balances/history, downloaded original and
corrected approvals, refused a closed-period write, recovered an interrupted
history read, and resumed successor work after an accepted-but-lost save response.
The retry retained one new draft and left old approvals unchanged. KB file bytes
also downloaded correctly. The journey then failed to find the report download
link in Documents. This is a real existing product defect: the library checked
only `storage_path`, while the report producer and download route also support
inline `metadata_json.htmlContent`.

The adapter now selects that JSON field through the existing scoped parent join
and checks the same string/kind condition as the owning download route. It returns
only the route in library entries; the HTML never becomes an index entry field or
citable text. Tests exercise actual projection, malformed/non-string content,
wrong artifact kind and accidental body exposure. One harmless mutation survives;
removing the projection/availability/type/kind protection or leaking the body
fails the corresponding query tests. The library still fetches retained HTML to
check availability; its existing per-source count cap is not a byte-size bound.
Large artifact listing cost remains an M2 library scaling concern.

The locked-dependency representative restore rerun completed all stages,
including restored sign-in, file/relationship checks and live RLS. The earlier
representative run's CLI lookup failed while the worktree dependency link was
being replaced; that timing is a plausible cause, not a proved diagnosis. The
failed run is retained as failed. The v0.49 bump initially missed four product
version markers and caused six direction-guard failures in both test orders.
After those markers were aligned, shuffled seed `651414` passed 1,232 files and
13,451 tests (33 files/299 tests skipped, chiefly separately run live suites).
Production build at `56ce1ac5` passed using Next 16.3.4. That build's incomplete
browser journey does not establish acceptance of the subsequent library repair.
