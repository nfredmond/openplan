# Native jurisdiction candidate verification

October 15, 2026 UTC. This is the delegated native SQL, role, upgrade and restore report for **UNRELEASED** candidate `f18ea8cd51d12168ec2766e1fc5cc34eeb775df2`. The tested migration remains unchanged:

```text
20261017000016_project_jurisdiction_context.sql
SHA-256 1384e6a2767827c2b756d978bd6e76f6fea364e4e1263e953c0358364341267f
```

**The native boundaries exercised here pass.** This report does not approve release, hosted application of migration 16, Next route behavior, browser authentication, practitioner use, or whole-installation recovery. The parent owns those decisions and remaining journeys. Concurrent independent source review round 2 remains separate.

## Scope and authority

The assigned clean worktree `/home/nathaniel/.t3/worktrees/openplan/t3-b34fc7d6`, branch `t3/project-jurisdiction-native-proof`, fast-forwards from `05dd3e8da4a4572437f06e771b0a2477873e681f` to the exact candidate. Only this review directory changes. No application source, migration bytes, other worktree, PR, push, main merge, build, full suite or nested agent is involved.

Read authority includes AGENTS.md; the first current entries of `~/.local/state/openplan/COORDINATION.md`; the V1 contract, roadmap, capability matrix, October 6 direction review, architecture and known issues; the accepted jurisdiction design; the complete original independent report preserved in `../2026-10-15-project-jurisdiction-corrections/original-review/REVIEW.md`; and the parent's private `project-jurisdiction-decisions-20261015.json`. The original independent review commit is `3ff9808bc`; its report's native matrix defines this lane's boundaries. The Supabase, PostgreSQL, prove-it, planner-writing and any-place skills guide the work.

The starting current coordination record names main `b259d73e56d22d4935ef2789874cf69901786b33`, hosted schema 418/latest 15, and the main merge hold pending CI and delivery. This lane does not change that hold or hosted schema. `npm run product:direction:check` passes in `openplan/` with existing review-age, registry and version reminders. No review date is advanced.

## Exact database custody

The retained source cluster is:

```text
container a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce
name      supabase_db_openplan-restore-target-2026091050
image     public.ecr.aws/supabase/postgres:17.6.1.156
server    PostgreSQL 17.6 on x86_64-pc-linux-gnu,
          compiled by gcc (GCC) 15.2.0, 64-bit
source    openplan_attempt_cli_5b3c1368c1c644b99444cd6194af1142
```

The source is read-only for this lane. The final audit compares the full 417-row migration history, role attributes/global memberships, and every recorded source project/corridor row and WKB against its starting records. All match. Candidate 16 is absent from the source. No source writes, role changes, source connection termination, database-wide settings changes, fixture edits or service restarts occur.

The runner creates and retains exactly these new databases:

```text
openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up
openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_restore
```

Before each creation, the proof records its generated name and absence. Each database starts from `template0`, then receives a single-job consistent `pg_dump`/`pg_restore`. No source database is used as a template and no connection is terminated. `proof.json` records their catalog OIDs, ownership and locale facts. Both retained targets finish with 419 migration records through candidate 16. No retained database is deleted.

The original source has **417 migrations through `20261017000014`**, verified against the complete migration-version set at main predecessor `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`. The full source history includes each migration name and statement digest. The first new target receives only reviewed main migration 15, producing **418/latest 15**, followed by candidate 16, producing **419/latest 16**. Migration 15 comes from main `b259d73e56d22d4935ef2789874cf69901786b33`; its SHA-256 is `40a554ab2d1c97791f3e2875ca5ff24350d400bd3e1ec618896bcdeeed097113`. Its body and history insert execute together in the owned target. No automatic migration-up command or hosted apply runs.

## Native results

- **Upgrade:** eight project rows and two corridor rows retain every original field. This includes source legacy/null rows and new pre-migration legacy, searched, uploaded, site and corridor fixtures. Candidate context stays SQL NULL on all old rows. Full JSON records and PostGIS WKB compare exactly before and after migration 16. This checks stored geometry and coordinates, not map rendering or geographic truth.
- **Validity:** 35 native helper cases cover SQL NULL, declared, unresolved and 32 malformed inputs. Every malformed input also reaches the actual table CHECK under trusted postgres and returns `23514`. Cases include unknown/missing keys, scalar/array/null inputs, version/type/state errors, UUID and calendar-time errors, entry shape, 13 entries, oversize content, country/subdivision syntax and malformed namespaced references. The SQL helper accepts syntactically namespaced `unknown:abc`; it does not resolve or establish authority for that identifier. This is a visible SQL/application validation boundary.
- **Direct authorship:** authenticated owner, admin and member INSERT and UPDATE attempts carrying forged actor, historical time and resolver identity return `42501`. The project row stays unchanged. Their ordinary null-context creation and actual study-geometry replacement still succeed. Geometry-only edits preserve a non-null declaration after restore fixtures are established.
- **Read isolation:** real authenticated owner/admin/member/viewer sessions see the five owned project fixtures, the foreign-workspace actor sees only its one project, and nonmember/no-actor sessions see none. Viewer and foreign/no-actor ordinary updates return zero rows and their INSERTs return `42501`. A zero-row RLS update is recorded as such, not mislabeled as a trigger exception.
- **Service attribution:** owner/admin/member attribution succeeds; database clock bounds contain `recordedAt`, the actor remains exact, and the revision advances. Viewer, nonmember, foreign-only, null and missing actors refuse with `42501` and unchanged rows. A service-role INSERT also receives database time. The privileged caller supplies the actor; this database seam alone does not bind it to a browser identity.
- **Membership races:** separate real sessions exercise save-first and revoke/downgrade-first, each for DELETE and role downgrade. Observations include exact backend blocking PIDs and a PostgreSQL `Lock` wait. Save-first holds the membership row until commit, then permits the membership change. Change-first makes the save wait; after the change commits, the save returns `42501` and preserves the original project row. Only owned sessions roll back or commit.
- **CAS:** two concurrent service updates share an exact original revision and different declarations. The second waits on the first, then returns zero rows; exactly one winner's actor/context remains. The native zero-row outcome does not prove the Next route's HTTP 409 or draft behavior.
- **Workspace/project predicates:** a mismatched workspace/project and an unknown project return zero rows. A workspace move held in another transaction blocks the old-workspace save, which returns zero after the move commits. These SQL predicates do not exercise account changes or an in-flight browser response.
- **Restore:** a complete candidate database archive restores to the second new database with exact non-null declared and unresolved actor/time, every project revision, all other project/corridor fields and WKB. A separate postgres INSERT with the jurisdiction guard already installed also preserves the entire row. Trusted postgres UPDATE advances `updated_at` through the existing revision trigger. This is a tested limitation, not revision-preserving UPDATE support.
- **Privilege custody:** real `anon` and `authenticated` session identities cannot `SET ROLE` to postgres, service_role or supabase_admin; each attempt returns `42501`. They cannot execute the trigger function directly. The installed function, grants, RLS policies, constraints, trigger order and global role-membership inventories are retained. This is not an exhaustive audit of every legacy SECURITY DEFINER function or generic dynamic-SQL path in the installation.

## Actual PostgREST transport

The lane starts three uniquely named, labeled helpers over its lifetime. Each points only to the new upgrade target and binds only `127.74.17.10:29944`. The cached image is `sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326`; the running binary reports **PostgREST 14.15**. Synthetic, locally signed JWTs exercise actual role switching and table operations. No Auth service, email, provider, browser or user credentials are exercised.

Owner/admin/member direct context PATCH returns HTTP 403 with code `42501`; viewer/nonmember/foreign/no-actor reads follow native RLS; service writer attribution succeeds with database time; service viewer/foreign/missing attribution returns 403/`42501`; invalid context returns 400/`23514` with unchanged row. These observed mappings align with [PostgREST 14 error documentation](https://docs.postgrest.org/en/v14/references/errors.html). Next route mappings, session cookies, 409/503 handling, Origin checks, account switching and retained drafts remain the parent's work.

All three helpers are **stopped and retained**, with `OOMKilled=false`. Docker reports exit code 255 after the requested stops; this report claims the stopped state, not zero exit status. Full IDs for parent custody are:

```text
8a4c18b56ba3e692862167cd4656679636dfbc5c514827ca2c675a26adcbe3e4
5be17cffb786756ae7e8b87fe5af4226c74ee772ce1ad6473a40d59cd3248698
dd0c0371cf3685fa1097b1da9e119fd188f7671697aa331329b990edbe146368
```

The first helper never became ready because URI form encoding converted spaces in PostgreSQL options to literal `+`. Its failure logs and stopped receipt remain. The corrected URI uses percent-encoded spaces. A subsequent port preflight encountered TIME_WAIT without a listener; enabling socket address reuse corrected that preflight. No foreign listener or container is stopped.

## Mutation and oracle controls

The selected final cohorts record 39 native, 164 extended, 21 race-control and 16 transport observations. These are observation records, not independent test counts. Earlier complete and failed attempts remain private.

Harmless comment changes survive the same intended assertions. Targeted database mutations fail their named assertions, then transaction rollback or `finally` restores installed SQL:

- Removing the ordinary-role guard lets the forged write through and defeats the exact `42501` assertion for every owner/admin/member INSERT and UPDATE.
- A constant-true SQL validity function defeats each of the 32 malformed helper assertions and each corresponding real CHECK assertion. Dropping the CHECK separately defeats the malformed-row assertion. These controls preserve input delivery to the database.
- Removing database time stamping defeats the time-bound assertion. Redirecting the actor-membership predicate or weakening writer rank defeats the corresponding `42501` assertion.
- Replacing `FOR SHARE` with `FOR KEY SHARE` permits a concurrent non-key role downgrade and fails the save-first blocking assertion. Removing the lock defeats save-first downgrade and revoke assertions. Redirecting to another member defeats change-first waits for both transitions. The distinction follows PostgreSQL's [documented row-lock conflicts](https://www.postgresql.org/docs/17/explicit-locking.html).
- Omitting revision creates two CAS winners; omitting the workspace predicate writes the mismatched foreign project. Both fail the specific winner/zero-row assertion.
- Disabling project RLS exposes the fixture to a nonmember and fails the exact read-set assertion.
- Corrupting actor, time, revision or geometry in the trusted INSERT trigger fails the full-row restore assertion, independently for each field category.
- An overbroad guard prevents ordinary creation and actual geometry replacement. Separate actor-specific assertions fail for the intended `42501` obstruction.
- The actual JWT transport assertion survives a harmless SQL comment and fails when the ordinary role guard is removed, returning HTTP 200 instead of 403/`42501`. The restored guard again refuses.
- Ordinary-role custody controls intentionally run the same role-assumption refusal assertion from a privileged session and observe its intended failure. They change session identity only, never global role grants.

Upgrade geometry/site/corridor and restored-provenance readback controls also detect deliberately altered in-memory snapshots. Those oracle controls do **not** execute a corrupted archive restore and are labeled accordingly. Native archive restoration and live-trigger INSERT have separate actual executions. Final audits compare reviewed function bodies exactly in both targets. Installed grants, trigger definitions and other inventories remain reviewable in `installed-inventory.json`.

The guards have bounded visibility: direct-write assertions cannot establish an approved human origin; SQL shape checks cannot resolve geography; RLS fixtures do not exhaust all application tables or legacy definers; synthetic JWTs do not establish Auth/cookie behavior; CAS predicates do not prove UI conflict recovery; same-cluster logical restoration does not prove physical-host disaster recovery, Storage bytes, encrypted integration secrets, providers, full installation configuration or recipient usability.

## Resources and retained trials

The runner uses a systemd user service with **MemoryMax=1 GiB, MemorySwapMax=0 and one CPU**. Its cgroup limits are checked inside each final runner invocation. The final serial combined-control service reports a 51.7 MiB peak and zero swap. Each new PostgREST helper uses Docker memory 512 MiB and memory-swap 512 MiB, with 0.5 CPU and 128 PIDs. In Docker's combined-limit convention, this permits no helper swap.

**The retained PostgreSQL server is unbounded**, with Docker Memory=0 and MemorySwap=0 before and after. The runner cap does not cap PostgreSQL execution in that existing server. Serial ordinary statements use session work_mem 16 MiB, statement timeout 10 seconds and lock timeout 3 seconds. The dump/restore client sessions use the same work_mem and lock timeout, with a 120-second statement timeout. Only the explicit race probes overlap SQL sessions. No scale workload runs. Initial disk headroom is about 50 GiB; available host memory is about 16.6 GiB and host swap is nearly full. No image download or build runs.

Private evidence root:

```text
/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-jurisdiction-native-20261015
```

The successful upgrade/archive run is `run-fba198344db5`. It retains the original source inventory/snapshot, 417 dump, pre/post-16 snapshots, 419 dump, restore snapshots, full row comparisons, lock-wait records, error diagnostics and every helper receipt/log. Files are mode 0600 and directories mode 0700. Protected runtime env files contain credentials; they are never printed or committed.

Retained early failures also include the initial relative-path systemd launch, the PostGIS schema assumption (`extensions` versus actual `public`), a missing-actor test that accidentally selected the helper's default owner, a lock-status sampling race, and an attempted SQL NULL overwrite of an already non-null context. Corrections fix the runner's assumptions. They do not change candidate SQL or weaken product assertions. Early attempts did not capture per-invocation runner hashes. Final successful cohorts retain source-binding snapshots for the exact four proof scripts; the final audit additionally hashes itself. The original migration, before/after rows and dump digests remain separately bound.

## Reproduction and handoff

Use Python 3 with the installed `psycopg2` and `requests`. No package install is needed. Run absolute paths under a new named bounded systemd service, as recorded in the private final log. For a fresh proof, copy this proof directory into a clean isolated checkout at exact candidate `f18ea8cd51d12168ec2766e1fc5cc34eeb775df2`. The setup runner intentionally checks that HEAD. Then `native_proof.py setup` creates a new uniquely named pair and prints its private `run-*` directory. Then run, serially, against that run:

```text
native_proof.py proof --run <run-directory-name>
extended_controls.py <run-directory-name>
race_controls.py <run-directory-name>
transport_proof.py <run-directory-name>
```

`audit.py` is the dated final-audit/publication runner for the retained `run-fba198344db5`. It is bound to that run and writes its own new private audit directory. Do not apply it to another installation without changing that explicit binding and reviewing its output destination. New proof operations retain unique attempts; they do not reset or delete a prior database.

The parent receives both retained database names and all new helper IDs above. Candidate 16 remains unapplied to hosted services. The parent still owns identified-build route/browser work, account/draft/failure journeys, combined map/jurisdiction artifacts, whole-installation restoration, independent source review disposition, recipient/practitioner acceptance, CI, rollout and the merge hold.
