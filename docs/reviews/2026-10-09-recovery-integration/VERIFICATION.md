# Recovery integration candidate, October 9

This candidate joins main at `74bf0408f279`, model recovery and managed-worker foundations through PR 171 at `bd6ed4219`, synthesis read contention through PR 172 at `fa3b3e2b4`, and GTFS failure closure and retained-archive foundations through PR 176 at `b34061e97`. PR 171 includes PR 170 and its retained parents; PR 176 includes PR 174. Keep those PRs open until the combined candidate passes and lands. The roadmap remains the queue and the complete v1 contract remains binding.

Three merge conflicts affect the changelog, unread-column accounting and migration inventory. Both migration instruction sets remain. The reader inventory retains the model branch's removal of stale request-payload exceptions and adds all three GTFS closure columns. The combined schema expects 307 application tables and 14 views.

Forty-seven focused tests pass across migration inventory, unread-column accounting and the retained archive reader. Six static controls pass expected outcomes: harmless and restored copies pass for each reconciled inventory; a wrong relation count and a missing GTFS closure-column classification fail. Copies run from disposable test files; tracked tests remain unchanged. Results retain source hashes.

The native check uses the owned GTFS proof database, which already includes model migrations through 21 and the installed GTFS closure migrations. Inside one rollback-only transaction per control, it applies model migrations 22 through 24 and queries the actual public catalog, excluding extension-owned relations. It finds 307 application tables, all with RLS, and 14 views. Disabling RLS on the GTFS cleanup queue fails the expected inventory. Baseline, harmless-comment and restored controls pass. Separate connections verify that the added recovery-receipt relation is absent and the original queue still has RLS after every rollback. An initial attempt used the wrong queue name and stopped at its precondition without applying migrations; the corrected runner uses `gtfs_ingest_storage_cleanup`.

These checks reconcile catalog accounting. They do not prove every permission, query projection, workflow or restore boundary. Full combined QA, GitHub CI/RLS/restore and identified-build desktop/390px journeys remain required. The older acceptance checkout at `532c0f81f434` differs from this candidate and cannot establish final-code acceptance. Its restored T3 screenshots demonstrate that capture works again, not that these PRs are accepted.

The native archive result in the GTFS review proves one retained publisher archive across separate client processes, including corruption and absence. It does not connect the GTFS worker. Normal managed model dispatch remains disabled; solver handoff, scientific acceptance, human acceptance and full v1 remain open. No version or release tag is changed.

## QA tool declaration and acceptance copy

The combined local QA passes lint but stops at dead-code inventory because the native FIFO refusal test invokes the Linux `mkfifo` utility without listing it in `ignoreBinaries`. The configuration now declares that one existing system utility. No export warnings or other dependency checks are disabled. Three disposable configurations verify harmless JSON formatting, removal of the declaration and restored behavior against the complete knip run. The missing declaration fails with the single unlisted binary; the other configurations pass. An initial filtered `--include binaries` run generated configuration hints because dependencies were outside that filter; it does not count as a passing full inventory check.

The separate acceptance database copies the existing synthetic recovery database without disconnecting its services. The first restore, using `postgres`, stops at schema ownership. The same target is resumed with the existing Supabase administrator role after checking its two created schemas and empty Auth namespace. The resumed transaction exposes `model_runs_project_workspace_match` during COPY: project-linked runs precede their projects in the default archive order. That failed transaction rolls back. A restore list then loads the projects data entry before the other table data, preserving the original check constraint. The custom archive must be seekable for this changed order; stdin cannot supply it. The successful attempt uses a temporary archive file inside the owned database container and removes that file and restore list afterward.

Migrations 24 through 26 apply only to the new acceptance database. A comparison of original columns across 339 Auth, Storage and application tables finds all 966 rows unchanged. Sorted JSON row counts and MD5 checks match; the source also matches when read again. Harmless SQL commentary preserves the match, a project-name change is detected, and that mutation rolls back. This checks ordinary corruption, not adversarial hash collisions. Extension-owned records are excluded. The private source dump and failed target remain local acceptance evidence, not committed data.

The default restore-order failure remains an M3 recovery defect. This explicit fixture-order workaround does not repair the maintained general restore procedure or prove that every cross-table check can restore safely. A generic solution needs retained constraints, complete nonempty dependency cases and adverse controls. Services and final-build browser journeys for the new acceptance copy remain pending.


## Final history join and browser findings

The October 9 worktree audit initially finds 96 worktrees. All heads are reachable from live remote branch tips; only the canonical checkout has an untracked desktop `.directory` file. Eighteen worktree heads are outside observed main `74bf0408f279`. The later mobile correction adds one clean, pushed worktree. Ignored artifacts and semantic completeness remain outside this inventory. The audit discovers that PR 171 includes PR 170's predecessor but omits its later `03ba477f7` commit. The integration's `mkfifo` declaration is already identical, but the original commit and its verification note are now merged to preserve history.

The integration also joins PR 178's project/workspace restore correction and PR 179's bounded mobile recovery correction. The single changelog conflict keeps both entries. Their retained reports distinguish tested source commits from subsequent evidence-only commits. PR 177's preceding head `2cda52b913ae` passes all eight GitHub checks, including live isolation and full-archive restore. That result does not cover this joined head.

Local QA at `2cda52b913ae` passes lint, dead-code checks, 20,285 tests and the dependency audit, with 1,595 tests skipped. Its build compiles and finishes TypeScript, then fails at page collection when 23 workers exceed the 256-task service cap. A separate configured build succeeds with two page workers under the same 8 GiB memory limit. This is recorded as a failed full local command plus a passing configured build, not a passing rerun of the complete command.

T3 signs in against a separate cloned database and Auth/REST/Storage stack at API port 29832. Identified candidate `cf6256980ae4` uses port 3520 and includes the mobile correction. The BART archive is assigned to the file input using in-page File/DataTransfer after its 892,312 bytes match SHA-256 `affdc4d70cac01f71e54f049c754ba36824a885edcdef2ef8b024820c9e93080`. Private fixture transport is separate from product ingest, and its temporary source object is removed afterward. An initial fixture read receives 401 because the test gateway requires its public API key; the corrected fixture transport succeeds. This does not test the native file chooser.

The actual Upload and read control returns a ready feed with 95 route-service and 717 stop-service rows derived from 14 routes, 287 stops and 4,417 trips. Uploading an intentionally invalid 77-byte replacement through that feed's newer-archive control records `not_a_zip` while the original version remains ready and current. Exact version JSON and sorted-row digests preserve its route/stop rows. The failed version has one immutable closure receipt and one private-object cleanup request. Native comparisons occur only in the owned acceptance database; no demo data changes.

At 390 pixels, the failure's long library URL overflows the GTFS panel even though document width remains 390. File inputs also exceed their available width slightly. Diagnostic wrapping and bounded file controls reduce panel scroll width from 474 to its 351-pixel client width. The source correction applies those styles to the GTFS panel and its two file inputs. Targeted lint and 50 existing GTFS panel, failure-receipt and closure tests pass. No test or guard changes. Final rebuilt visual review, scheduled-route cleanup, synthesis browser acceptance and combined-head CI remain pending. The production GTFS ingest still runs in the request; the worker ownership prototypes are not enrolled.

## Joined candidate acceptance at f2e1d191

The configured production build at `f2e1d19176edd53852896e5fe2ff1119f4337353`
passes. Its retained log SHA-256 is
`a89ca558a01a9ebd434b60aaf9e7423df1ebd56de71182bf39d014517c846330`.
The owned service on port 3520 reports that commit and version 0.68.0, with its
process cwd in the integration checkout's application directory.

T3 checks the rebuilt GTFS panel at 1280 by 800 and 390 by 844. Both archive
inputs fit. The phone panel has equal client and scroll widths of 351 pixels;
document width remains 390. A harmless outline change preserves that result;
restoring ordinary URL wrapping reproduces 474 pixels of overflow, and restoring
the correction returns 351. Native file chooser behavior is not tested.

The actual scheduled cleanup route refuses a missing credential with 401 and
leaves the failed archive present. An authenticated call returns 200, removes
the queued failed object and empties its cleanup queue. Storage subsequently
returns an explicit `NoSuchKey`; the ready BART archive remains readable with
its original SHA-256. A repeated sweep returns 200. The route's `scanned: 0,
reaped: 0` counters describe abandoned ingests, not deleted cleanup objects.
Direct Storage and database reads establish removal.

The synthesis journey creates a private draft campaign, two approved synthetic
staff notes, their complete retained source and an analysis request through the
interface. A saved no-key destination at `https://acceptance.invalid/v1/` supplies
the clearly labelled `synthetic-not-executed` model. Saving does not contact it.
The retained source digest is
`024dd31018954fad0d6a4278deaa59531c1c942860d37bbb08e0c41f49b2229a`;
the request intent digest is
`834a420038b43a58aa132882e33b071f00dcefdfbf045dd190a39acf643a2009`.

From saved request history, Inspect preparation and Review cancellation options
reopen the original request. A separate rollback-only PostgreSQL transaction
holds its advisory lock. Refresh original request produces one native busy error;
the controller releases the lock only after observing that error. The browser's
single HTTP request returns 200 with the original model. This exercises the real
Next route, authenticated PostgREST and production adapter, supplementing the
[native and HTTP controls](../2026-10-09-synthesis-read-contention/VERIFICATION.md).

Holding the lock through all retries produces nine native busy errors across
three browser reads. The server records three unavailable reads. Browser
Resource Timing reports 503, 503 and 0 for those reads; 0 is not claimed as a
confirmed response status. The UI removes the cancellation form and says the
original request could not be confirmed. After rollback, an explicit refresh
returns 200 and restores the original model and form. Desktop and 390px captures
show the recovered state; the phone panel has equal client and scroll widths of
327 pixels. Native readback finds zero plans, execution authorizations, attempts
and cancellations for this request. These are test records, not resident input
or agency decisions. Controlled lock timing is not a workload capacity result.

The transient journey has no newly reported console entry in its snapshot.
The persistent case deliberately exercises unavailable responses. Older console
history includes the invalid ZIP, fixture-transport authorization refusal and
the corrected browser probe failure; none is erased to claim whole-app health.

Navigation also reveals a separate short-desktop rail defect. The first pointer
activation can move its target by 100 pixels as group headings expand. The
[causal report](../2026-10-09-short-rail/VERIFICATION.md) retains that finding and
its diagnostic correction. The earlier mobile-only correction does not cover it.
Current-head GitHub checks and rebuilt rail acceptance remain required before
the integration lands. Full v1, scientific and practitioner acceptance stay open.

Compact evidence is in `joined-browser-acceptance.json`. Raw synthetic readbacks,
logs and captures remain private under the acceptance state directory and T3
browser-artifacts directory.
