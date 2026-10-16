# Engagement billed helper loses cents in supplied-input arithmetic

The actual production helper returns a nine-cent error for 45 finite, within-typmod invoice values. Both supplied strings and supplied numbers reproduce it against an independent literal BigInt oracle. This is synthetic supplied-input arithmetic evidence. It does not establish an incident in stored data or a wrong NTE flag. The second unit ends with exit 1 because its subsequent direction command fails. No application implementation is authorized.

## Ownership and source identity

- Assigned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-be1591bb`.
- Assigned branch: `t3/engagement-billed-precision-probe`. T3 retains this binding.
- Initial clean HEAD: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
- Verified ancestor and local fast-forward destination: `87b18feb30b6989757c2b36592418881dd5443da`.
- Destination matches the referenced `project-budget-reviewed-combined-20261016` checkout. That checkout is read only for this task. It receives no edits or Git operations.
- Owned tracked files: this new review directory only.
- Owned private files: `/home/nathaniel/.local/state/openplan/engagement-billed-precision-probe-20261016` only.
- Root separately authorizes one empty, ignored `openplan/node_modules` mountpoint in the assigned checkout after pure01 fails. It contains no dependency files and is not a source change.

This review reads the assigned AGENTS, V1 contract, current roadmap, M11 definition, capability matrix, CORE-PM-01 ledger, KL-023/025, October 6 direction review and architecture. The roadmap calls M11 in progress. M11 retains separate cost, gross fee, retention and cash bases. The architecture explicitly dates most of its source description to September 6. No architecture statement establishes current runtime acceptance. Pure01 does not reach the direction command; pure02 reaches it after the helper probe and fails it.

The planner-writing and prove-it skills govern prose and probe preparation. There are no nested agents. Memory lookup returns no relevant entry; no conclusion depends on memory. This task does not reopen security, integrity, native, provider or scientific audits.

## Stored bounds come from source, not a live database

`20260727000010_receivable_invoicing.sql` declares:

- `invoicing_engagements.not_to_exceed_amount NUMERIC(14,2)`, nullable, with a nonnegative check.
- `client_invoices.subtotal_amount NUMERIC(14,2) NOT NULL DEFAULT 0`, with a nonnegative check.
- Invoice statuses limited to `draft`, `sent`, `paid` and `void`.
- Retention percent `NUMERIC(5,2)` between zero and 100. Retention and total use `NUMERIC(14,2)`.

For the finite stored subset under investigation, each subtotal and NTE lies between `0.00` and `999999999999.99`. One maximum row is exactly `99999999999999` cents. This review makes no live catalog or applied-migration claim and does not assert that the original nonnegative checks reject every nonfinite numeric value.

The current `20261017000005_money_integrity_corrections.sql` adds invoice lifecycle and line replacement rules without widening these columns. Its line replacement function requires a nonnegative exact line amount, equal subtotal and line sum, retention between zero and subtotal, and total equal subtotal less retention. It accepts one through 200 lines per invoice, which is not a cap on invoice count per engagement. A maximum subtotal with zero retention and equal total stays within the inspected money bounds. Current lifecycle rules retain sent and paid values and permit their normal transitions. They do not impose a cumulative engagement NTE hard stop.

An integer-cent representation can keep every possible sum of at most 90 maximum rows within `Number.MAX_SAFE_INTEGER`. The exact worst-case cent sums are `8999999999999910` for 90 rows and `9099999999999909` for 91 rows, compared with `9007199254740991`. This arithmetic does not certify the existing dollar-number addition or intermediate multiply-and-round sequence for 90 rows. Nor does exceeding that threshold prove every larger sum is wrong. Every synthetic NTE stays within its own `NUMERIC(14,2)` bound. A large aggregate is already over that ceiling; an oversized fictional NTE cannot establish a wrong boundary comparison.

## The production lead is distinct from the old retention issue

`receivables.ts:354` attributes invoice rows strictly by engagement id. It skips void rows, sums gross `subtotal_amount` into sent/paid billed and draft unbilled buckets, rounds through `Math.round(value * 100) / 100`, subtracts billed from NTE, and compares their JavaScript numbers. `EngagementBilledSummary` remains number based. The original source hash is `996c31054043f5f0f04e4949dbc2846912fde3c09bc8e5572c3791f237c2361b`.

Gross-before-retention behavior is intentional. The existing engagement test block includes a gross-retention control. This review does not reproduce the historical KL-025 net-retention issue or claim that it recurs. `invoicing/contracts/reconciliation.ts` separately uses BigInt cents and decimal gross models. Its correctness is not the subject of this probe.

Reachability established by source reading is limited to these callers:

- `app/(app)/invoicing/_components/receivables-lane.tsx` reads a workspace invoice list capped at 500 and passes it to the helper. `EngagementNteBar` displays gross billed, draft and legacy ceiling with `precision:"cents"`, labels legacy agreement terms unassessed, and does not currently display remaining or use the over-NTE flag.
- `lib/project-evidence-bundles/bytes.ts` reads engagement invoices and builds the summary for the invoice artifact. `lib/invoicing/invoice-pdf.ts` consumes billed and remaining in its HTML. Actual query delivery, complete retrieval and artifact rendering remain unverified.
- `app/api/invoicing/client-invoices/route.ts` uses the helper's prior billed value and performs another rounded number addition for a best-effort projected NTE warning. It warns rather than blocking invoice creation. There is no route execution here.

These reads return uncast numeric columns through the ordinary application client. Supplied number and string fixtures test the helper's accepted inputs separately. The actual Supabase raw JSON representation remains unknown. A synthetic supplied-number result would not establish a native read or transport incident.

Exact cents, a number's shortest decimal spelling, two-decimal rounding and whole-dollar presentation are different observations. The prepared probe retains raw numeric results, two-decimal spellings and independent literal-cent expectations. Whole-dollar values are diagnostic only. They do not establish the actual formatter output, and the actual invoicing surfaces inspected here request cents.

## pure01 stops before subject execution

Root grants one finite TEST window with the following resource limits: 90 seconds, 512 MiB memory, zero swap, 50 percent CPU and 32 tasks. The dispatcher pins the harness, source, schemas, exact manager argv and parent network namespace before dispatch. The manager client receives only PATH, LANG and the runtime directory derived from real uid 1000. The entry script takes one nonblocking compiler lock and attempts a host read-only Bubblewrap root, private-directory read/write bind, assigned and old-source read-only binds, unshared network, and final donor read-only bind onto assigned `openplan/node_modules`. A clean inner environment and Node heap of 192 MiB are prepared.

The actual terminal result is `HARNESS_SETUP_FAILURE`:

```text
Running as unit: op-m11-billed-precision-pure01.service; invocation ID: 43e7d1faecf94381a4932953b13b1a20
bwrap: Can't mkdir /home/nathaniel/.t3/worktrees/openplan/t3-be1591bb/openplan/node_modules: Read-only file system
```

The manager reports exit 1, 66 ms runtime, 36 ms CPU and 4 MiB peak memory with zero swap. Entry main PID is 617; dispatcher client PID is 616. The process reaches terminal state and releases the compiler lock. Root receives a prompt release notice. No retry, alternate command or second window follows this failure.

Original private evidence remains at the private root: `dispatch-intent.json`, `manager-entry.txt`, `stdout.txt` (empty), `stderr.txt`, `terminal.json`, and the original four harness files. Runtime namespace, effective cgroup and mount assertions never execute. The attempted configuration is not observed subject isolation. No TypeScript dependency, shared module, control, mutation, fixture, source restoration block or direction check executes. No precision result exists from pure01.

## pure02 preparation preserves the failed trial

After the failure, root authorizes creating the missing empty mountpoint and preparing a separate unit, `op-m11-billed-precision-pure02`. The before state has no mountpoint path or symlink. The after state is an empty real directory, verified ignored by Git. Preparation does not copy, install, chmod or modify the donor. Original pure01 files remain unchanged.

The private `pure02/` directory contains separate scripts, exact diffs and `preparation-pins.json`. The changes are limited to its output paths/unit, the now-existing empty mountpoint, and the actual `workspace-calendar.ts` import closure. That module is a real current `receivables.ts` dependency; it imports the already included actual deadlines module. Subject bytes, oracle assertions, fixtures and mutation definitions remain unchanged. Original source/schema hashes match predispatch pins. No dependency loads occur during this preparation.

The prepared probe uses donor TypeScript to transpile the actual pinned source in memory. Its loader allows actual shared source modules and substitutes none. A literal decimal validator rejects non-cent or above-typmod fixtures instead of turning them into zero. An independent BigInt oracle partitions legitimate statuses and attribution before summing literal cents. Fixed counts are 1, 2, 16, 32, 35, 36, 45, 46, 64, 90, 91 and 100 rows for separate billed and draft cases. Two further cases place the aggregate exactly at the maximum legitimate NTE and one cent above it. Both supplied strings and numbers are prepared. There is no arbitrary exponent search or large brute force.

Prepared controls cover sent/paid, draft, void, foreign and unassigned attribution, missing engagement identity, absent NTE and gross retention basis. A harmless source annotation must survive. Named one-cent oracle and gross-to-net behavior faults must fail for their specific assertions. A finally block restores in-memory source and reads back original disk bytes. The next section records their actual pure02 results.

Root subsequently grants exactly one new pure02 window with the same limits. The four prepared harness hashes match that grant before dispatch. All six source/schema hashes also match preparation. The second trial executes once. No further test, manager, lock, dependency, subject or direction command follows its terminal failure.

## pure02 proves arithmetic loss, then fails direction

Pure02 compiles the actual module and actual shared imports in memory with donor TypeScript 5.9.3. The compiler file SHA-256 is `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`. The exact six pinned source/schema files are four TypeScript modules (`receivables.ts`, `invoice-records.ts`, `work/deadlines.ts`, `time/workspace-calendar.ts`) and two migrations (`20260727000010_receivable_invoicing.sql`, `20261017000005_money_integrity_corrections.sql`). Each full path and hash appears in `evidence.json` and the private predispatch intent. No parser or formatter implementation from another campaign is modified or retested.

The helper's exact current signature is:

```ts
buildEngagementBilledSummary(
  engagement: InvoicingEngagementLike,
  invoices: ClientInvoiceRecordLike[] | null | undefined
): EngagementBilledSummary
```

The counterexample uses engagement id `eng-1` and NTE `999999999999.99`. Forty-five invoices each have subtotal `999999999999.99`, alternating sent and paid status, matching engagement id, zero retention and equal total. The same case runs once with decimal strings and once with supplied numbers. Every invoice amount and NTE fits its own stored typmod. The oracle obtains `45 * 99999999999999` integer cents directly from validated literals, independently of production parsing or rounding.

The observed result is:

- Exact billed: `44999999999999.55`. Helper billed: `44999999999999.64`, nine cents high.
- Exact remaining: `-43999999999999.56`. Helper remaining: `-43999999999999.65`, nine cents too negative.
- Exact and actual `isOverNte`: `true`. The legitimate NTE is not enlarged to reach this aggregate.
- Forty-five draft invoices instead give exact draft `44999999999999.55` and helper draft `44999999999999.64`. Billed stays zero, remaining stays equal to NTE and over-NTE stays false.

The serialized numeric spellings and the probe's two-decimal spellings agree for these specific counterexamples. A diagnostic whole-dollar rendering of the billed amount is `45,000,000,000,000`; both `.55` and `.64` round there. Whole-dollar agreement does not remove a nine-cent arithmetic error. Actual application formatting is source inspected, not executed by this probe.

There are 52 recorded cases. Twenty-four differ from their exact-cent expectations, at the sampled counts 45, 46, 64, 90, 91 and 100 for separate billed/draft buckets and both input forms. Count 45 is the first failing sampled count, not a demonstrated minimum. No larger search or threshold claim follows. The 45-row exact sum is below the integer safe-cent threshold; iterative dollar arithmetic can therefore fail before that aggregate threshold is crossed. Every single-row maximum case matches the oracle. The equality-at-maximum-NTE and one-cent-above cases also match in both input forms. No `isOverNte` difference occurs in the 52 cases. These samples do not establish that all other legitimate comparisons are correct.

Baseline and restored controls complete with correct legitimate status, attribution, absent-ceiling and gross-retention behavior. The mutation evidence establishes these narrow checks can distinguish a survivor from intended failures:

- `harmless-source-annotation` survives after an in-memory comment is added.
- `literal-oracle-plus-one-cent` fails `status-attribution-literal-oracle` with actual `7.00` against deliberately wrong `7.01`.
- `gross-to-net-behavior-regression` replaces only the in-memory subject's gross subtotal access with stored total access. It fails `gross-before-retention` with actual billed `8.80` against exact gross `11.00`, along with the expected remaining and flag consequences.
- The finally block restores all four in-memory modules and confirms exact disk readback against their original hashes. Application source is kernel read only during execution. No source restoration write is needed or performed.

These controls do not prove all precision defects are detected. The mutation cases test oracle sensitivity and gross basis. The count cases separately expose the real number arithmetic discrepancy. The probe records differences; it does not treat a known financial mismatch as a passing correctness assertion.

The helper probe exits zero after preserving its observations and restoration receipt. The subsequent direction script exits one:

```text
Error: Product-direction review check failed: reviewed_commit is not available: 380aad49770d856a9c4b577ccc9793baf39d3ddf
```

The script wraps a `git cat-file -e` call with ignored subprocess stderr, so this evidence does not identify the underlying Git failure. It does not prove the commit is absent from the host repository. Dated jurisdiction/capability reminders and the v0.66.0 versus v0.68.0 reminder also remain in the original stream. No date, commit, source, environment or check is changed to produce a pass. Direction is not accepted, and the entire pure02 unit stays failed with exit 1.

## Observed resource and mount boundary

The manager records `op-m11-billed-precision-pure02.service`, invocation `aee55228a58d417bac48ae06f1971af1`, entry main PID 49504 and dispatcher client PID 49503. Its terminal stream reports 1.681 seconds runtime, 851 ms CPU, 100.1 MiB peak memory and zero swap. The actual helper Node PID is 49507. The observed cgroup contains `memory.max=536870912`, `memory.swap.max=0`, `cpu.max=50000 100000` and `pids.max=32`. The probe's final resource sample reports zero OOM events and a memory peak of 104738816 bytes. The manager's terminal peak is rounded and covers the whole unit, including the later direction command.

The parent network namespace is `net:[4026531833]`; the subject namespace is `net:[4026533038]`. The subject environment contains only private home/cache/temp settings, PATH/LANG, Python bytecode protection and shell working-directory variables. No credential variables appear. Source mounting precedes the first donor TypeScript load.

Saved mountinfo establishes root `/`, assigned source, referenced old source, original donor path and final assigned donor path as read only. The private `pure02` directory is writable. However, inherited nested mounts retain writable flags, including pseudo-filesystem and pre-existing Docker namespace/rootfs submounts. The harness asserts the named source/donor paths, not every inherited mount. This is a material isolation limit: there is no host-wide only-private-writable claim. No native, Docker, database or transport command accesses those paths. Post-terminal review reads the saved mount metadata only. The raw mountinfo stays private and is sealed by hash.

Both units are terminal and their compiler locks release on process exit. There is no third dispatch or further test. Original pure01 setup failure and pure02 direction failure retain their separate identities and complete streams.

## Evidence limits and disposition

The reproduced defect is cent loss in the actual helper's supplied-input aggregate and remaining arithmetic. It requires large legal stored amounts in the observed cases. This evidence does not establish a practical monetary exposure rate or severity grade. No native origin, actual stored rows, live database, transport, HTTP, browser, service, hosted system, P1 or production incident is established. The probe cannot certify invoice retrieval completeness, accounting fit, authorization, concurrent writes, currency agreement or actual human usefulness. The 45-row fixture fits inside the inspected UI's 500-row cap, but actual delivery, list ordering, policies and rendering remain unverified. KL-023 and other campaigns remain outside this lane.

## Minimum coherent candidate for root disposition

Any implementation is a new ownership decision. A helper-only patch that converts an exact aggregate back to a number cannot preserve arbitrary aggregate cents. The smallest coherent candidate should keep exact cent arithmetic and decimal output through the affected consumers, preserve missing/invalid distinctions and gross retention basis, and avoid changing the separate contract reconciliation model.

The proposed owner would cover these existing files together:

- `lib/invoicing/receivables.ts`: exact billed/draft accumulation, NTE subtraction/comparison and a summary type that preserves aggregate cents. A deliberate decimal-string result can cross JSON boundaries; changing the type requires caller review. Invalid values need an explicit result or refusal, not a new silent-zero rule.
- `app/api/invoicing/client-invoices/route.ts`: preserve exact prior billed, projected addition, warning comparison and `overBy` serialization. Its present local number variables and second rounded addition would otherwise reintroduce loss. This is a best-effort warning, not a newly authorized hard NTE enforcement rule.
- `lib/project-evidence-bundles/bytes.ts`, `lib/invoicing/invoice-pdf.ts` and the necessary `lib/invoicing/invoice-currency.ts` adapter: carry exact summary amounts through artifact data and display. The current PDF `formatAmount` calls `parseCurrencyAmount`, and the currency adapter accepts numbers and calls `toFixed` for unassessed currencies. Those conversions need coherent treatment for exact strings, without modifying the reviewed shared formatter campaign.
- `app/(app)/invoicing/_components/receivables-lane.tsx` and `components/invoicing/engagement-nte-bar.tsx`: accept the revised summary and replace the current numeric draft-positive comparison with an exact comparison or derived boolean. Preserve legacy-terms disclosures and existing cent display.
- `test/invoicing-receivables.test.ts` and only relevant existing caller tests: a bounded actual-helper precision regression with literal cent expectations, legitimate status/attribution/retention controls and meaningful no-op/fault evidence. Caller evidence would need its own scope and resource authorization. No full suite, native database or browser acceptance is implied here.

Reuse existing exact-decimal or cents primitives where suitable after their input contracts are reviewed. No new financial framework or typmod migration is justified by this result alone. Do not modify the already reviewed money-helper/classifier/isolation campaigns. Root must choose candidate ownership and subsequent validation scope after reading this report and seals. This task ends with source unchanged and a local documentation-only checkpoint; no push, PR, merge or release follows.
