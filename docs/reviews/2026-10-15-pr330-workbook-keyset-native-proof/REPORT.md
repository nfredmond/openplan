# PR 330 keyset reader: bounded native transport proof

The reviewed keyset reader passes this bounded native transport proof. It reads complete supported portfolios through actual Supabase/PostgREST at response caps 1,000 and 137. With cap two, an unread project's timestamp edit preserves all four original UUIDs exactly once. The old mutable-offset reader returns four rows but duplicates one UUID and omits another. Its exact-ID assertion fails; the harmless comment and restored reader pass.

Preservation has one explicit limit. All five protected database fingerprints, all 22,633 protected file fingerprints, and every fixture table's row fingerprint match. The new target's `pg_class` catalog digest changes. The original full-catalog assertion fails and remains retained. The other captured target catalogs match. The baseline stores a digest, so I cannot identify changed `pg_class` fields or accept complete target-catalog preservation. This does not change the observed route results.

## Identity and authority

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-953bb086`, branch `t3/pr330-workbook-keyset-native-proof`. It starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwards only to `75931937aa85950da68577abef1246d7f3c8ff13`. Its app tree is `c89e9ec4eeddfc973641e8683df7bc9d38113838`. The parent integration checkout remains separate. The report commit changes only this directory. The donor dependency symlink is ignored.

I read assigned AGENTS, the external coordination file through its last October 15 01:37:53 UTC entry, the contract, roadmap, capability matrix, latest direction review, limitations and architecture. The nested direction check exits zero before the proof and at packet preparation, retaining existing expiry/version/intervening-change reminders. Supabase, Postgres, planner-writing and prove-it guidance applies. Current Supabase changelog and API/RLS documentation were consulted; no dependency, engine, migration or provider upgrade occurs.

The root reports combined 217 tests and full-tsconfig TSC at `bba8ceb689`, with exact before/after source identity, and three source reviews without material findings. Those are supplied prior evidence. This task does not repeat or independently accept them. The correction and review remain [source evidence](../2026-10-15-pr330-workbook-stable-pagination-fix/STATUS.md) and [independent review](../2026-10-15-pr330-workbook-stable-pagination-independent-review/REVIEW.md). The [old native proof](../2026-10-15-workbook-live-pagination/REPORT.md) supplies a runner starting point, not acceptance of the current reader.

The private root is `/home/nathaniel/.local/state/openplan/pr330-workbook-keyset-native-proof-20261015`. Credentials, exact helper environment files, original full SQL readbacks, raw failed reports/logs, emitted workbooks and full source/file manifests remain there. Published evidence contains synthetic records, selected-field fixtures, retained workbook cell values, HTTP traces and hashes. It contains no credentials or raw private histories.

## Database and resources

The only new database is `openplan_pr330_native_32e91518d541497fbe62e201`, OID `6165620`, owner `postgres`. The exact random name is reserved privately and checked absent before creation in retained cluster `a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce`, named `supabase_db_openplan-restore-target-2026091050`. PostgreSQL reports 17.6. The database remains retained.

A V6 preservation manifest locates the fixed dump. Readback verifies 16,232,305 bytes and SHA-256 `181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398` before one serial, single-transaction restore. No new dump occurs. Target history has 419 rows through `20261017000016`, with full private history-row SHA-256 `938ea2f8a59897de545b0d6c2c575cf8f6920c627b82e3973d6728e7d4ffeee8`. This is a workbook-read fixture at 419/latest16, not current-main/420 schema. Migration 17 is not applied.

Preflight records 3,462,832,128 available disk bytes and 15,654,584,320 available memory bytes. The source database is 110,668,947 bytes. The existing server is uncapped: Docker memory and memory-swap settings both report zero. This proof does not establish database capacity. Host swap is already exhausted at preflight; no cleanup or swap change occurs.

Restore, SQL, native tests and controls run serially under `/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock`, in owned systemd scopes with 1 GiB memory, zero swap and 50 percent CPU. Vitest uses one worker, no file concurrency, a 640 MiB Node heap and private Vite caches. The authorized donor at `/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules` is bound read-only during native tests. SQL uses 16 MB work memory, 30-second statement and three-second lock timeouts; restore uses a 120-second statement timeout. Helpers use ten-second statement timeouts.

Six newly created PostgREST helpers use cached image `sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326`, version 14.15. They run serially on collision-checked `127.74.19.12:29950`, each with 512 MiB memory, equal memory-swap, 0.5 CPU, 128 PIDs, one database connection and no mounts. Each helper carries the exact target and purpose labels. Every created helper stops in `finally` and remains retained. Full IDs, names, caps and stop receipts are in [helpers.json](evidence/helpers.json). None reports OOM. Native/check peaks range from 152,883,200 to 413,831,168 bytes; individual receipts are in [resources.json](evidence/resources.json).

No app, Auth, Storage or worker service starts. No image pull, dependency install, build, full suite, full TSC, hosted operation, reset, database deletion, retained-input write, global role/configuration change, borrowed-process stop, push, merge or release occurs. PR 330 is linked to this thread for provenance only.

## Native execution and observations

`prepare.py` extracts pinned Git objects into private modules. The full private manifest binds 962 source files to Git blobs and SHA-256; all match both checkout and extracted bytes after execution. The public [source bindings](evidence/source-bindings.json) identify the route and serializer dependency files. Mutations affect only the private extracted route. The current route's source bytes remain unchanged.

The probe invokes the actual exported `GET`, actual installed Supabase client and actual asynchronous serializer. Fixture adapters supply cookie-auth identity and current workspace. The adapter reads real own membership and workspace rows through native authenticated requests before selecting the workspace. The actor has a real viewer membership. Audit logging is inert. No browser login or Auth provider executes.

Fixtures contain 0, 2,000 and 2,001 selected-workspace projects, seven projects in another accessible workspace, three projects in an inaccessible workspace, and the four-project concurrency set. UUIDv5 identifiers are canonical and nonsequential; rows insert in reversed fixture order. Native SQL originals are retained independently before tests. Timestamp fixtures include equal milliseconds with `.000999` and `.000111` fractions. Costs include `42.01` and `123456789.12`, unknown price years, and literal operator-prefixed names. Geography fields remain null; this proof establishes no geography or legal applicability.

Each project request records the requested and actual URL, selected projection, workspace predicate, cursor, ordering, limit, HTTP status, Content-Range, received UUIDs and native error material. Native checks compare each page's exact values with independently retained SQL originals. [native.json](evidence/native.json) retains traces and exact UUIDs. [sql-fixture-values.json](evidence/sql-fixture-values.json) retains original selected SQL values. [workbook-values.json](evidence/workbook-values.json) retains actual emitted cell values decoded through a separate ZIP/XML reader. Full actual trace values also remain in the cap-two concurrency material. Stable trace summaries retain UUIDs rather than duplicate every HTTP row body; their value assertions and actual workbook artifacts remain separate evidence.

At both large caps, requests use `order=id.asc`, strict `id=gt.<last received UUID>` after the first page, and `limit=min(1000,2001-received)`. Actual URLs omit offset. The projection and workspace predicate match on every page. Native UUID ordering and comparison agree for the fixture's canonical identifiers. Content-Range starts at zero for each new filtered keyset request and matches the returned count.

| Case | Cap 1,000 | Cap 137 |
|---|---|---|
| Zero scoped rows | 200, header-only workbook, one empty read | Same |
| 2,000 scoped rows | 200, 2,000 exact rows; three reads including empty sentinel | 200, 2,000 exact rows; 16 reads including empty sentinel |
| 2,001 scoped rows | 409 `row_limit`, three reads, no serializer/download header | 409 `row_limit`, 15 reads, no serializer/download header |
| Later native SQL error | Second request selects a deliberately missing column; PostgREST 400/SQLSTATE 42703, route 500 JSON, no partial workbook | Same |
| Inaccessible workspace | Native direct project read is empty, without SQL error; native membership/workspace reads are absent; route 404 | Same |

A supplemental read-only authenticated-role SQL probe sees all seven foreign accessible-workspace rows and zero inaccessible-workspace rows. An unrelated actor sees zero in both; restoring the fixture actor restores seven and zero. It records a harmless copy and the intended unrelated-actor failure in [rls-visibility.json](evidence/rls-visibility.json). The accessible foreign workspace remains outside each selected-workspace export. The empty selected workspace remains empty despite the other accessible fixture rows. The inaccessible test separates RLS filtering from a SQL/read failure. This bounded viewer/three-workspace probe is not full RLS acceptance.

At cap 1,000, the initial complete route cohort records four successful stable/error tests and a failed RLS trace-count assertion. That trial remains a failed cohort. Only the corrected RLS case resumes, followed by remaining mutations. The four successful constituent observations remain visible; no failed cohort is relabeled as a complete pass. Cap 137 runs the current complete five-case cohort successfully. No accepted complete suite is repeated.

At cap two, after the first actual response, fixture SQL updates the unread third UUID's timestamp to `2026-10-05T00:00:00.123456Z`. SQL changes only that new fixture row. The current reader returns count four, each original UUID once, received-value presentation order, and emitted workbook UUID order matching native SQL. The first two rows retain their received values; this is not an atomic content guarantee. Each test restores the timestamp in `finally`.

The old reader control restores the pinned pre-correction route from `401c44a0f7bfe4b54740e2c3d07e30f8ed36f169` only into the private module. It returns count four but duplicates `4972d4a4-d88b-5914-bf14-1d95b822545a` and omits `804caf17-6e7c-50ec-82fb-e61a803cda2f`. The preceding success/count assertions pass; `concurrent exact original UUIDs once` fails. A harmless current-route comment survives before this control. Exact route restoration then passes the same concurrency probe. [concurrent.json](evidence/concurrent.json) contains all three actual request and identity records.

## Controls, failures and preservation

Ten private route mutations fail at their intended assertions: workspace predicate, projection, UUID ordering, request limit, premature exit, inclusive cursor, missing sentinel allowance, serialization after a later read error, truncated serializer input and cache header. The old-reader concurrency control adds one intended exact-ID failure. The classifier requires the selected file/test, recorded exit, exact failed-assertion count and named diagnostic; it rejects runtime/setup failures. Six classifier corruptions refuse, and harmless report copies survive. [trials.json](evidence/trials.json) retains accepted and refused trials. `verify_packet.py` reclassifies accepted receipts against report hashes instead of rerunning accepted native suites.

Artifact readback independently compares all 19 exported columns in the retained zero/2,000-row workbooks with SQL originals. Altered ID, name, cost and timestamp material fails its named comparison; copied and restored input survives. Safety controls permit a native read and refuse source writes, an unallocated database, the maintenance database, wrong cluster identity and 11 helper identity/configuration changes. Harmless copied helper metadata survives and original readback restores exactly. These are copied-readback controls, not malicious-host isolation proof.

Failed trials remain visible:

1. Initial setup stops before reservation/creation because psycopg receives an empty parameter tuple with a literal percent sign in SQL. Passing no parameters for parameter-free SQL fixes the runner.
2. The first helper cannot import the current serializer's new workbook-layout dependency from the older extraction inventory. No tests run. The missing exact Git object is added before retry.
3. The next cohort passes four native cases but fails RLS trace count because the probe includes its deliberate direct read. The corrected assertion requires one deliberate direct query and no additional route query. Only that case resumes.
4. An early-exit mutation fails the page-count assertion rather than the intended received-count assertion. Classification refuses it. A first-page exit replacement fails the intended count assertion. Accepted prior mutations are retained and reclassified; they do not rerun.
5. The complete target-catalog preservation assertion fails on `pg_class`. The failure remains. `finish.py` reports exact protected fingerprints and fixture data separately, without relabeling the full-catalog check.
6. The first independent XML readback preserves an empty `<v/>` as `None`; its blank price-year comparison fails. Normalizing the decoded empty value to an empty string fixes the decoder. No native suite reruns.

Routine preparation errors also include an unavailable `python` alias, an initial nested-path symlink command, and a metadata command run from the nested package with a repository-relative path. They do not qualify as native test failures or product defects. Their corrected commands use Python 3, the intended path and the correct working directory. The web tool cannot read the Markdown changelog content type; an ordinary read-only fetch retains the changelog privately.

Protected database fingerprints cover complete ordinary table rows, captured catalogs, roles, memberships, role settings and sequences. Source anchor, V6 database OID 6150036, old combined/215-preview targets and the old workbook-native target match. The old workbook-native database's before checkpoint is taken after the cap-1,000 campaign and before caps 137/two; it is outside the earlier database write allowlist throughout. The other four before snapshots precede database creation. This timing does not establish an earlier full snapshot of that fifth database.

Protected file inventories cover V6, the old native proof root and the canonical three unrelated paths. Contents and modes match across 22,633 files. Source pins and all extracted source bytes restore exactly. The target's table data, settings, identity, complete migration history and all other captured catalogs match. Only the full `pg_class` digest differs, with cause undetermined. Current statistics are retained privately but cannot reconstruct the missing before fields. [preservation.json](evidence/preservation.json) states this partial catalog outcome explicitly.

All writes bind to the newly allocated fixture target. Trigger disable/enable operations install and restore fixture timestamps only there; session-local role selection creates or changes no global role. No command stops any service except the exact newly created helper IDs. The demo at `~/apps/openplan` port 3000, existing database server, source anchor, retained proof databases and other processes receive no stop/reset/configuration command. A blanket process census is not captured, so this report claims scoped noninterference and the stated database/file checks, not general process-state preservation.

## Reproduction and remaining boundaries

The executable probe, controller, native runner, safety controls, readback publisher and packet verifier are retained beside this report. `prepare.py` documents pinned extraction. For another execution, allocate a fresh private root and fresh database, update all private-root constants together, and preserve these retained inputs. Do not rerun setup against this retained target or overwrite trial directories. The controller's continuation detects this task's retained third failed attempt; new roots execute a new baseline. This is an installation-specific proof recipe, not an unattended public test suite.

The bounded wrapper is:

```bash
systemd-run --user --scope --quiet -p MemoryMax=1G -p MemorySwapMax=0 -p CPUQuota=50% \
  flock /home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock \
  bwrap --bind / / --dev-bind /dev /dev \
  --ro-bind /home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules /home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules \
  python3 -B docs/reviews/2026-10-15-pr330-workbook-keyset-native-proof/native.py STAGE
```

Stages are `setup`, `helper 1000`, `helper 137`, `helper 2`, then preservation. This task's extra `checkpoint`, safety and offline continuation preserve their own evidence and failures. The original `final` continues to reject the retained catalog difference. `finish.py` reports the bounded outcomes from saved before/after material, rather than weakening that check.

Confirmed here: actual current GET/client/serializer execution, native cap/cursor/UUID behavior, exact tested rows and workbook values, scoped viewer reads, later native SQL refusal, and the timestamp-edit identity regression with a meaningful old-reader control. No Next HTTP server, real cookie session, browser navigation/login/download, native Excel/LibreOffice use, accessibility, planner observation, full RLS, capacity, recovery or atomic content acceptance follows.

Already-read values can remain stale. Concurrent inserts behind the cursor, deletes, ID rewrites and visibility changes remain outside this identity proof. Parent review/integration, fresh identified-build browser evidence and the recorded 420-versus-418 promotion hold remain. This fixture is 419/latest16. No new release or promotion is authorized.

Documentation consulted: [Supabase greater-than filter](https://supabase.com/docs/reference/javascript/gt), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and [Supabase changelog](https://supabase.com/changelog). Installed versions and native observations govern this result.
