# Workbook pagination on local PostgREST

The pinned correction passes the bounded native checks at response caps of 1,000 and 137. The original single-limit route reproduces silent 1,000-row truncation and misses the 2,001-row refusal. I find no new functional defect in the corrected source within this stable-data proof. This is an in-process GET handler proof against real local PostgREST, with the actual workbook serializer. It does not establish a browser session, HTTP Next server, downloaded-file custody, native worksheet use, transactional snapshot or release acceptance.

## Source, direction and ownership

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-cc1f2875`, branch `t3/workbook-live-pagination-proof`. It starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f`. It reads AGENTS, fetches and fast-forwards to `b259d73e56d22d4935ef2789874cf69901786b33`, then reads current AGENTS and the first external coordination entries before native setup. Application files remain unchanged. Ownership covers this review directory and the private proof root:

```text
/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/workbook-live-pagination-20261015
```

The implementation under test comes from Git objects at exact `54537205a4f7c47f1f68f0827209bbf55de505d9`, whose production correction comes from parent `702ee1270de23cb9e469711398c580d9a977878b`. Private extractions preserve pinned source bytes. [Source bindings](evidence/source-bindings.json) record Git blobs and SHA-256 values. The route hash is `efd81d2e4a2bc9b181dca617d60c5ce6b21f9db65b596f306f4fa1d11257bbd9`; the unchanged serializer hash is `24f201a4eed2fa91dabecca90352c6620a7f5d4d8ead442d4b1d7457bfa54e5d`.

The complete pagination and integration STATUS records at 545 and independent REVIEW at `dec06621eb1ec0b4a2ce5588249424c638801567` inform the work. Their 75 focused cases and 17 independent boundary probes remain prior source evidence, not native cases rerun here. Import correction `536d4ccbd6` is not an ancestor of 545. Its correction and 49-case import cohort are not integrated or verified by this proof. Another child owns combined integration.

The candidate owner `t3-32433c82` remains clean at 545. Independent review owner `/home/nathaniel/.t3/worktrees/openplan/t3-ffbdeb11` remains clean at dec06621 and receives no writes. [Owner checkout records](evidence/owner-checkouts.json) preserve their final heads and status. No application edit or source-owner checkout mutation occurs.

The V1 contract, roadmap, capability matrix, October 6 direction review, known issues and architecture inform this bounded lane. The nested [direction check](evidence/direction.log) passes with its existing registry, version and intervening-change reminders. No direction date or capability grade changes. Planner-writing, prove-it, Supabase and Postgres guidance apply. The current external main merge hold remains in force.

## Database custody and resources

The only created database is:

```text
openplan_workbook_native_f022913ef7654f40b2795c55
```

Its catalog OID is 6103255. It starts from `template0`, owned by postgres, using `en_US.UTF-8`. It receives one consistent custom-format dump and single-job, single-transaction restore from the authorized read-only source:

```text
openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up
```

Both reside in the exact retained cluster:

```text
a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce
supabase_db_openplan-restore-target-2026091050
```

The source has 419 migrations through `20261017000016`; the new target retains that exact boundary. No migration runs. The source is approximately 111 MB; the retained dump is 15,076,357 bytes. The preflight records 49,773,031,424 available disk bytes, about 17 GiB available host memory, and nearly exhausted host swap. The runner enforces `MemoryMax=1G`, `MemorySwapMax=0`, a 640 MiB Node heap, one Vitest worker and no file concurrency. Dependencies mount read-only; Vite uses private caches. Successful native scopes record peaks of 266,162,176, 260,194,304, 262,352,896 and 268,615,680 bytes, with no OOM events.

The retained PostgreSQL container has memory and memory-swap settings of zero, meaning no container memory bound. This proof does not bound the database server. Its limits and settings remain unchanged. Owned SQL sessions use `work_mem=16MB`, statement and lock timeouts, and execute serially. Dump and restore use one job and a 16 MB work-memory setting. No source connection is terminated and no global role changes occur.

The new helper containers use the cached PostgREST 14.15 image `sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326`. Each binds only `127.74.18.10:29946`, points only to the new target, carries purpose/database labels, mounts no volume, and uses 512 MiB memory, 512 MiB memory-swap, 0.5 CPU and a one-connection pool. Equal Docker memory and memory-swap values permit no additional swap. Each helper stops in `finally`; none is removed. Full retained IDs follow.

| Helper purpose | Full container ID |
| --- | --- |
| Initial cap 1,000, Vite startup refusal | `b47963969d3df7a367536adf8db6da1247b0006f212a59412338e3e2f5e5e65d` |
| Initial cap 137, classifier selection refusal | `b4fb0aa3bdb6861117ae90d0146dd5cd3556f27f11382a6e87789fb6d0b84311` |
| Cap 1,000, real short-page survivor | `e5a516ba1b4eed853bf73a64199ec0b1e4507ececc78f9dff95c276e22428322` |
| Cap 1,000, wrong expected diagnostic | `21f141c69589b86d3ab8db6b275538f0fabcf65fa552c9360f1f3ab6435da718` |
| Complete cap 1,000 control cohort | `9baae8345e2fa5869ea6299a4f819e3c2baad8175a13c4e5511b707578f08aa6` |
| Complete cap 137 control cohort | `9be5aa5a625b4828d74bd6e33875736cb588db4c6bd4f842317622eec01b2010` |
| First original-reproduction oracle controls and final cap 1,000 | `7b080b56d7090b28dd0251016964f869be4c00026d7f6bbee3bad0e150743d62` |
| Both original-reproduction oracle cases and final cap 1,000 | `19509fee809b95344af9c176902c835b197a332910821f81b465039a69953caf` |

[Helper receipts](evidence/helpers.json) include names, full IDs, cap configuration, resource records and stopped state. All eight are stopped and `OOMKilled=false`. Their stopped exit code is 255; this is recorded, not treated as a successful normal service exit. The database remains retained. No source, baseline 417/main 323 fixture, prior proof target, demo, hosted installation, public API or other helper is written, reset, deleted or stopped.

Private directories use 0700 and regular files use 0600, including credentials, dumps, source inventories and workbook bytes. Shared dependency symlinks are excluded from permission changes. The committed material contains sanitized runners, receipts and evidence only. No password, JWT, private URI or raw source inventory is committed.

## Real handler and native results

The test executes the exact exported `GET` and real `NextRequest`/`NextResponse` in a single Node worker. The actual Supabase client sends range requests to the helper. Its fetch adapter removes only the absent local gateway prefix, records real HTTP responses, and otherwise returns them unchanged. The serializer wrapper records inputs and calls the actual pinned serializer.

Two explicit module adapters replace cookie-bound client creation and active-workspace lookup. A generated authenticated JWT supplies the synthetic actor; `auth.getUser` supplies that fixture identity. Workspace and viewer membership rows are read from the real database under that JWT before the adapter selects them. The audit logger is a no-op. This is minimal auth-context test plumbing, not full Next Auth, provider validation, cookie authentication or browser login.

All inserted records are synthetic and live only in the new target. Six new workspaces contain 0, 1,000, 2,000, 2,001, seven and three projects. The actor has viewer membership in the first five. The extra accessible workspace challenges selected-workspace scope. The inaccessible three-row workspace is retained but does not receive a separate direct-isolation assertion. This is not an exhaustive RLS proof.

Rows are inserted in reverse fixture order and assigned two timestamp groups with many UUID ties. User triggers are disabled only within the new-target fixture transaction for installing those timestamps, then reenabled before commit. Final project rows match their original fixture records exactly. Source-location text, site coordinates and null legal/jurisdiction context remain separate facts. The export does not infer legal authority from the synthetic source reference or location text.

Each native baseline and final restoration executes five cases. The outcomes are:

| Portfolio rows / case | Cap 1,000 reads | Cap 137 reads | Actual GET response |
| --- | ---: | ---: | --- |
| 0 | 1 | 1 | 200, header-only Projects sheet |
| 1,000 | 2 | 9 | 200, all rows |
| 2,000 | 3 | 16 | 200, all rows |
| 2,001 | 3 | 15 | 409, `row_limit`, no serializer call |
| Second-page SQL error | 2 | 2 | 500, JSON, no serializer call |

[Final native evidence](evidence/final-native.json) records every offset, requested limit, exact projection, workspace predicate, timestamp/ID ordering, actual native HTTP status and Content-Range. It retains first/last IDs and an ID-sequence hash for each page. At cap 1,000, the 2,000-row case requests offsets 0, 1000 and 2000 with limits 1000, 1000 and one. The final read returns an empty array with `Content-Range: */*` and HTTP 200. The 2,001-row case receives the last sentinel at offset 2000 and refuses. At cap 137, offsets advance by actual received rows; the final sentinel request ends at index 2000.

Every successful case compares actual page rows against independently ordered SQL originals, including the exact projection. The serializer receives those same original rows and selected workspace metadata. The actual response bytes equal the actual serializer's output from those originals and the captured generation time. Checks cover attachment filename, XLSX content type, `private, no-store`, Projects/Read me sheets, exact headers, row count, original project IDs, blank unknown price years, and literal operator-prefixed names without formulas. Fixture amounts are 42.01 and 123456789.12; source-document IDs are null. This does not test every numeric precision or nonnull document-reference case.

The meaningful later-page fault rewrites the second outgoing native query's projection to a nonexistent column. PostgREST itself returns HTTP 400 with SQLSTATE `42703`. The handler returns HTTP 500, the stated read-error diagnostic, JSON content type and no attachment header. It never calls the serializer and issues no third read. No successful response data or native error object is mocked. The fault changes only this private request, not database schema or retained source.

The [original route reproduction](evidence/original-reproduction.json) executes the original main route against the same real cap and target. Its single `.limit(2001)` read returns 1,000 rows for both 2,000 and 2,001 native projects. Both actual GET responses are 200, and both physical workbooks contain 1,001 rows including the header. The former omits 1,000 projects; the latter omits 1,001 and misses `row_limit` entirely.

## Named controls and restoration

The completed cap 1,000 cohort contains 34 accepted trials, covering five-case baseline, five-case harmless comment survivor, two original reproductions, 15 named route faults, 15 targeted restorations and a five-case final restoration. The cap 137 cohort contains four accepted trials: five-case baseline, five-case harmless survivor, the short-page fault, and five-case final restoration. An additional nine trials challenge both original-reproduction cases with original baseline, harmless comment, corrected-source failure and restored original, then final corrected five-case restoration. Together these completed groups contain 47 accepted trials and 76 active case executions. Earlier accepted trials, including the first single-case original-oracle cohort, remain separate and do not inflate these counts.

| Private source fault | Required assertion failure |
| --- | --- |
| Stop after the first page | `live read must retain all supported rows or exact sentinel` |
| Advance offset by one extra row | `live paging offset must advance by actual received rows` |
| Remove summary from projection | `native query projection must retain all exact selected columns` |
| Omit workspace equality | `native query must use selected workspace` |
| Reverse timestamp order | `native query must use timestamp desc and id asc` |
| Reverse UUID tie order | `native query must use timestamp desc and id asc` |
| End below the sentinel | `live inclusive request must end at bounded sentinel` |
| Change successful GET status | `complete workbook must retain HTTP 200` |
| Change over-limit status | `route refusal must retain exact HTTP status` |
| Change later-error status | `route refusal must retain exact HTTP status` |
| Break on error and serialize a partial portfolio | `route refusal must retain exact HTTP status`, actual 200 instead of 500 |
| Slice serializer input | `serializer must receive every original projected row` |
| Substitute workspace name | `serializer must retain selected workspace name` |
| Substitute unknown price year | `serializer must receive every original projected row` |
| Make the response publicly cacheable | `workbook response must remain private no-store` |
| Treat a short page as exhaustion at cap 137 | `live read must retain all supported rows or exact sentinel`, actual 137 instead of 2,000 |
| Use corrected source in the original-reproduction oracle | `original must issue one capped read` |

[Trial evidence](evidence/trials.json) records test names, actual first-line assertion diagnostics, exit codes and exact restoration hashes. Harmless comments survive. Each fault changes a private source copy and restores the exact pinned bytes in `finally`. The original-reproduction oracle has its own harmless survivor and restored original control. All completed scopes then execute the corrected five-case final cohort.

The strict classifier requires the exact private test path, exact selected active case names, matching summary/pending counts, expected exit and an exact first-line named `AssertionError`. Runtime, timeout, import or unrelated assertion errors cannot count as kills. Nine synthetic classifier refusals cover empty/inconsistent counts, wrong file/name, nonzero success, false kill, runtime failure, wrong assertion, embedded diagnostic and timeout. A vacuous classifier fails `classifier harmless baseline survivor`. The final classifier reclassifies all 60 retained accepted trials, including earlier cohorts, without changing historical classifications.

Eight [pure safety guard groups](evidence/safety-controls.json) cover database allowlist, retained cluster identity, runner bounds, helper identity, helper database label, helper memory/CPU bounds, loopback/no-mount custody and exact helper URI. Each has a passing baseline, harmless survivor, omitted-guard failure with the named diagnostic and restored positive. Altered metadata never starts an unauthorized helper or connects to an alternate database. These controls cannot prove Docker or database isolation beyond the metadata inspected.

The [preservation record](evidence/preservation.json) compares source projects, corridors, workspaces, memberships, auth users, complete migration rows, global role attributes and global memberships before and after. Their digest matches exactly. All new synthetic project rows and target 419 history also match. Harmless readback copies survive; corrupted project/history/role/membership readbacks fail the preservation comparison. Those are in-memory oracle controls, not source corruption or damaged-archive restore tests.

## Failed trials remain visible

[Earlier failures](evidence/earlier-failures.json) and [refused trials](evidence/refused-trials.json) preserve these boundaries:

- The first fixture insert omits required cost recording time. PostgreSQL rejects `projects_estimated_cost_coherence_check`; the transaction rolls back.
- The next insert omits required place recording time. PostgreSQL rejects `projects_place_coherent`; the transaction rolls back. The successful fixtures satisfy both constraints.
- Vite first tries to write `.vite-temp` into read-only shared dependencies. No test runs. The private runner switches to the native config loader and private cache.
- The first cap 137 targeted run excludes four unrelated tests. The classifier initially compares all reported cases with the selected active case and refuses classification. Its corrected form explicitly accounts for excluded cases.
- A short-page break is a genuine survivor at cap 1,000, because full 1,000-row pages still reach exhaustion. It is not counted as killed. Its cap 137 binding then fails the stated row-count assertion.
- One first-page fault fails the page-count assertion rather than the expected row-count assertion. The classifier refuses the mismatched diagnostic. The revised fault breaks immediately after appending the first page and fails the intended row-count assertion.
- The first attempt to redirect the repeated direction check uses a path relative to the wrong working directory. Shell redirection fails before npm starts. The separate nested run succeeds and supplies the committed direction log.

None of these harness or fixture failures establishes a corrected-source defect. Original private reports, logs, refusals, workbooks, dumps and stopped helper receipts remain retained.

## Limits and rerun

Offset pagination remains a sequence of independent reads. Concurrent inserts, deletes, updates or visibility changes can omit or repeat rows. An empty successful page does not prove a transactional snapshot or distinguish every concurrent visibility loss. No giant portfolio, cap-one stress, production deadline, load, byte-capacity or performance acceptance is claimed.

The material comparison uses the unchanged pinned serializer as the format oracle. It does not independently validate a coordinated future serializer/contract rewrite. The fixture covers specific decimal values, null document references and synthetic US source labels; it does not establish arbitrary precision, every source reference, legal applicability or nationwide planning acceptance. It preserves geography and legal context as separate facts.

No full suite, build, browser, public API, provider, hosted/cloud operation, migration application, PR, push, merge, nested agent or release occurs. The parent retains real route-session authentication, browser navigation, desktop/390px evidence, download custody, native worksheet usability, integrated import behavior and release acceptance. This local commit supplies a bounded native test handoff only.

`native.py` reads credentials directly from the exact retained cluster/helper into memory and protected files. A fresh rerun requires a fresh private proof root and newly generated target, not deletion or reset of this retained database. Update the private-root constant in all runners together before a new run. Extract the same Git objects into that fresh root, then run `setup`, followed by `helper 1000`, `helper 137`, and `helper 1000 extra`, using the same bounded wrapper:

```bash
systemd-run --user --scope --quiet -p MemoryMax=1G -p MemorySwapMax=0 \
  bwrap --bind / / --dev-bind /dev /dev \
  --ro-bind /home/nathaniel/code/openplan/openplan/node_modules /home/nathaniel/code/openplan/openplan/node_modules \
  python3 -B docs/reviews/2026-10-15-workbook-live-pagination/native.py helper 1000
```

Then run `safety_controls.py` and bounded `native.py final`. Existing helper proof directories archive visibly before a retry; existing databases are never dropped. The source/history and target-preservation checks remain separate from the native route checks. Current API documentation supports inclusive range semantics and API-cap behavior: [Supabase range](https://supabase.com/docs/reference/javascript/range), [PostgREST pagination](https://docs.postgrest.org/en/v14/references/api/pagination_count.html). Installed-version behavior and the retained native evidence govern the results here.
