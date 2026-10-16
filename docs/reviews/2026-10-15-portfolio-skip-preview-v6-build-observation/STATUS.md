# V6 build observation, October 15, 2026

The one already-running V6 build finishes successfully. The parent driver records
`code=exited, status=0/SUCCESS`, and the controller publishes its guarded domain
receipt. This accepts the bounded build result only. The observer starts nothing.

The observer owns this directory and the new private directory
`/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v6-build-observer-20261015-1555`.
The assigned checkout fast-forwards from `05dd3e8da4a4572437f06e771b0a2477873e681f`
to authorized local `02ec7bcbd391088477390a738eb21d5aad34d3b3` before writing this report.
No source, test or guard changes occur. The observer reads the repository AGENTS,
current coordination record, V6 parent recipe and build controller. The planner-writing
and prove-it skills apply. The requested observation boundary excludes running the
product-direction command, compiler, suite, service, database or browser.

The parent launches exactly one build. The observer does not interact with parent
exec session 97990, retry a stage, request a mutator, inspect the four helpers for
new work or use database transport. No nested delegation, scheduler, watcher, push,
pull request, main merge, hosted operation, paid operation or release occurs.

Unit: `openplan-portfolio-skip-preview-49e3fa200-v6-build.service`.
Launch invocation from the parent's `build-driver.log`:
`382d4e9515014dc393e79e8f3d0046e3`.
Observed start: `2026-10-15 08:52:18 PDT`, or `15:52:18 UTC`.
Live `ExecStart` identifies the reviewed private `app_binding_v1.py build` controller.
The reviewed controller runs npm build inside the fixed bubblewrap wrapper, with
private caches, no build network, a 6,144 MiB Node heap, 10 GiB memory, zero swap
and CPU quota `50000 100000`.

Candidate: `/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6/candidate/openplan`.
Exact application commit: `49e3fa2004c1336ffa36c134a8f21bcc2d72d327`.
The retained intent and checkout receipt bind this commit, environment digest,
migration digest and dependency binding. The controller checks clean application
inputs before and after the compiler. The observer does not rescan changing `.next`
or independently acquire the database.

Expected migration inventory: 420, latest `20261017000017`.
The intent binds database `openplan_project_portfolio_preview_8f43260b95a071cc4e6d2b90`,
OID `6150036`, owner `postgres`. These are receipt facts, not a new database query.
The original SERVICES failure remains retained by the parent. This build observation
does not replace that failure or the subsequent read-only disposition.

## Actual terminal evidence

The parent driver records success for invocation
`382d4e9515014dc393e79e8f3d0046e3`, with 569.658 seconds of service runtime.
The npm child returns zero after 503.608 seconds. The same-invocation journal records
terminal CPU use `254569180000` nanoseconds, memory peak `6774874112` bytes and swap
peak zero. Its terminal journal timestamp is `2026-10-15T16:01:47.821235Z`.

At `16:02:16 UTC`, the observer finds all four files present: build intent,
exit, result and saved inventory. The transient unit has already been collected:
`LoadState=not-found`, empty invocation, unset peak. Those post-GC defaults do not
supply exit or resource evidence. The actual parent driver, retained launch,
pre-GC samples, controller resources and matching terminal journal supply it.
The observer does not read or interact with root exec session 97990.

The accepted result identifies BUILD_ID `7X3x8RgohlUwVf_lPZa5r` and exact APP49.
Result application inputs equal both the original intent and checkout receipt;
active bindings equal the original intent. Before/after resource records match
intent and exit records. The controller checks the clean head, environment,
420 migration bytes and dependency binding before and after compilation. Its
successful publication follows reacquisition of source, helper and protected-state
oracles. The observer compares retained receipts without rerunning those oracles.
This is receipt-based preservation evidence at that acquisition, not a new browser
or post-journey preservation result.

The observer verifies the saved inventory file hash and its canonical JSON digest
against the result, then checks BUILD_ID and one generated manifest against saved
inventory entries. It reads `required-server-files.json` after controller exit.
Its embedded migration set equals every sealed migration version: 420, latest
`20261017000017`. Its SHA-256 is
`bb5479656684165f597181e7e421ecb383b03986c2f043ea42ccfc76b2c8525d`.
No database transport or gigabyte output rehash occurs. The saved inventory has
2,587 files totaling 1,872,149,963 bytes. Root revalidates output before start.
The observer also confirms the current launcher and binding hashes match the result.

The controller's resource record immediately after npm exits has memory maximum
`10737418240`, swap maximum/current zero, peak `6774874112`, CPU quota
`50000 100000`, and all recorded memory.events counters zero. These event counters
precede controller postchecks and inventory. The terminal journal independently
confirms the whole-controller peak and swap peak, but does not include final
memory.events. No whole-controller final-zero event claim is made.

The raw build log stays private, 19,679 bytes. It records successful compilation,
TypeScript completion, page-data collection, static-page generation and final
optimization/traces. The only case-insensitive error-text match is the route
listing `/api/client-errors`; no warning-text matches occur. These text categories
are not a runtime or console test. The parent retains the earlier SERVICES failure,
all stage intents and the failed preflight post-GC readback. The observer retries none.

## Retained proof

[Machine-readable observation](observation.json) records the selected facts,
13 receipt comparisons, full file digests and private source/copy locations.
All 13 comparisons return true. They can expose inconsistent receipts, but they
cannot independently establish the controller's live database queries or every
output byte. No test or guard is added or edited, so no mutation trial applies.

Private observer directory:
`/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v6-build-observer-20261015-1555`.
It retains complete copies of intent, checkout, exit, result, inventory, raw build
log, initial/final parent driver log, generated manifest, BUILD_ID and admission,
plus timestamped live samples and private journal reads. The original controller
files remain under the V6 packet's `execution/` directory. The observer only reads
them. A private inventory lists the observer proof files and their hashes.

Key SHA-256 values:

| Retained record | SHA-256 |
| --- | --- |
| `build-result.json` | `e112b928e755fa0b37d35fea1d16f13538719a78bdbcd2e5753cd2d8ff936556` |
| `build-exit.json` | `49d702aa5ca44ed156a7c3078188123812371f3f6c006ca09d52ecc80451afdb` |
| `build-files.json` | `170cd236a961e45d719574c303f344d4e720f2f061d799803c7e02ccd4e1a85d` |
| Canonical saved inventory digest | `a040bf376704129a97424c937413bf2c80cdc76b392fa0a81300084ed7320c12` |
| Raw private build log | `837ed619df2c51e4bdb1313512a082787b1c7430217999a975f72ba94ad58ae3` |
| Final parent driver log | `21da03bf0bbdb8d9357d66428b47406b665589555f3e3fdc09ddac4d8aa63b42` |

The observer creates a local report commit only. No push or pull request occurs.

This report provides build evidence only. It does not establish runtime readiness,
desktop or 390px behavior, console or artifact acceptance, scientific validity,
practitioner acceptance, protected-state preservation after a new journey or a release.
Root must read the full report and actual receipts, revalidate before start, perform
strict runtime attestation, collect the new front-door journey and complete final
preservation. Source/native proof limits and old 215/419, native 419, source-anchor,
V4/V5/V6 packet and canonical unrelated-work boundaries remain in force.
