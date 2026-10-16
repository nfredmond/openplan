# Engagement billed exact-money correction

## Disposition and source identity

The bounded correction passes 106 restored selected tests, focused TypeScript checks, focused ESLint and the separately authorized direction-only trial 04. Trials 01, 02 and 03 remain failed. Their accepted partial evidence and failure reasons stay separate below. This is source and mocked-consumer evidence. Independent source review, integration, native artifacts, browser journeys and human finance acceptance remain unproved.

- Assigned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-9679fd10`.
- Assigned branch: `t3/engagement-billed-exact-money-correction`.
- Initial clean HEAD: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
- A successful ancestor check precedes local-only fast-forward to exact base `04841834d31755d3d618a6ea3c300fb9b0b1414b`.
- Base application tree: `44e638d6d79378042343bf5b18408f09ee991d57`.
- Corrected application tree: `493488ffc952f1a69765c046afd03375d4fed126`.
- Model: GPT-6.1 Sol, high reasoning, confirmed by T3. No nested agents.
- Private evidence: `/home/nathaniel/.local/state/openplan/engagement-billed-exact-money-correction-20261016`.

The containing local source/report commit identifies the final HEAD. The handoff reports its full hash. No push, PR, join to another source tree, main update or release is authorized.

## Exact ownership

Twelve application source/test files change. The complete patch is [source.diff](source.diff); exact bytes appear in [source-pins.json](source-pins.json).

| Changed file under `openplan/src/` | Purpose |
|---|---|
| `lib/invoicing/receivables.ts` | Exact billed/draft arithmetic, subtraction/comparison, independently unavailable buckets, JSON-safe summary and warning types. |
| `app/api/invoicing/client-invoices/route.ts` | Exact prior/projected/overrun warning values and audited best-effort unavailability. |
| `lib/project-evidence-bundles/bytes.ts` | Explicit exact summary type through the retained invoice artifact assembly. |
| `lib/invoicing/invoice-pdf.ts` | Preserve exact amounts into escaped HTML and disclose independently unavailable fields. |
| `lib/invoicing/invoice-currency.ts` | Exact string-capable display with the stated or unassessed currency. |
| `app/(app)/invoicing/_components/receivables-lane.tsx` | Preserve the ceiling value without Number conversion and state unknown legacy currency explicitly. |
| `components/invoicing/engagement-nte-bar.tsx` | Exact draft comparison/display, bucket-local unavailable messages and legacy terms disclosure. |
| `components/invoicing/client-invoice-composer.tsx` | Accept exact warning values and distinguish projected billing from prior billing. |
| `test/client-invoice-pdf.test.ts` | Actual artifact assembly into HTML, exact aggregate and unavailable-bucket assertions. |
| `test/receivable-invoicing-routes.test.ts` | Exact projected JSON warning, required projections/filter arguments and accepted creation with audited unavailable position. |
| `test/client-invoice-composer.test.tsx` | Exact projected warning markup/state with the response currency and successful save. |
| `test/engagement-billed-exact-money.test.tsx` | New literal-cent helper, unavailable-field, currency and UI markup controls. |

Existing `test/invoicing-receivables.test.ts` is selected without edits. The other tracked ownership is this new review directory. The assigned ignored `openplan/node_modules` is an empty real mountpoint outside execution; no dependencies are installed or copied. Shared money primitives, shared formatter, `invoicing/contracts/reconciliation.ts`, schemas and original probe files remain unchanged. Other checkouts, browser sessions and proofs receive no edits.

## Binding finding and authority

The full 147-line [original probe report](/home/nathaniel/.t3/worktrees/openplan/t3-be1591bb/docs/reviews/2026-10-16-engagement-billed-precision-probe/STATUS.md), all 52 observations, source/schema pins, controls, mount, trial and restoration receipts are read before design. Its docs-only commit is `8defc05aec7d707bfebdea7f5a173a5659a11fcc`. Four public and 30 private original seals match before implementation and final handoff. No implementation claim rewrites that report or its failed trials.

The actual old helper returns `44999999999999.64` against exact `44999999999999.55` for 45 maximum legal stored invoice subtotals. Remaining is nine cents too negative. Separate draft rows also differ by nine cents. Supplied numbers and strings both reproduce this; 24 of 52 observations differ. The 45-row integer-cent sum lies below the safe-integer threshold. No observed NTE flag differs. This does not establish stored-data or transport incidents, practical exposure or a severity grade.

The lane reads AGENTS, V1, the sole roadmap and M11 definitions, CORE-PM-01, KL-023/025, architecture, capability matrix and dated direction review. M11 remains incomplete. Gross-before-retention is intentional and distinct from KL-025's historical net-retention issue. Complete retrieval, source-cost reconciliation, agreement authority and financial usefulness remain separate requirements.

Root's pre-implementation direction check passes at exact 048 in `op-m11-billed-root-direction01`, invocation `9069e3ba8b1b4420afb124f12103d684`. This is separate from the trials below. No review date, reviewed commit, version, registry or reminder is edited or suppressed.

## Implementation contract

The reviewed `ExactMoneyAmount`, `sumMoney`, `parseOptionalMoney`, `subtractMoney`, `compareMoney` and `moneyCents` primitives remain read only. Their existing contracts reject missing, malformed, negative contributing inputs and fractional cents where applicable. `moneyFromCents` retains numbers when its decimal/JSON roundtrip preserves cents and returns strings otherwise. BigInt does not cross JSON. The shared exact formatter remains unchanged.

Strict engagement attribution, sent/paid gross subtotals, separate drafts and void exclusion remain. Retention, net receivables and cash do not replace gross fee drawdown. Negative remaining values remain visible. Empty supplied sets produce zero buckets as before; missing engagement identity claims no invoice. These are supplied-set calculations, not retrieval-completeness certificates.

Each bucket calculates independently. A missing contributing amount returns null and a `missing` marker for that bucket. Malformed, negative or fractional-cent input returns null and an `invalid` marker. A missing ceiling remains unrecorded without erasing known billed or draft amounts. An invalid ceiling gets its own marker and prevents comparison. An unreadable billed bucket makes remaining and its comparison unavailable while a readable draft bucket survives, and vice versa. No unreadable amount becomes zero.

The API preserves exact prior billing, projected addition, comparison and overrun serialization. Prior and projected billing have separate payload fields. Unavailable position or projection is audited. Creation remains best effort and warn only, with no new NTE hard gate. The composer displays projected billing and discloses unassessed agreement terms. It retains the stated response currency. Artifact data carries exact summary amounts into HTML. An unknown legacy ceiling currency is disclosed; an unrecognized currency label retains its source spelling. Supported currencies follow the existing shared formatter's minor-unit rules. Currency agreement across records remains unassessed.

## Trial 01 remains HARNESS_FAILURE, exit 1

Unit `op-m11-billed-exact-correction01`, invocation `eac4cc51564b4b7095e9d093874fef51`, runs once under its explicit grant. The five-file baseline and harmless annotation each pass 106 tests. Thirteen named faults produce accepted assertion failures. The real composer mutation runs and its selected test fails because expected projected warning text is absent. Its message starts `Error: Unable to find an element with the text`, which the prepared reader rejects because it requires `AssertionError`.

The composer is not an accepted kill in trial 01. The unit stops there; the last API fault, restored tests, types, lint and direction do not run. Finally clears the in-memory transform and reads back all 18 source pins exactly. The manager records 1 minute 13.752 seconds, 36.368 seconds CPU, 312 MiB rounded peak and zero swap. The trial is sealed as 104 files, excluding cache directories from the manifest. Caches remain private and untouched.

## Trial 02 accepts remaining focused checks, then fails direction, exit 1

Root authorizes a new isolated continuation after reading the exact failed composer evidence. Application source, tests, fixtures and assertions do not change. Context seals the original source/test identity, configuration, transformation definitions, harness and receipts. All 18 source pins match before and after. The 13 accepted faults are reused without replaying that campaign.

The composer baseline and harmless annotation each pass their one selected case. The narrowly authorized reader accepts only the exact composer mutation, full test name, expected warning prefix, applied matching-file transform, exactly one failed case, zero passed cases and one matching test file with no suite-level runtime failure. Its outcome is `KILLED_EXPECTED_QUERY_FAILURE`, not `AssertionError`. This changes no other fault's reader. The API overrun baseline passes one case and its fault fails with `AssertionError`. The restored five-file selection passes all 106 tests. Focused types exit zero in 22.252 seconds; focused lint exits zero in 10.950 seconds.

Unit `op-m11-billed-exact-correction02`, invocation `893ed1308e4145acba354c9014fb8d1d`, remains exit 1 because direction fails afterward. Raw diagnostics show the actual assigned nested-app cwd. Both Git metadata and `git cat-file -e` exit 128 with `fatal: could not open '/dev/null' for reading and writing: Permission denied`. This does not establish an absent host object. The manager records 1 minute 8.793 seconds, 33.880 seconds CPU, 715.8 MiB rounded peak and zero swap. All source and prior-trial pins match; 76 trial files are sealed.

## Trial 03 corrects device access, then fails Git threading, exit 1

Root separately authorizes direction only, adding a final `--dev-bind /dev/null /dev/null`. No whole `/dev` or root writable bind is added. The runner verifies the actual character device, mode 0666 and device 1:3, then briefly opens/closes it for read/write with zero payload. Both raw Git metadata and the reviewed-object check pass. The latter establishes object availability inside this corrected sandbox.

Direction then fails with `fatal: unable to create threaded lstat: Resource temporarily unavailable` at `git diff --name-only 380aad49770d856a9c4b577ccc9793baf39d3ddf --`. Unit `op-m11-billed-exact-correction03`, invocation `683a6e634cd04cccacf3c8d275a52f14`, remains exit 1. It records 979 ms runtime, 497 ms CPU, 60.2 MiB rounded peak and zero swap under a 32-task cap. It does not measure PID events. Attributing that failure specifically to the cap remains an inference. No Git configuration or authority change occurs. All 18 source pins and 180 old trial files match; 35 trial files are sealed.

## Trial 04 passes corrected direction only, exit 0

Root authorizes a new direction-only unit with the finite task cap changed to 64 and PID-counter capture. The code, tests, direction script, Git configuration, environment guards and authority metadata remain unchanged. The existing device-only bind remains. No tests, types or lint repeat.

Unit `op-m11-billed-exact-correction04`, invocation `fdbe7fbe8a174a0d834ea9beb56466e7`, exits zero. Raw Git metadata and reviewed-object checks exit zero, then the single nested `npm run product:direction:check` exits zero in 1.885 seconds. The manager records 2.092 seconds runtime, 1.032 seconds CPU, 119.9 MiB rounded peak and zero swap. The kernel records `pids.max=64`, `pids.peak=43`, `pids.events=max 0` and no OOM event. These observations are consistent with the task-cap explanation for trial 03, without inventing its unrecorded counters.

Jurisdiction, matrix, registry, package-version and intervening-source reminders remain in the saved stream. The successful direction result does not redatum, suppress or resolve those reminders. All 18 source pins and 215 prior trial files match afterward. This trial seals 36 files.

## Mutation scope and blind categories

The 13 accepted trial 01 faults cover dollar-number accumulation, gross-to-net substitution, foreign attribution, ceiling equality, empty-bucket unavailability, invalid-ceiling erasure, missing-as-zero, an incorrect UI cent, unavailable UI text, projected API addition, unavailable-position audit, incorrect artifact HTML cents and unavailable artifact text. The mutation stored as `string-to-number-ui-regression` actually substitutes a one-cent-wrong literal; it does not prove that every numeric-conversion regression fails. Trial 02 adds the distinct expected composer query failure and the API `overBy` assertion failure. Both trials demonstrate harmless survivors and exact finally restoration. See [evidence.json](evidence.json) for named outcomes and receipts.

Literal-cent fixtures cover 45, 91 and 100 maximum stored rows, separate billed/draft buckets, supplied numbers/strings, legitimate ceiling equality and one-cent overrun, recorded zero, absent/invalid ceiling, independent unavailable buckets, statuses, attribution and gross retention. Query-dependent API and artifact tests assert actual selected columns and engagement filter arguments. Production helpers are not mocked. External SDK operations and PDF rendering are mocked; none of these tests establishes native data transport, RLS, concurrency or a usable native PDF. Assembled artifact HTML tests sample 45-row aggregates; helper/API and formatter tests separately cover larger string output.

UI markup/state tests cannot establish desktop, 390px, keyboard, console, visual usability or planner acceptance. Focused type/lint checks establish their selected source/import closure, not whole-project build or full-suite health. Direction checks metadata consistency, not complete V1 implementation. The existing 500-row UI cap and unknown SDK delivery remain unchanged and disclosed; complete retrieval and currency agreement remain outside this pure correction.

## Resource custody and remaining limits

Every dispatch has a separate durable exact-hash grant, intent, finite unit, output and terminal receipt. Each acquires the shared compiler lock once nonblocking. Network namespaces are unshared. Named host root, assigned source, old sources and donor paths are read only before the first application dependency load. The donor's final bind is read only; caches, home and output paths are lane-private. Python runs with `-B` and bytecode protection. Direction commands have 20-second timeouts and enforced 128 KiB stdout/stderr file limits. Finally and post-terminal reads preserve source pins and old trial seals. Read-only `/proc/locks` inspection confirms release; it acquires no further lock.

Inherited writable submounts remain, and the discard character device is intentionally writable in trials 03/04. There is no host-wide only-private-writable claim. No native database, SQL, migration, HTTP transport, browser, provider, application service, installation, full suite, build, hosted operation, source join, push, PR, main or release action occurs. Successful checks do not erase failed units. M11, CORE-PM-01, independent finance reconstruction, practitioner usefulness and the remaining V1 floor stay open. Root owns the next fresh independent review of the exact local source checkpoint.
