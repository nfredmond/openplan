# Exact engagement billing review retains one currency-labeling objection

## Disposition

I withhold approval of the complete exact `89237c0c13c85995d52fbcf1c6ee59c389bacf1b` patch. One P2 source finding remains: the newly typed warning applies the current invoice's currency to the engagement aggregate, unknown legacy ceiling and calculated overrun. The changed PDF context retains the same unsupported inference. “Agreement terms unassessed” does not identify the currency gap.

The bounded arithmetic implementation is acceptable by source inspection, subject to that presentation objection. It replaces iterative dollar-number addition with the existing reviewed exact-money functions, preserves independent unavailable buckets, separates prior from projected billing, and retains warn-only creation. This is independent source review and inspection of saved author evidence. I execute no application dependency, test, compiler, lint, direction command, browser or native operation. I do not claim a new runtime pass.

The minimum correction can keep each invoice's own stated currency on its actual invoice amounts while explicitly disclosing unassessed aggregate currency, ceiling currency and currency agreement. Preserve the existing arithmetic as a legacy numerical comparison with its limits visible. A new currency registry, conversion framework, schema widening or hard billing gate is unnecessary. Root owns any separate correction assignment and validation grant. No source join follows this report.

## Exact checkout, ownership and authority

- Reviewer checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-6cab117f`.
- Reviewer branch: `t3/engagement-billed-exact-independent-review`.
- Initial clean reviewer HEAD: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
- Owned tracked path: this new review directory only.
- Owned private path: `/home/nathaniel/.local/state/openplan/engagement-billed-exact-independent-20261016` only, created mode 0700.
- Source checkout, read only: `/home/nathaniel/.t3/worktrees/openplan/t3-9679fd10`.
- Source branch: `t3/engagement-billed-exact-money-correction`, clean at exact `89237c0c13c85995d52fbcf1c6ee59c389bacf1b`.
- Source parent: `04841834d31755d3d618a6ea3c300fb9b0b1414b`.
- Base application tree: `44e638d6d79378042343bf5b18408f09ee991d57`.
- Corrected application tree: `493488ffc952f1a69765c046afd03375d4fed126`.
- Source pins SHA-256: `71f06911752332e7513c375b08814372f1f2a9dbebebe01c685a52b93d198f26`.
- Author public SHA256SUMS SHA-256: `636b50039140f9ceb0f0642a6d4c1acab9b9b129a03b4782241717264162f77c`.

T3 identifies this thread as the independent child review using GPT-6.1 Sol. The runtime identifies high reasoning. No nested agents run. The initial T3 inventory identifies the active parent and separate budget-preparation lane. I do not operate their checkouts, accounts or workers. Root's subsequent exclusive native notice and release do not grant this review a runtime window.

I read the assigned AGENTS and apply `planner-writing` and `prove-it`. The Supabase skill is read for the pinned query/schema context; no SDK fact requires a current-service claim, and no service or test query runs. The explicit source-only instruction controls over the ordinary AGENTS direction-check command. The saved author's direction result is attributable to its own unit, not this checkout. A quick memory registry search finds no relevant entry; findings depend on current pinned files.

Authority includes the full V1 contract, sole-roadmap queue/destination and full M11 definition, relevant CORE-PM-01 row and project-management practice/outcome sections, M11 known-issue dispositions and KL-023/025. I also read the October 6 direction review, capability evidence vocabulary and relevant financial/installation entries, architecture, original probe and full final correction report. These remain binding rather than being narrowed to this repair.

The complete destination retains all core planning practice, full OWP/UPWP administration, prior-adopted RTP updates, contract/task/employee/deliverable budgets and forecasts, engagement, capital and local-tax/grant administration, procurement and provider choice. It includes all fifty states and DC, California depth, explicit territory support, sovereign Tribal and overlapping authorities, worldwide extensibility, independent free installation and customer data portability. Both AequilibraE and ActivitySim require separate nationwide use-specific scientific evidence. No average, consumed holdout, calendar or runtime limit substitutes for that evidence. This review promotes no capability grade, milestone, scientific claim, hosted installation or practitioner acceptance.

## P2: preserve unknown currency in the new warning and changed context

The exact source chain is:

1. `app/api/invoicing/client-invoices/route.ts:209` reads the engagement projection without a ceiling currency. The prior-invoice projection at line 397 reads status and amounts without `currency_code`.
2. The new warning at lines 580–586 combines exact prior and current invoice amounts, then sets one `currencyCode` from `parsed.data.currencyCode`. That value describes the newly created invoice, not the legacy ceiling or prior invoice set.
3. `components/invoicing/client-invoice-composer.tsx:379` uses that one value for projected gross billing, the legacy ceiling and `overBy`. A request stating EUR therefore produces euro-denominated engagement/ceiling assertions without evidence that those records share EUR. The closing agreement disclaimer says nothing explicit about unknown currency or unassessed currency agreement.
4. `lib/invoicing/invoice-pdf.ts:183–198` formats ceiling, billed, remaining and newly displayed draft values with the current invoice's `currency`. Its artifact reader at `lib/project-evidence-bundles/bytes.ts:242–255` likewise retrieves no ceiling currency or prior-invoice currencies. The PDF already inherited the invoice currency before this patch; I do not call that inherited behavior a newly introduced arithmetic defect. The changed context now extends it to the draft amount and leaves it undisclosed.
5. The normal summary lane correctly passes `currencyCode={null}` at `receivables-lane.tsx:409`; the composer selection context also passes null at line 772. The later warning and PDF therefore conflict with the honest unknown-currency treatment already present in this correction.

The concrete source case requires no exceptional amounts: use any positive prior billed subtotal, a lower legacy scalar ceiling, and a newly created invoice with `currencyCode: "EUR"`. The route cannot establish prior-currency or ceiling-currency agreement from its projections. Nevertheless, the new composer sentence labels all three values with euro symbols. Prior invoices may be EUR, USD, absent-currency or mixed; the inspected code does not distinguish them. This is a deterministic source trace, not an executed HTTP or browser observation.

The regression tests currently require this wording. `client-invoice-composer.test.tsx:215–225` supplies EUR and expects the legacy ceiling and aggregate in euros. `receivable-invoicing-routes.test.ts:821–850` asserts the current request's EUR as the warning currency without testing the missing agreement. The helper markup fixture supplies EUR directly, which tests formatting but cannot establish how a real engagement acquires that currency. The artifact aggregate tests exercise absent invoice currency, so they cannot reject the known-invoice/unknown-ceiling inference.

The shared formatter intentionally follows a supported currency's minor units. Thus an inferred zero-decimal invoice currency can also round the unknown-currency context at display time. That is a consequence of supplying an unsupported currency inference, not a defect in the unchanged shared formatter. I do not execute or add a new JPY test here.

P2 describes a bounded misleading financial presentation and incomplete correction boundary. It does not establish stored corruption, an actual mixed-currency incident, practical exposure frequency, a wrong observed NTE flag or a High/P1 incident. Keep the current invoice's own currency on its own lines and totals. For legacy context, show exact values with explicit currency/compatibility-unassessed disclosure, or an equally truthful unavailable comparison description. Preserve source meanings, prior/projected separation, successful creation and the existing warn-only policy. Correct the relevant assertions under a separately authorized finite window; do not require broad currency infrastructure.

## Arithmetic and availability source assessment

The source diff matches the saved `source.diff` byte for byte. Exactly 19 tracked paths differ from the parent: eight production files, three changed existing tests, one new test and seven new report files. There are no shared-money, reconciliation, migration, provider, product-direction, package or dependency changes. Every one of 18 source pins matches both its current file and the exact Git object. The existing invoicing-receivables test remains unchanged.

`buildEngagementBilledSummary` filters exact engagement identity before partitioning. Missing engagement identity claims no row. Sent and paid use gross `subtotal_amount`; drafts remain separate; void and unsupported string statuses do not contribute. The historical default for absent status remains draft. Gross drawdown is intentionally before retention. It must not become net receivable or cash.

Each bucket calls `sumMoney` independently. A null/undefined contributor marks only that bucket missing; invalid, negative or fractional-cent values make only that bucket invalid. Empty supplied sets still produce zero. An invalid ceiling preserves readable buckets while preventing subtraction/comparison. A missing ceiling remains unrecorded. Remaining uses exact subtraction, including negative values. A missing/invalid billed bucket makes remaining and its comparison unavailable while retaining readable draft and ceiling values. No contributing unreadable amount becomes zero. The summary's false flag for an absent ceiling remains the historical no-ceiling convention; callers must use `notToExceed` to distinguish that condition from a proved within-ceiling result.

The unchanged primitives use BigInt internally and emit number|string amounts. `moneyFromCents` retains a number only if its two-decimal spelling and JSON decimal roundtrip retain the cents; otherwise it returns a decimal string. `sumMoney`, `subtractMoney`, `compareMoney` and `parseOptionalMoney` preserve that contract. BigInt does not enter the summary or warning transport. This review does not rerun the already reviewed shared-helper/formatter campaigns.

The route preserves prior billing separately, adds the new subtotal through `sumMoney`, compares exactly and calculates `overBy` through exact subtraction. It audits unavailable input position and projection exceptions. Query errors remain separately audited. It keeps successful invoice creation independent of the best-effort warning. The line/totals builder remains its existing numeric implementation, outside this supplied-set correction; I make no claim to validate all invoice arithmetic.

The artifact interface now carries the actual summary type. HTML formatting receives exact strings without `parseCurrencyAmount` conversion. User-supplied fallback currency labels are escaped by the HTML builder. The normal summary UI performs its draft-positive comparison with `compareMoney`; it does not convert aggregates back to Number. Missing and invalid display branches retain independent known fields. Currency inference remains the objection above.

## Original probe remains intact

I read all 147 lines of original STATUS, all 52 saved observations, controls, source/schema pins and the original trial evidence at docs-only `8defc05aec7d707bfebdea7f5a173a5659a11fcc`. Its four public checksums and 30 private checksums match. I do not rewrite, rerun or reclassify it.

The pinned schema declares finite investigated invoice subtotals and legacy NTE values as NUMERIC(14,2), maximum `999999999999.99`. The later money-integrity migration does not widen those columns. Its one-through-200 limit counts invoice lines, not invoices per engagement. This is migration-source evidence, not a live applied catalog claim.

The original actual helper returns `44999999999999.64` instead of exact `44999999999999.55` for 45 maximum legal subtotals. Remaining is nine cents too negative. A separate 45-draft case is nine cents high. Both supplied strings and supplied numbers reproduce it; 24 of 52 observations differ. The 45-row exact sum stays below MAX_SAFE_INTEGER cents. No observed `isOverNte` differs. The sampled equality and one-cent-overrun cases match; that does not certify every legal comparison or demonstrate a minimum failing count.

Pure01 fails setup before subject/dependency execution. Pure02 executes the actual helper, literal-cent oracle, harmless annotation and two targeted controls, then fails its direction step. The old wrapped error does not establish an absent host Git object. The saved mount record has named root/source/donor read-only mounts but 225 inherited writable submounts. It provides no host-wide only-private-writable guarantee. Native transport, live database, accounting fit and severity remain unproved.

## Saved author trials support bounded claims only

I read the final 99-line author report and actual saved Vitest result files, mutation transformations/configuration/readers, terminal streams, direction streams, restoration and resource receipts. All six public correction checksums and all 255 private trial files match their manifest. This is inspection of prior execution, not new execution.

| Trial | Exact invocation | Whole-unit result | Accepted evidence and retained failure |
|---|---|---|---|
| 01 | `eac4cc51564b4b7095e9d093874fef51` | 1 | Baseline 106 and harmless 106 pass. Thirteen named faults have assertion failures. Composer's intended missing-warning query failure executes, but the AssertionError-only reader rejects it. Final API fault, restored suite, types, lint and direction do not run. All 18 finally pins match. |
| 02 | `893ed1308e4145acba354c9014fb8d1d` | 1 | Reuses sealed exact trial01 context without repeating 13 faults. Composer baseline/harmless each pass one; exact reader accepts its distinct query failure. API overBy baseline passes one and its fault has an AssertionError. Restored 106 pass, focused types 0 in 22.252 seconds, lint 0 in 10.950 seconds. Direction fails; raw Git exits 128 because `/dev/null` read/write is denied, not because object absence is established. |
| 03 | `683a6e634cd04cccacf3c8d275a52f14` | 1 | Direction only. Final device-only `/dev/null` bind verifies character 1:3, mode 0666 and zero-payload O_RDWR open/close. Raw metadata/cat-file pass. Git diff fails threaded lstat EAGAIN under Tasks32. No PID-event counter exists for this trial; cap causation remains inference. All 18 source and 180 prior files match. |
| 04 | `fdbe7fbe8a174a0d834ea9beb56466e7` | 0 | Direction only, Tasks64, 512 MiB, zero swap, CPU50. Metadata/cat-file/direction pass. Manager runtime 2.092 seconds; kernel memory peak 125771776 bytes, PID peak 43, max events 0, OOM 0. All 18 source and 215 prior files match. Earlier failed units remain failed. |

There are 14 accepted named AssertionError faults total and one distinct accepted composer query failure, not 15 assertion faults. The composer reader checks the exact mutation/file/find/replace, applied transform, named case, warning prefix, one failed case, zero passed and no suite-level runtime failure. It does not treat arbitrary nonzero exits as kills. Actual green baseline and harmless receipts disprove an always-failing harness explanation.

The targeted fault coverage includes dollar-number accumulation, gross-to-net, foreign attribution, equality, empty bucket, invalid ceiling erasure, missing-as-zero, wrong UI cent, unavailable UI text, projected API addition, unavailable audit, wrong artifact cent, unavailable artifact text, prior-for-projected and zero overBy. The mutation named `string-to-number-ui-regression` actually substitutes a wrong-cent literal. It proves that cent assertion responds; it does not prove general string-to-number conversion coverage. Original source stays read only and transforms restore in memory; current pins match afterward.

Literal-cent fixtures cover 45/91/100 rows, separate draft/billed buckets, numbers/strings, legitimate equality/one-cent overrun, zero, unavailable ceiling/buckets, strict identity, statuses and gross retention. Production helper subjects are real. API and artifact tests assert exact query projections and engagement filters. External SDK operations and native PDF rendering are mocked. Artifact HTML assembly samples 45 rows; larger string output has separate helper/API/formatter assertions. UI markup/state is not browser or native evidence. The euro-labeling assertion exposes a semantic blind category even when every selected test passes.

Saved resource evidence records clean environments, network unsharing, named source/old-source/donor read-only mounts before dependency use, lane-private cache/output and nonblocking shared compiler locking. Trials03/04 intentionally expose only `/dev/null` as an added writable device. Inherited nested writable mounts remain. No host-wide only-private-writable assertion follows from those named checks. I inspect saved receipts only and acquire no lock or manager operation.

## Retained limits and handoff

The existing 500-row summary list cap, SDK delivery/completeness, cross-record currency agreement, legacy agreement applicability, source-cost identity/reconciliation, native SQL/Auth/transport, concurrent creation and full financial meaning remain open at their established boundaries. KL-023 completeness and the broader KL-025/M11 meanings do not close through a supplied-input exact-money repair. No arbitrary aggregate cap, typmod widening, default currency or NTE hard gate is introduced or requested.

I do not repeat 106 tests, 15 faults, the original 52 cases, nine shared helpers, 184 campaign cases or 15129 formatter pairs. No whole-project compilation/build, browser, native PDF, practicing-finance reconstruction, installation, hosted, provider, account, socket, push, PR, main or release action occurs. Root receives this complete report and exact source/evidence pins before selecting a fresh correction. The final local checkpoint contains only this new review directory.

A preliminary metadata inspection used unavailable command `python` and returned 127 before reading any subject. That command failure remains in the private metadata receipt. Subsequent source/JSON/hash inspection uses `python3 -B` and no third-party dependency. There is no runtime dispatch, failed-test retry or hidden alternate subject execution.

The first staged Git whitespace check flags 12 numbered blank excerpt lines with trailing label spaces. I trim those new excerpt labels, retain the formatting finding privately and reseal the new report files. No pinned source or old evidence changes.

The review is complete with one source objection. Arithmetic source approval is bounded to the inspected supplied-set and exact-value transport path. The entire patch remains unapproved until the currency presentation is corrected and independently reviewed. Integration, browser/native/practitioner acceptance, M11 and V1 remain separate and incomplete.
