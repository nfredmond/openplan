# M11 delivery and closeout implementation

User direction on September 8 is the complete M11 management workflow, delivered in four sequential increments. No individual increment closes M11.

1. Agency reconciliation: contract PM/finance and explicitly scoped consultant access; received consultant invoice review/correction and source matching without new incurred cost; concurrency-safe master ceilings/terms; retained accounting/payroll intake and review; distinct funding/period/beneficiary/cost-basis and eligibility meanings.
2. Reviewed remaining work: staff My Work submissions and exact-version PM review; calendars, availability, assignments, dependencies and outside reviews; deterministic shared-capacity forecasts; original/current/forecast/actual dates; explicit cost/billing coverage; immutable input snapshots and staleness.
3. Weekly PM action: project/contract/task/person/deliverable drilldown, capacity and accessible schedule; caused warnings linked to records; existing risks/issues/decisions and proposed responses; scenario comparison separate from authorized baseline; My Work/reminders; versioned PDF/XLSX reporting.
4. Settlement/closeout: documented partial payments/retention/credits/disputes/refunds/commitments/corrections; stable invoice/accounting attribution without duplicate incurred costs/claims; deliverable submission/return/resubmission/authorized acceptance; separate work acceptance, settlement and obligations; immutable closeout/reopening and reconciled CSV/XLSX handoff.

Verification requires clearly labeled synthetic agency and consulting cases, adverse input/capacity/calendar/confidentiality/currency/concurrency cases, meaningful mutation controls, isolated RLS/populated upgrades, retries and interrupted saves, identified desktop/390px/keyboard journeys, console review and inspected exports. Human agency PM observation and independent finance reconstruction remain separate, required evidence for M11 completion. No actual authority, external transmission or paid service is authorized by synthetic engineering cases.

## Ownership and current checkpoint

Started from main 76f019bf, released v0.46.0, in isolated checkout `/home/nathaniel/.local/state/openplan/m11-delivery-closeout-2026-09-08`, branch `work/m11-delivery-closeout`. Contract libraries, management API/UI, additive contract migrations, focused tests and this evidence directory are owned here. Main and its demo remain untouched. Other Codex processes exist in main; no handoff or takeover is assumed.

Direction check passed with reminders against the historical v0.44 product review. Current roadmap M11 and v0.46 code confirm the implementation homes; no new module or accounting replacement is needed. Core CI, upgrade and RLS on main passed. Nightly QA failed with a browser timeout; this is separate from passing core CI and must remain disclosed.

Work is in progress. No M11 increment beyond v0.46 is yet released or accepted.


## Agency increment checkpoint, September 8

Draft additive migrations cover shared master authorization and linked task-order creation, scoped PM/finance/consultant designations, received-invoice review/source matching and retained accounting comparison/review. Forms use the existing contract command endpoint and manual-only agent refusal. Snapshot format 2 adds master, received-invoice and accounting evidence; older formats remain readable. This is not release or workflow acceptance.

Owned disposable Supabase stack: `/home/nathaniel/.local/state/openplan/m11-contract-verification`, ports 58621/58622/58624, container `supabase_db_m11-contract-verification`. Dev server :3247 uses this checkout with webpack and that stack. `which-openplan.sh` confirmed its serving directory. The startup guard refused an omitted stack selector without applying migrations. Turbopack rejected linked dependencies; webpack works.

All 195 isolated live checks passed before the latest snapshot-export additions. Scoped TypeScript had no errors. Mutation results retain four harmless survivors and twelve targeted failures. The first date mutation failed on the fee ceiling instead of its date boundary; the fixture now has independent ceiling headroom. A stale invoice review fixture was also separated from its transition guard. Unrelated rejection is not proof of a targeted guard.

Browser acceptance created a synthetic owner/workspace and project through real signup, sign-in and Projects. Workspace `64572b1d-aaf8-400a-84a5-6167cab3e6e3`; project `e4944a27-8ab2-4ca7-b03f-0915ee7fdd84`. No business rows were hand-seeded for this journey. Synthetic source text/CSV files are under `/tmp/openplan-m11-acceptance`. Browser uses the installed Browser skill and a new tab. Contract navigation and the full agency journey are in progress.

Logging error: disposable-stack startup output exposed local test credentials in tool output. Repository evidence retains no credentials. Subsequent setup writes directly to the private ignored environment file without printing credentials.

Remaining agency work: final role/export/worker checks; keyboard/desktop/390px and interruption journeys; complete QA, CI and release preparation. Remaining-work scheduling/forecasts, weekly PM action and settlement/closeout remain unimplemented. Preserve all four increments above.

## Additional checks and pending browser boundary

The latest isolated live suite passed 196 tests across 27 suites after all five migrations. Concurrent approvals on a shared USD 1500 ceiling produced one approval and one rejection for two USD 1000 orders; bypassing the ceiling made both commit and failed the concurrency proof. A harmless change survived. Populated upgrade retained sampled v0.46 source/baseline/time JSON byte-for-byte; see populated-upgrade.json. This is representative upgrade evidence, not a full backup/restore exercise.

Full unit run: 1199 suites passed, 20 skipped, 5 suites failed (six assertions). Failures were the newly added schema census, two SQL-read columns, absent audit calls on two download routes, copy ratchet and missing changelog migration documentation. These have been corrected and the six focused suites pass; full rerun remains pending. SQL-read legacy period metadata is explicitly accounted for; retained master source custody now has an export reader. Export controls include one harmless survivor and a targeted removal of format-2 evidence that fails the retained-table assertion.

Browser: master agreement 68b48c54-320b-4246-8748-c818bad49006, sourced USD 1500 authorization approved; two task orders created. Task A afbe573d-59cf-46cd-bedb-6661e1452902 approved for USD 1000, cost 500, hours 10, Jan 1-Dec 31 period and Oct 1 task deadline. Native keyboard input populated controlled dates; automation fill did not. Retained cost synthetic-vendor-cost is USD 25. Received invoice SYNTH-VENDOR-01 version 1 submitted with original CSV, version 2 returned with reason. Correction attachment stalled the browser transport; do not count correction, PM/finance role journeys or downloads as passed. Document worker runs only on the owned disposable stack, scratch /home/nathaniel/.local/state/openplan/m11-document-exports.

## Draft remaining-work implementation

In progress after agency checkpoint 80a3e40e. Added contract schedule/capacity/update/forecast streams, staff submission and exact PM review, a deterministic calendar/reservation calculation, existing contract-page forms and a My Work pending-review source. Four tables plus one security-invoker view live only on the disposable M11 stack. No stage-2 release or browser acceptance is claimed.

Initial focused checks: eight calculation tests and three live SQL tests; two harmless controls survived and eighteen targeted controls failed. SQL fixtures found an ambiguous staff alias and that was corrected before rerunning. Additional outside-reviewer availability input is being added, so those results are an earlier draft. The initial typecheck found a missing My Work source staticFilters property, since added. Full type/lint/RLS/source inventories and stage-2 acceptance remain pending.

Privacy review found inherited PM unmapped project spending could expose other assignments' costs. Draft reader hides rows and retains a count, which prevents complete forecast source coverage. Shared availability from another assignment omits its engagement identity and private explanation. This still requires a focused live privacy test. Forecast snapshots strip raw rate and accounting-import fields. Input custody/concurrent-change hashing needs further audit, especially raw physical time/spend changes and historical cutoff handling; do not claim complete forecast custody yet.

Browser recovery: a new tab could reopen saved task A. The original-file chooser then stalled again on the correction attachment. An asynchronous request to close the chooser is pending. No alternate browser automation surface has been used. Received invoice correction, separate roles, artifacts and mobile acceptance remain pending.

Latest draft verification: full unit suite passed 13,309 tests (1,206 suites; 177 tests skipped). The separate isolated live run passed 200 tests in 28 suites. TypeScript and focused lint passed. Updated delivery mutation proof retains 4 harmless survivors and 29 targeted failures, including input-read races, private-rate stripping, executable agent refusal, raw time staleness, four populated cross-tenant RLS failures, and report-table omission. See delivery-controls.json. These checks do not prove browser reachability, human understanding, all concurrency interleavings, or a production restore. New snapshot meaning distinguishes reviewed forecasts from agreed dates; earlier formats retain their old meaning.

Acceptance now uses http://m11.localhost:3247, an isolated hostname so test sign-ins do not replace other local applications' cookies. Same owned checkout/server/database; HTTP health responds 200. Four clearly labeled identity fixtures were provisioned through the local Supabase admin API, with staff/PM/finance member roles in the agency and no agency membership for the consultant. Synthetic staff identity was linked, but no budgets, assignments, estimates or decisions were seeded for the browser journey. IDs are in synthetic-identity-fixtures.json; credentials remain local only. Staff browser signup/sign-in and agency selection were exercised. Current browser is back at owner sign-in to assign staff and designate contract roles.

## Weekly responses and settlement draft, September 8 afternoon

New draft migrations 20260914000001 and 20260915000001/2/3 are applied only to the owned synthetic verification stack. The upgrade stack has not yet received delivery or these migrations. This remains a development branch, not a release or M11 completion.

- Projects now links to weekly assignment management, with contract/task/staff/deliverable costs, reviewed dates, an accessible schedule table and a timeline. Contract links open Updates, Schedule, Capacity, Forecasts and Responses.
- PM comparisons retain the current reviewed forecast, explicit proposed schedule/effort assumptions and the exact project risk/issue/decision. Applying a response changes the working schedule only. Staff assumptions are not written as accepted staff updates; baseline approval remains separate.
- A live test caught timestamp-only project-decision comparison accepting two edits in one transaction. Response commands and project-record summaries now carry a SHA-256 of the full source row. Proposal and application check it. The test reproduces the same-timestamp edit.
- Settlement versions retain original document custody and exact invoice versions. Payments, credits, refunds, retention holds/releases, disputes/resolutions and debit/credit adjustments have separate meanings. Linking an existing actual payment/credit counts it once. Corrections retain prior versions; duplicate source keys are refused. No settlement command creates incurred costs.
- Deliverable submission, return, resubmission and PM acceptance retain the original file. Closeout records separate acceptance, financial settlement and continuing obligations, permit underspend/zero positions, and retain immutable JSON plus accounting CSV. Existing PDF/XLSX snapshot exports now include responses, settlement, acceptance, obligations and handoff tables. Reopening appends a revision. Direct invoice/time/spend edits cannot bypass a closed assignment.
- PM report audience is separate from finance reports. Historical reports default to finance-only. PM report issue/queue, private-report refusal, storage access and revoked requester publication refusal have live SQL cases. Closeout JSON/CSV and full finance packages remain finance-only; PM state receives package metadata and position, not finance import contents.
- The invoice register now has a documented balance link using the same settlement calculation. Its new primary client balance summary reads all issued invoices, keeps currencies separate and preserves unassessed/inaccessible invoices rather than manufacturing zero. Existing status-based aging and secondary summaries still need reconciliation with these new documented figures.

Current tests are preliminary until workflow-controls.json is complete. Seven response/closeout SQL tests passed before further storage/relation cases were added; latest expanded closeout suite passed six tests. Calculation/API tests passed fourteen cases and the complete invoice-page reader passed two. A full unit run found three guard failures, corrected in focused runs: unread-column naming collision with inert billing schema, new copy vocabulary and missing Unreleased migration links. TypeScript and lint are being rerun after the latest register changes. No new browser acceptance, inspected report files, populated upgrade or CI has yet been claimed.

Failure-control corrections are themselves retained: the initial response-export mutation failed with an unhelpful undefined assertion, so the assertion now explicitly treats a missing table as an empty result. A finance authorization mutation initially reached a stale version guard before its intended probe. The unauthorized financial probe was moved before the owner's first save, so its input reaches the authorization boundary. The workspace relation probe now uses an existing foreign workspace, avoiding a different foreign-key failure as a false proof.

Remaining implementation/acceptance work includes:

1. Resumable calculation/import execution for expensive inputs, worker restart/retry proof, and forecast input-size/performance bounds. Existing report exports already use the local document worker, which must be restarted after code freezes.
2. Reminder integration pending explicit approval for the prepared constraint replacement in NOTIFICATION_KIND_EXTENSION.sql. No DROP was executed. Weekly management truthfully shows automatic contract reminders as not installed and separately reports the existing sweep heartbeat/email transport.
3. Complete reassignment planning roster/capacity lookup, removal of former schedule assignments, departed-member SQL checks and zero-hour late-finish warnings. Review current implementation against the full four-increment plan, including received-invoice correction/settlement, commitments, duplicate reimbursement prevention, accounting attribution and cross-project privacy.
4. Reconcile remaining status-only invoice summaries/aging with documented balances; preserve exact currencies and unknowns. Review invoice update behavior when financial events already exist.
5. Finish browser agency and small-practice cases. Current browser is m11.localhost:3247, synthetic owner on task A, with no staff schedule submitted yet. Role grants exist for PM, finance and consultant. Received invoice v1 submission and v2 return exist, correction is still pending the file-chooser issue. Project deliverable and task link must be created through UI. Native keyboard date entry works where controlled-input fill did not.
6. Full mutation review, isolated full RLS, populated upgrade preserving old source hashes, production webpack build, desktop/390px/keyboard/interrupted-save journeys, console review, PDF/XLSX/JSON/CSV inspection and independent reconstruction, document-worker retries, draft PR/CI and demo recovery evidence.
7. Release only verified increments with honest roadmap/limitations. Main/demo are owned by another active session and remain untouched. Required observed agency PM review and independent finance acceptance remain absent; M11 must stay open without them.

Checkpoint verification update: workflow-controls.json now contains ten harmless survivors and thirty-six targeted failures, including the existing reimbursement read-error and locale/cent-presentation tests after their test-only server-component bootstrap was updated. The full isolated RLS run passed 208 tests in 30 suites. The subsequent full unit run is in progress after fixing its three identified regression causes: server-only imports in old component tests, explicitly isolating the client-balance child in the funder-only rendering test, and lowering the copy ratchet for terms actually removed. TypeScript and focused lint passed before those test-only bootstrap changes.

Browser progress: task A working schedule version 1 and shared staff capacity version 1 were saved through the UI. Work reserves 4.00 hours/day through September 30, with September 9 explicitly unavailable; the separate agency review takes two calendar days after staff work. Shared availability is 8.00 hours/day September 1–30 with the same dated exception. Controlled native date inputs require fill followed by ArrowUp/ArrowDown to commit the edit in this browser; inspect the resulting value before saving. A prior keyboard attempt produced an invalid future year, corrected before any save. Current tab is moving from synthetic owner sign-out to staff sign-in.

Additional issue to fix before acceptance: reviewed forecast issuance currently protects source consistency during server reading, but its command does not yet bind the input hash the PM saw before clicking. Add an explicit expected hash to new forecast/closeout commands and bind queued calculations to that same reviewed hash, with stale-browser tests. This is an open draft limitation, not acceptable reviewed-forecast authority.

Final checkpoint checks before commit: full unit run passed 13,325 tests in 1,210 suites, with 185 tests/23 suites skipped. Separate isolated RLS passed 208 tests in 30 suites. Workflow mutation results retain 10 harmless survivors and 36 targeted failures. TypeScript, focused lint and diff whitespace checks passed. This proves the named calculation, SQL, report-access, pagination and regression boundaries, not browser completion, all concurrent interleavings, production recovery or human acceptance. The draft reviewed-hash and long-calculation limitations above remain open for the next work.

### Durable calculation checkpoint in progress

- Shared normalization now binds the PM's browser input hash for a forecast and finance's browser closeout hash. Targeted controls remove each binding and fail the corresponding stale-page API test; a comment survives. Normalization was extracted to `calculation.ts` for API/worker reuse. Older proof scripts now target that module for calculation controls.
- Added local calculation jobs, service-only execution functions, scoped metadata, exact request retries, child-process calculation and parent lease renewal. The existing POST management route queues forecast/response/accounting-import/closeout; legacy v0.46 operations retain their route and behavior. The job and retained decision commit atomically.
- Disposable SQL tests recover an expired lease, reject an old worker and changed request, retain exactly one forecast, refuse stale browser and queued source versions, refuse revoked requesters, protect private job payloads and hide outsider metadata. The first invocation accidentally used the QA opt-in rather than the live-test opt-in and skipped both tests; it is not evidence. Corrected live invocation passed both tests. Fixture corrections qualified a `result` column and added a replacement owner before testing requester revocation.
- A source-check mutation survived because the underlying contract transaction independently rejected stale inputs. The combined mutation removes both checks and fails; this is explicit redundant protection, not an isolated queue-check proof.
- Browser continuation: synthetic PM entered from My Work, reviewed submitted staff version 1 with USD 100.01 remaining cost and retained accepted version 2. Preview showed staff work September 8/10/11, outside calendar review September 12/13 and USD 125.01 actual-plus-remaining including the one USD 25 expense. Job `8c65e9bf-6909-4070-b07f-83ca34a49a58` completed through the real local worker and the browser displayed matching reviewed forecast 1. PM then saved outside-reviewer unavailability; its unsupported forecast journey is next. These are engineering synthetic records, not responsible human approval.
- CI for pushed `95e580a5` passed live RLS, restore, shuffled units and worker/Python checks; QA failed at npm audit after its 13,325 unit tests passed. [CSV advisory](https://github.com/advisories/GHSA-8cw4-87c7-c6xx) was updated September 8 and names 7.0.2 as the fix. [Provider utility advisory](https://github.com/advisories/GHSA-866g-f22w-33x8) also appeared in the audit. This branch now has independent node_modules (the previous symlink remains at `/tmp/openplan-m11-shared-node-modules-link`) and updates CSV plus compatible AI SDK dependency patches. Current production audit reports zero advisories; broad regression and build checks are pending. Development-only advisory findings remain outside that production audit claim.
- Local full unit run before dependency updates had three failures: new job route missing the whole-path caller expression, audit scanner unable to see the delegated read logger, and missing migration changelog entry. The route and changelog were corrected; targeted route/read/unread-column guards and release ordering pass. This run is not a green full-suite result.
- New draft migration `20260916000001_contract_calculation_jobs.sql` is applied only to disposable m11-contract-verification; no main/demo changes. SQL creation and subsequent function correction were run explicitly and the migration history repaired to applied. Fresh/populated application on the separate upgrade stack remains required.
- Remaining milestone gaps from the preceding checkpoint still apply, including contract reminders pending the CHECK-change authorization, forecast edge cases and staff reassignment, financial secondary summaries, full independent artifact reconstruction, mobile/keyboard/interruption/recovery and human acceptance. No tag, release or M11 closure is claimed.

### Calculation checkpoint verification

- Patched dependencies: full unit suite **13,330 passed, 187 skipped**, 1,211 passing and 24 skipped suites (`/tmp/openplan-m11-patched-all-unit.log`). TypeScript and full lint passed. Production npm audit zero advisories. Unit tests do not prove tenant isolation or browser acceptance.
- Separate populated-upgrade stack applied all six remaining migrations and retained identical parsed JSON for original baseline, two actual versions and physical time. Canonical compact/sorted JSON SHA-256 is recorded in `populated-delivery-upgrade.json`; its serialization differs from the earlier five-migration receipt. Full live RLS suite on that stack: **210 tests, 31 suites passed** (`/tmp/openplan-m11-patched-upgrade-all-rls.log`).
- Calculation controls: 14 outcomes, including harmless SQL/API survivors, the deliberately redundant source-check survivor, and 11 failures for changed retry, stale browser, stale worker, changed normalized request, both source guards removed, revoked actor, expired heartbeat, outsider metadata, private payload, agent execution and forged calculation output. Detailed results are in `calculation-job-controls.json`.
- Actual worker crash: a test-only preload in `/tmp` delayed the child before calculation, then both owned processes were terminated after a real claim. The replacement worker waited for natural lease expiry and completed attempt 2. SQL independently found exactly one retained request and one forecast; the PM browser displayed success and reviewed forecast 3. See `calculation-worker-crash.json`. No fault hook was added to product code.
- Synthetic unavailable-reviewer forecast 2 has an unassessed finish and an explicit warning; forecast 1 remains intact and stale. Browser preview and recorded forecasts remain distinct. Desktop final screenshots, 390px, keyboard and inspected export packages are still pending.

- CSV prototype regression distinguishes patched 7.0.2 from the previous 6.2.0 parser using the same labeled synthetic duplicate-header input. A harmless comment survives and the old dependency fails (`csv-dependency-controls.json`).
- Shared-module control rerun: all 46 workflow controls reproduced. The older delivery export mutation initially survived because its version-3-only source string no longer existed after versioned report expansion. It was a no-op, not export coverage. The script now asserts changed source and targets the current version check; completed earlier controls remain recorded individually.

### Current staffing and financial position checkpoint

- Draft migrations 20260917000001 and 20260918000001 are applied to both named disposable stacks. Former schedule nodes release active assignments; departures block new assignments and accepted reviews but permit a documented return; scoped PMs can select active colleagues without private rates. Closed outside assignments release capacity and change the forecast input hash. Existing reviewed forecasts become stale under the new input-hash recipe without changing their retained content.
- Invoice register totals and aging now use the same documented financial events as assignment management. A paged issued-invoice read binds each exact invoice timestamp, preserves separate currencies, and ages currently due amounts independently of retention, disputes and refund obligations. Incomplete reads remain unassessed. Paid status alone cannot establish settlement; undated issued obligations remain visible. Current received-invoice corrections determine the financial period while their original versions stay retained.
- Gross fee remaining to be billed excludes payment credits in snapshot format 5. Older report formats retain their prior calculation. Current reviewed remaining-cost forecasts now reach the position and version-5 report; stale forecasts produce unassessed current remaining costs.
- Mutable planning rows have no retrospective versions. A service-only metadata ledger retains their transaction mutation time. New reports refuse earlier cutoffs after those records change or disappear, including membership departure and reassignment. Its initial installation prevents reconstruction of mutable inputs from before installation. This boundary is conservative across the workspace, matching shared-capacity input scope. It does not retrofit missing pre-installation source history or rewrite old issued reports.
- Independent populated-upgrade comparison retained the original baseline, two actual versions and physical time exactly (`populated-current-upgrade.json`). Full isolated upgrade RLS passed 215 tests in 32 suites. Subsequent focused verification covers the added response-record cutoff assertion.
- `current-position-controls.json` retains harmless survivors and targeted failures for current assignments, departure, capacity release, zero-hour late work, financial period coverage, invoice version/pagination/currency/aging, gross-fee credits, stale forecast reports, cutoff custody and private metadata. The initial future-record mutation generated invalid TypeScript rather than a behavior failure. It was repaired to remove the whole intended guard line and reproduced the named financial-period failure; the syntax failure is not counted as evidence.
- First broad unit run: 13,333 passed, four failed, 192 skipped. Failures were the new relation/RLS counts, a SQL-only source-change timestamp missing its reader registration, a lower UI vocabulary count, and a missing migration link. Each was corrected with its source reason; the changed guards have harmless and targeted controls. Broad rerun, lint and production build are pending at this note.
- Development server on 3247 stalled compiling project navigation with approximately 9 GB resident memory. Its owned process was stopped. The final browser build must be restarted and identified; the prior tab contents are not evidence of current source. The main/demo remain untouched.

Still open: complete the real UI agency and small-practice cases, reassignment scenario ergonomics and capacity visibility for a colleague not yet assigned, automatic contract reminders pending the prepared CHECK-change authorization, large-preview responsiveness, overlapping retention/dispute treatment, inspected immutable PDF/XLSX/JSON/CSV packages, browser mobile/keyboard/interrupted saves, recovery and release evidence. Neither required observed human acceptance exists. M11 remains open.

Current checkpoint verification: broad rerun passed **13,337 tests**, with **192 skipped**, across **1,212 passing and 25 skipped suites**. Full lint and TypeScript passed. Full isolated upgrade RLS passed 215 tests; the final expanded staff/cutoff suite separately passed all five tests. The 36 current-position controls contain 11 harmless survivors and 25 intended failures. These checks do not establish browser usability, all transaction interleavings, production build/recovery or responsible human acceptance. CI for preceding commit d55553c6 passed all seven jobs; the next pushed commit needs its own CI.

Production candidate 4f448f4ab3aca4647a8c0858de86ebddad97e9be built successfully with webpack and serves m11.localhost:3247. `which-openplan.sh` confirmed commit and worktree. The earlier worker PID note was wrong: 392204 belongs to the OWP review checkout. Live cwd verification caught it before any signal; that process was left untouched. A new document worker was started from the M11 worktree, session 11820, log `/tmp/openplan-m11-owned-document-worker.log`. Production server session 44556, log `/tmp/openplan-m11-production.log`.

Production browser continuation: scoped synthetic PM created deliverable 16afaa5a-08b4-4b1e-9bc3-4d638f66e633, Synthetic draft planning report, due October 1, from Project > Delivery. PM then created risk 1ab53569-c2ca-42fd-86b9-5a5a19df55ee, Synthetic outside reviewer unavailable, from Project > Record. Independent SQL confirmed both. Task A's Position now explicitly marks prior forecasts stale. No baseline amendment has yet been saved. Current browser is signing into synthetic staff for added work. All entries remain labeled engineering cases.

### PM proposal source and reassignment repair

The production browser exposed a blocked PM source path: the scoped PM successfully uploaded `Synthetic M11 management amendment and forecast terms`, but contract source pickers only showed documents already in a baseline. Migration 20260919000001 now includes that PM's own retained uploads, while unrelated uploaders' private documents remain excluded. Billing treatment still requires a source attached to an approved baseline. Uploading a proposed amendment does not authorize its fee or terms.

The same migration makes shared availability for active colleagues visible before they are assigned, retaining privacy-safe outside reservation totals. The response form can explicitly replace a task reservation with the selected colleague as a proposal. Its before/after calculation keeps approved budgets and accepted staff records unchanged; applying it still requires the new staff member's reviewed update.

Verification: six initial focused tests passed; the populated-upgrade stack then passed all twelve agency/staff/delivery SQL tests. Final focused UI/calculation/migration/copy regression passed 48 tests in six suites. TypeScript and focused lint passed. The current control receipt now has 42 outcomes: 12 harmless survivors and 30 intended failures, including the replaced SQL functions, owned-document privacy, colleague availability, omitted reassignment and baseline mutation through the response form. The initial copy check caught an added occurrence of a discouraged term; the new instruction now says staff update. No rule was relaxed.

Browser business records before this repair: staff submitted remaining-work version 3 for 60 hours, PM reviewed it into accepted version 4 with USD 600 remaining cost and separate USD 1250 expected gross billing assumption. The source record explicitly requires time-and-materials agreement treatment before using that billing assumption. The working schedule remains version 2, with outside reviewer unavailable and September 30 reservation ends. No new forecast or baseline amendment has been saved yet. The new source file is retained in Documents and attached to the synthetic project.

### Pending contract decision queue and dependency repair

The synthetic finance journey found a proposed task A baseline missing from My Work. Migration 20260920000001 adds a security-invoker decision view using existing contract role checks. Proposed baselines/master terms appear for finance, submitted received invoices for management, reviewed invoices for finance, and the latest unapplied response for management. The queue links to the corresponding contract panel. Response entries preserve the retained project record title and explain that changed inputs require a fresh comparison. Returned invoices are outside the approval queue; consultant correction routing remains an unfinished acceptance boundary.

The initial focused run exposed a missing view name in the migration inventory, corrected before rerunning. Focused checks then passed 65 tests. On the populated isolated upgrade stack, all 218 live SQL tests passed. Original v0.46 baseline, retained actual versions and physical time records remain byte-equivalent after canonical JSON normalization, recorded in populated-pending-upgrade.json. Nineteen failure controls include three harmless survivors and sixteen intended failures, recorded in pending-review-controls.json. Controls catch missing queues, PM financial approval exposure, resurfaced historical versions, missing response titles, applied responses remaining pending, incomplete projections and incorrect links. These tests do not prove notification delivery, browser panel reachability, arbitrary Postgres interleavings or observed human acceptance.

CI for 99630e52 passed 13,338 unit tests and all jobs except the QA gate's production dependency audit. The audit now includes [Next.js Windows-hosted remote execution](https://github.com/advisories/GHSA-p293-qw3h-jr36), patched in 16.3.3, and [baseline-browser-mapping invalid-input termination](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv). The candidate now uses Next.js/eslint-config-next 16.3.4 and an updated baseline-browser-mapping lock entry. Production audit returns zero current advisories. This supersedes the earlier audit status; it does not claim the local Linux instance was affected by the Windows-specific exploit. Broad tests, lint and the production build are running for this dependency change. The owned candidate server was stopped before changing its installed dependencies; other servers and workers were left alone.

Synthetic browser state: task A proposed baseline version 2, “Synthetic A source clarification and deliverable linkage,” remains unapproved. It retains fee 1000, cost 500, 10 hours and October 1 deadline, adds the created deliverable and staff allocation, and retains the new management source document. Finance is on My Work awaiting the repaired build. No increased authorization has been recorded, and no amendment or closeout acceptance is claimed. Existing unresolved M11 boundaries remain open, including the pending reminder CHECK authorization and required agency PM/finance observations.

The updated Next.js lint rule flagged the existing safety CSV/GeoJSON attachment endpoint's window navigation. Added a line-specific exception explaining that this is an attachment download, not page routing. The full lint rerun is still pending; download behavior is unchanged. The preceding checkpoint prematurely described lint as passed before the process completed, and this note corrects that claim.

Verification completed for the pending-queue candidate: the production build passes with Next.js 16.3.4, the broad unit run passes 13,340 tests with 195 skipped across 1,214 passing/26 skipped suites, and the separate full lint rerun exits zero. Instance identity for http://m11.localhost:3247 matches 19c2ee696e9d and the owned M11 checkout. The first startup used an eight-character stamp, which the identity script correctly refused against its twelve-character identity; the owned server was restarted with the full SHA before browser acceptance.

Finance browser acceptance: My Work displayed the proposed baseline, Enter opened its Baselines panel, and the synthetic finance actor approved exact version 2. Independent SQL confirms both retained versions approved, with the same USD 1000 fee, USD 500 cost budget and October 1 deadline. Returning to My Work removed the approved decision. A copy issue remains: the existing Waiting on a person explanation says every member sees the same queue, which is now inaccurate for contract role-scoped decisions. Correct that explanation in the next UI checkpoint. Current browser is signing in as the synthetic PM for the changed-work forecast and response.

### Agency forecast, amendment, consultant invoice and accounting journey

The scoped PM entered Projects > Synthetic agency assignment > Weekly assignment management > Schedule. Working schedule version 3 keeps the outside reviewer unavailable, extends only the review horizon to October 31, and cites the now-approved retained time-and-materials source. Forecast version 4 was calculated by the real worker from accepted update 4: remaining cost USD 600, actual-plus-remaining USD 625, expected remaining gross billing USD 1250, no supported finish. It explicitly warns about unavailable review, the USD 500 cost budget and USD 1000 fee.

The PM then compared October 2 reviewer availability for the explicit two-calendar-day review, tied to retained risk 1ab53569-c2ca-42fd-86b9-5a5a19df55ee. Response 0c2ff3e5-b0fb-46bc-8a9f-9e28342671ae produces an October 3 finish with a missed-deadline warning. My Work routes the response back to its panel. Applying it creates working schedule version 4 and one application; independent SQL confirms baseline version 2 still has fee 1000, cost 500 and October 1 deadline. The PM separately proposed baseline version 3 with fee 1250, cost 800, 70 hours and October 15 deadline, and finance approved its exact version through My Work. The original baseline remains retained. Task B and the increased master authorization are still unapproved.

The native file chooser stalled again on a click. Closing only the owned acceptance tab and creating a fresh tab restored screenshots. Focusing a file input with ArrowRight, then waiting for filechooser while pressing Enter, successfully selects a file without the click timeout. The current browser binding is still the same selected Chrome; acceptanceTab now points to its fresh owned tab. Do not attach the two older stalled 127.0.0.1 tabs.

Received invoice SYNTH-VENDOR-01 now retains versions 1 submitted, 2 returned, 3 corrected/submitted with original file b1a6c40c-e07a-4ff1-b8d0-8816df13e52e, 4 PM-reviewed and 5 finance-approved. Each role reached its decision through My Work. Finance matched USD 25 to existing expense entry db01c842-e70c-42e6-9269-437f87264294/current version 09b1ec00-feee-4f09-a593-301c373d3c2d. Independent SQL still finds exactly one incurred-cost record totaling USD 25. The corrected file explicitly documents service basis and no indirect or fixed fee.

Accounting import 5667714a-00d3-4d90-8a9d-b257658cc83d was uploaded/mapped through the UI and processed by the actual calculation worker. Finance reconciled retained external row SYNTH-POST-01 to the same actual version, with equal USD 25 and no labor hours. The incurred record count/amount remains unchanged.

Settlement source document 011c9628-28bd-4ccf-a892-d21168ea8d3b, Synthetic M11 settlement event evidence, was uploaded through Documents and is ready/indexed. Its eight hypothetical events independently reconcile invoice gross 25 - payments 24 - credits 2 + refunds 1 = zero, with distinct retention/dispute holds and releases. These remain labeled engineering events, not actual postings. Only the first event, SYNTH-HOLD-01/retention_hold/USD 5, has been recorded so far. The rest are in /tmp/openplan-m11-acceptance/synthetic-financial-events.txt.

A real source-status defect blocked that first event: record_contract_command_closeout required kb_documents.status='stored', rejecting indexed original files marked ready. New migration 20260921000001 aligns this with the existing agreement source rule, retaining scope, checksums, storage identity and generated-report exclusions. The new live regression failed on the old function with the observed error, then passed after migration. Focused checks passed 54 tests. One harmless control survives; excluding ready files and admitting a foreign file each fail for the intended reason. Retrying the unchanged browser request records one event, with invoice gross/open 25, retention 5 and currently due 20. The original cost remains 25. This is also evidence of retained failed-request recovery, not a simulated network interruption.

The existing Waiting on a person copy now explains role-scoped contract decisions. This text change awaits the next served build. CI for 19c2ee696e9d passed units, shuffled tests, live RLS, recovery and workers, but the QA audit found [Sharp/libheif advisory GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), published to the advisory database September 8. Next.js 16.3.4 requires sharp ^0.35.4, but an inherited override pinned 0.35.3. Both obsolete npm/pnpm override entries are removed so the supported Next dependency can resolve. The owned production server PID 3526192 was stopped before installation. Patch installation/audit, upgrade tests and next build verification are pending at this note.

Indexed-file checkpoint validation: 39 tests pass on the populated isolated upgrade stack after migration 20260921000001; 66 focused unit/UI/route/inventory tests and targeted lint pass. The dependency now resolves sharp 0.35.4 with no override, and the current production audit has zero advisories. A synthetic 2-by-3 RGB PNG round trip checked dimensions and decoded pixel bytes using the installed Sharp. This does not replace image/export/browser acceptance. The next production build and exact-commit CI remain required.

Build 27df0a73c86b passed and instance identity matches the owned candidate. Finance then recorded all eight synthetic financial events through the Settlement form. Intermediate displayed balances separated retention, disputed and currently due amounts. Final received invoice position is gross 25.00, payments 24.00, credits 2.00, refunds 1.00, retention 0.00, disputed 0.00 and open/currently due 0.00. Independent SQL plus Decimal reconstruction matches the explicit source equation and eight distinct source identifiers; see received-settlement-reconstruction.json. Exported-file reconstruction, actual labor, deliverable acceptance and closeout remain pending. Current browser is switching to the synthetic agency owner for task B/shared master authorization before closing task A.

Read-only audit identified another unfinished agency boundary: reconcileContract currently computes gross billed/remaining fee from outgoing client invoices only. There is no explicit approved agreement billing perspective. Received payables are correctly separate in Settlement but cannot yet establish agency purchaser fee drawdown. Before claiming the agency management view complete, add an explicit agreement perspective/direction and preserve legacy issued report meanings; do not present outgoing zero as agency vendor fee progress. This is an implementation gap, not a responsible-human acceptance issue. Current CSV handoff also omits received line/match and accounting-review detail, although JSON and management XLSX tables retain those records. Add versioned CSV attribution before independent handoff acceptance.


### Agency fee perspective and retained accounting handoff

Task B was moved to separate project d4f43412-87c8-4fc9-aa20-1de9394cdd2f before its baseline and costs. Its USD 1000 approval was refused in the actual owner browser while approved A USD 1250 plus B exceeded master version 1's USD 1500 ceiling. The rejected proposal stayed proposed. Master version 2 separately authorized USD 2500 against the retained management amendment; a fresh B approval then succeeded, totaling USD 2250. Independent SQL confirms both retained master versions and B baseline 1 approved. The engineering actors and evidence are synthetic, not actual agency authorization.

The prior CI failure was an incorrectly labeled changelog link, not a missing migration: the indexed-source link label was only “migration.” The release check requires its identifying name. The label is corrected; the original statement that it was omitted was corrected to Nathaniel.

Migration 20260922000001 retains an explicit received/outgoing/internal/unassessed billing direction in new baseline proposals, checked again in the database. Approval remains separate. Missing fields on old baselines retain the prior outgoing convention, stated in the UI, until amended. Current received versions consume purchaser fee only after approval; pending corrections and mixed currency leave fee drawdown unassessed. Neither client invoices nor settlement credits are added to agency gross fee consumption. The Position cash cards follow the approved direction and retain invoice detail separately. A focused UI check first caught the inherited outgoing-only cash filter and then passed after its removal.

New report snapshots use format 6; older issued snapshots keep their former calculations and labels. Migration 20260923000001 binds the new calculation revision and received invoice version identities to forecast custody, making old reviews stale rather than changing them. Internal or unassessed billing perspectives do not produce expected gross billing.

New closeout packages use format 2. Their CSV and management-workbook handoff retains received line treatments/bases, exact cost-version matches, full source allocations, original accounting file identity/hash, external posting identifiers and every discrepancy/reconciliation decision. Full source allocations are explicitly not invoice-share allocations and are not added as costs. Old format 1 columns and rows remain unchanged and both formats remain downloadable. Private rate records remain excluded from the package.

Verification: 57 focused checks passed before the added cash/download cases, then the new cash cases passed three tests and download/normalization cases passed six. The populated upgrade stack passes all 223 live tests in 34 suites through migration 20260923000001. Original baseline, both cost versions and physical time remain identical (populated-billing-upgrade.json). New database tests failed against old behavior before migration; a test fixture's ambiguous state column was corrected before the passing run. billing-direction-controls.json records 23 controls: two harmless survivors and 21 targeted failures for direction, current versions, pending reviews, currency, old formats, source attribution, form submission, cash direction, expected billing, download scoping and SQL custody. These checks do not establish browser acceptance of the new build, every transaction interleaving, independent exported-file reconstruction or human acceptance. Broad tests/lint and the new production build are pending at this note.

Still required: finish shared-capacity/private-content and small-practice journeys, actual labor and deliverable event/closeout/reopen cases, inspected desktop/390px/keyboard and PDF/XLSX/JSON/CSV artifacts, interrupted saves and final recovery/CI. Overlapping withheld amounts, consultant correction reachability, large-preview responsiveness and the reminder CHECK authorization remain open. Neither required human acceptance exists. M11 is not complete or released.

Broad unit verification for the billing-direction checkpoint passed 13,353 tests with 200 skipped, across 1,218 passing and 27 skipped suites. TypeScript passed. The separately executed populated-upgrade live suite passed 223 tests in 34 suites; broad-unit skips are not presented as database proof. Synthetic task B working schedule version 1 was saved through its separate project's weekly management view: five hours per working day through September 30, shared with A's four hours. Its private title is Synthetic confidential second-project analysis. The scoped PM has not yet performed the outside-reservation privacy journey. Owned production PID 3684621 was stopped before rebuilding; the next server must be identified again. Lint and build remain pending at this note.

The billing-direction candidate's full lint and production webpack build both completed with exit zero. The additional cash/download test lint and final TypeScript check also passed. Browser acceptance must use the next identified commit; passing build output does not complete that journey.

Browser build b2b8b3802314 matches the M11 checkout. Through Projects > agency assignment > task A > Baselines, the owner proposed exact version 4 clarifying the agency purchaser direction. Before approval the Position still displayed approved version 3 and the legacy outgoing convention. Separate version-4 approval changed Position to received direction: supplier gross USD 25, incurred USD 25, documented payments USD 24, open balance USD 0, unbilled supplier fee USD 1225. SQL confirms versions 1–3 retain no direction field and version 4 alone carries received; fee/cost remain USD 1250/800. Desktop evidence is retained in browser/b2b8-agency-position-desktop.jpg. The screenshot also exposes excessive completed-calculation cards above the working view; collapse completed history before final usability acceptance. Current actor is switching to scoped PM for capacity privacy.

Scoped PM browser forecast version 5 (worker job 3dad531d-9609-4a7b-9cb1-62714f846684) retains the cross-project overload: A reserves 4 hours plus outside assignments 5, against available 8. Finish stays unassessed, with USD 600 remaining cost/625 actual-plus-remaining and the explicit 25+1250>1250 supplier fee warning. The PM page contains neither B's private schedule title nor its private task title. Independent scoped SQL confirms B role remains member and outside reservations contain only staffId/date/hours (pm-outside-capacity-scope.json). No private contract content is needed to explain the overload.

Desktop and 390px captures are retained under browser/b2b8-pm-capacity-*.jpg. Warning text wraps; the schedule table scrolls within its container. Document width equals the 390px viewport (the bottom shell navigation has its own scrollbar). The console returned no errors or warnings. This is partial responsive acceptance: completed calculation history and two layers of wrapped section buttons consume excessive mobile height. Pause browser acceptance while tightening those controls, then re-identify and repeat the relevant journeys. Viewport restored to desktop. Current signed-in actor is the scoped PM on A Forecasts.

### Review layout repair after desktop and mobile inspection

Completed calculation history now starts collapsed while queued, running and failed requests remain visible with their original retry action. Mobile contract and remaining-work selectors retain the same role-filtered sections as desktop. Earlier reviewed forecasts start collapsed; a working preview is explicitly separate from retained review. Repeated warning explanations group by cause, task, staff and message, retaining every affected date under a native disclosure. The weekly page no longer repeats all warnings twice and links each group to the affected review section. No calculation or report history is changed. A failed financial reconciliation also suppresses Position figures instead of falling through to zero cash.

Validation: 33 focused behavioral tests and 32 existing copy checks passed; TypeScript and targeted lint passed. Nine controls contain one harmless survivor and eight intended failures for dated evidence, affected links, failed jobs/retry identity, collapsed history, role-scoped selectors and source-error figures. The production build completed successfully. Browser acceptance of this next commit remains required; the captured b2b8 images document the preceding layout. No full M11 or release claim follows from these checks.


The compact build acdfd933bd46 is identified in the owned checkout. At 390px, keyboard Home selected Position and DOM confirmed the approved purchaser figures. Capture stalled around native selector/viewport interactions; closing only owned tab 1406500936 and clearing the viewport override restored one scaled capture. The live DOM measured 390x844, while the returned JPEG is 270x582. Subsequent gesture/capture control remains unreliable, so this is partial keyboard/responsive evidence, not completed visual acceptance. Original b2b captures were also JPEG bytes; filenames are corrected to .jpg without changing image bytes. The active replacement tab remains signed in as scoped PM.

CI for b2b8b3802314 passed all seven jobs, including QA, shuffled units, isolated RLS, restore drill and worker/script suites. The compact-layout commit has separate CI pending.

Capture recovered fully after explicitly restoring original desktop dimensions, then verifying 390x844 in the DOM before the next capture. New acdf images now include full 2648x1268 desktop and 390x844 mobile captures of compact controls and warning disclosures. Keyboard Enter opened and closed the grouped warning; all 16 dates remained in DOM, with visible mobile focus and wrapped text. Console remained empty. This supersedes the scaled-capture limitation for these controls, while interrupted-save, final artifact and full end-to-end acceptance remain outstanding. Screenshots do not establish human usability. Current browser is switching from PM to finance for the six synthetic payroll rows (60 hours/USD 600); no labor import has yet been saved.

### Restore port collision and approved payroll checkpoint

Compact-layout CI passed QA, shuffled tests, workers and isolated RLS. Its separate restore run 34290671376 failed because fixed target port 57322 was occupied. The drill now selects unused Linux port blocks outside the kernel outbound connection range, excluding source ports immediately before starting its target. It never stops a listener. Three focused tests pass; restore-port-controls.json retains one harmless survivor and four intended failures. This is preflight protection, not an atomic reservation against unrelated service starts.

The complete local drill then passed database rows, evidence custody, storage byte hashes, relationships and live RLS, exiting zero. It used only named temporary projects openplan-restore-source-4097501 and openplan-restore-target-4097501, and neither remained after cleanup. The existing M11 stacks and other sessions' services were unchanged. Local log: /tmp/openplan-m11-port-safe-restore.log. New remote CI remains required after this checkpoint.

Finance imported synthetic-staff-time.csv through the actual file chooser and mapped seven headers. Original SHA256 7aa0fb699009be35fd9dcbbd1075f44ec645654b02dec95c06a910d956a04280 and six source row identifiers are retained. Each 10-hour/USD 100 draft was separately approved as version 2. A source-identity check caught reordered rows before editing the wrong record. Independent SQL confirms seven current approved costs, USD 625, 60 hours, six physical time links and 13 retained versions. Browser task/staff/deliverable totals agree: labor USD 600/60 hours reaches the named staff and deliverable; the earlier USD 25 expense stays explicitly unattributed to a deliverable. USD 175 of the approved internal cost budget remains. Forecast 5 is visibly stale. The source amounts are stipulated synthetic recorded costs, not employee pay rates or legal overtime evidence. Staff visibility of finance-imported own time is the next check.

### Own imported time and complete contract reads

The real staff journey found an empty source register despite six payroll rows attributed to that staff member. Migration 20260924000001 adds an explicit nonfinancial projection for finance-entered own labor. Staff see stable source IDs, dates, current hours, review status and task/deliverable allocation, with generic finance contact text. Source file access, finance notes, valuation amounts and rates remain withheld. Finance-owned drafts cannot be corrected by staff; the existing database command refusal remains active. Own staff drafts retain their original input. Source-register ordering is stable by date/key/identity and does not reorder retained history.

The new live test failed before migration for the observed missing own draft. After migration, 25 focused live/UI checks passed and the populated upgrade stack passed 20 live tests. A targeted missing-attribution mutation initially survived because SQL NULL comparisons failed to reject missing fields. This was reported, the assertions now use IS DISTINCT FROM, and all nine controls pass with one harmless survivor and eight intended failures. Read controls cannot establish unrestricted privacy of user-written shared review comments; valuation assumptions must remain in their separate private field. The current browser already reads six approved own rows without finance cost text after the database update, but final date/order/mobile acceptance requires the new served build.

Cash summary and weekly project management now reuse readEveryPage, advance by returned rows and stop only at an empty page. They withhold complete totals/register claims on read failure. Thirteen focused UI/pagination checks passed, including a server cap smaller than the requested page and a later read failure. Six controls contain one harmless survivor and five intended failures for short-page termination, skipped offsets, partial claims and workspace scope. As with other offset reads, concurrent insertion/deletion across pages remains a separate snapshot-consistency boundary.

Synthetic staff completion update 56efc191-b1e3-4ee0-aeb9-cee3bfa4de4b, version 5, explicitly reports zero remaining hours and September 8 actual finish. It does not infer progress from incurred cost. The designated PM reaches it through My Work. PM review, deliverable events and closeout are still pending.

PM accepted staff completion as work-update version 6, with zero remaining production cost and gross billing. The source-attribution appendix is stipulated to be within the 60 reported hours. Two original files were uploaded through Documents: fe997388-cad2-4656-bfe3-c2ff452212c4 / SHA256 cdac7e72043d023b059baf3e57c52579a4c26c3fd311ec8c3616bf82adbc8c00 and 69d698fe-208f-4419-b18c-36847fa5cf02 / SHA256 6ec68214a934c70093bb5e8449e63cb3592e582810433e8d21b2707f76cd83ba. Actual PM navigation through project A and its contract recorded submission 1, return 2, resubmission 3 and acceptance 4, dated September 8. Independent SQL confirms the first two events retain the first file and the last two retain the corrected file. No actual agency authority is claimed. The corrected source explicitly retains an open October 15 records-audit obligation.

The e3fede116346 production build passed and is identified in the owned worktree. The owned document worker was gracefully restarted from this checkout to avoid cached pre-format-6 report code; other workers were untouched. A subsequent screenshot timeout required replacing only the owned acceptance tab. DOM and SQL prove saved events; desktop and mobile capture still need completion.

### Agency closeout and exported-file reconstruction

Finance previewed closeout with USD 625 incurred, USD 800 approved cost, USD 175 underspend, accepted work, settled finances and one open records obligation due October 15. SQL confirmed no closeout existed after preview. With the prepared decision still visible, only the owned server PID 74235 was stopped. The attempted save showed Failed to fetch and retained the original retry control and form values; no closeout existed. The same e3fede11 build was restarted and reidentified. Clicking Retry retained request queued the real worker and produced one closed revision, b40809c2-826d-429d-9dcf-eaf87c7513da, package format 2, content SHA256 4ee477076ff7863ed4e987fd624692de13d50f50422d0ca4d38db37ac960cb67. This is pre-commit interruption recovery; it does not by itself prove every ambiguous post-commit disconnect.

Browser downloads produced closeout JSON and CSV in ~/Downloads. verify-m11-agency-closeout.py independently reconstructs current source versions, USD 625/60 hours, USD 175 underspend, 25-24-2+1=0 supplier balance, distinct hold/releases, task/staff/deliverable and external-posting attribution, the corrected accepted file and continuing obligation. It reproduces PostgreSQL JSONB content serialization independently and verifies the retained content hash. The 25-column CSV has 59 records; historical versions/matches are not added as costs. Five controls include one harmless JSON-formatting survivor and four intended failures for altered cost, missing obligation, wrong CSV source version and changed hash. Receipt: agency-closeout-reconstruction.json. This is engineering reconstruction, not independent human finance acceptance.

Snapshot b54a3c9a-b9ad-40a7-887c-98432928fcfa was issued through the UI, and the restarted document worker produced downloaded PDF 35c00b72-7970-49d4-ac04-e9ea14bdf50c and XLSX 38f6f973-44ad-4038-8544-5c3052cc6d52. The PDF has 123 pages, retaining full histories and wide-record appendices; the workbook has 44 sheets. Inspected PDF pages 2–3 have readable tables without clipping. Export inspection found two material gaps: opening cost rollups label legacy payment/credit amounts as zero rather than using documented settlement; received-file identifiers have no checksums in the handoff. Deliverable export also labels a storage reference as Retained bytes. These require a new snapshot/package format, preserving the issued format-6 report and format-2 closeout unchanged. Full artifact inspection and workbook visual inspection remain incomplete.

Desktop capture recovered at native 2616x1226 after clearing the viewport override. e3fe-acceptance-desktop.jpg and e3fe-acceptance-history-desktop.jpg show the entry form and all four retained events. At 390x844, DOM confirms document width 390 and the accepted version is reachable, but repeated screenshot timeouts leave that visual acceptance open. CUA scroll also timed out; clicking the observed accepted-version heading successfully brought the history into view. Use the existing selected browser and owned tab. The viewport was explicitly restored to 2616x1226 afterward.

Finance then recorded reopening revision 2 through the UI, pointing to the first closeout. Independent SQL confirms revision 1's hash is unchanged. Reopening copy currently prints false acceptance/settlement claims despite making no new assessment, and its new form starts with no carried obligations. Correct that copy and carry forward prior open obligations before another closeout; the previous package already retains the obligation.

### Export receipts and continuing obligations (September 8, later checkpoint)

The downloaded agency package reconstructed exactly (625 incurred, 175 underspend,
25 gross less 24 payments less 2 credits plus 1 refund = zero open), but its format 6
management report put legacy zero payment columns ahead of the actual settlement.
New snapshot format 7 presents documented invoice balances first and removes those
misleading legacy cash columns from cost rollups. New closeout package format 3
retains received-original filename, type, byte count and checksum in the accounting
handoff; missing receipts remain unassessed. Earlier issued package/report formats
retain their prior output. The workbook keeps one accounting handoff row per stable
record, including long evidence. New acceptance tables distinguish storage reference
from the actual retained byte count.

Reopening had also initialized an empty obligations form and presented false new
acceptance/settlement claims. The form now carries the last closed obligations and
explains that reopening makes no new acceptance decision. Both deterministic
calculation and an additive database insert trigger require each prior open
obligation to remain or receive new satisfaction evidence. Duplicate identities
are refused. Historical packages remain unchanged.

Validation: 22 focused calculation/export/download checks, one form check, 17 live
agency/closeout/billing checks on the populated upgrade stack, TypeScript and targeted
lint. The two new live checks first failed on the old behavior for missing receipts
and silently lost obligations. The control harness records 2 harmless survivors and
19 targeted failures in `export-receipt-controls.json`. The populated v0.46 baseline,
both actual versions and physical time retain the identical canonical hash through
migration 20260925000001 (`populated-export-upgrade.json`). New test fixtures initially
reused an invoice number, attempted to update immutable fixture history, and used an
ambiguous SQL column; those fixture errors were corrected using distinct identities
and additive synthetic records. No application history was rewritten.

This checkpoint is source/database evidence. The served build remains e3fede11 until
rebuilt; fresh format 7 PDF/XLSX downloads and browser acceptance remain outstanding.
Controls cannot establish original-file authenticity, human authority, full visual
layout, or independent human finance acceptance. The open retention/dispute overlap
calculation limitation remains for the next correction.

### Retention and dispute overlap correction

Snapshot format 7 no longer subtracts both a retention hold and a dispute from the
balance as if their coverage were known to be disjoint. With overlapping/unallocated
holds, or holds larger than the remaining balance, currently due is unassessed.
Cash, gross balance, retention and disputes remain separately visible. Aging labels
its coverage incomplete. A recorded payment does not imply a hold release and is
accepted with the unresolved position retained; releases beyond documented holds
and refunds beyond documented payments are still refused using numeric checks,
independent of warning wording. Earlier report formats retain their original meaning.

Validation: 27 focused calculation, command, accounting and cash-view checks;
TypeScript and targeted lint; `hold-overlap-controls.json` records one harmless
survivor and six targeted failures. These controls do not prove any particular hold
allocation or external posting. An explicit hold-allocation adapter is not present;
currently due remains unassessed until documented events resolve that uncertainty.
Browser verification of the new labels follows the rebuilt app.

### Reachable participant/accounting work and closed assignments

External consultants previously reached a workspace-membership dead end in My Work.
The new caller-filtered participant view exposes only explicitly shared contract
identity and current own returned-invoice counts. My Work loads it with the caller's
RLS client before its membership branch, and includes it alongside an existing member
queue. No project-wide service-role queue read was added. A consultant's contract page
returns to My Work and omits inaccessible project/register destinations.

Finance now sees unreviewed, unresolved and stale accounting-import comparisons in
its existing contract decision queue. Exact current review/source versions govern the
entry; a prior unresolved review does not resurrect after reconciliation. Remaining-work
reviews join the review section. Failed contract reads now suppress the empty-review
claim; the previous block-source list had omitted contract sources. Closing removes
staff assignments from the active queue without rewriting assignments; reopening
restores them. Narrow caller-bound predicates protect these view joins. The initial
view implementation failed live authenticated reads because it called internal-only
functions; corrected predicates preserve those internal function restrictions.

The full contract-page warning journey also lacked affected-input links although its
isolated warning component test passed. ForecastTable now requires the contract ID;
its forecast and response parents pass it. A full component test exercises the link.

Validation: 45 focused tests pass in shuffled order with CI seed 457120; TypeScript
and targeted lint pass; 14 live queue/closeout tests pass on the named populated upgrade
stack. Migration 20260926000001 preserves the same baseline, two actual versions and
physical-time hash (`populated-queue-upgrade.json`). `work-queue-controls.json` retains
2 harmless survivors and 25 targeted failures. Its initial partial-read control
survived because a failed page discards rows inside readEveryPage, whereas its page
ceiling can return a prefix. The test now exercises that ceiling and catches publishing
the prefix. Controls do not establish visual reachability or notification delivery.

CI b81ada60 passed QA, RLS and restore but failed shuffled tests: the new cash test was
outside the describe block containing its setup. Running that test alone reproduced
its uninitialized query mock; moving it into the setup scope fixes both isolation and
the exact failed seed. A full new CI result remains required.

### Browser interruption and retained revision 3

On the identified b81ada607d86 build, forecast 6 retained zero remaining production
cost and 625 actual-plus-remaining cost. Its scheduled external-review dates remain
October 2-3, separate from September 1-8 reported production actuals and the retained
September 8 deliverable acceptance; actual outside-review dates are not yet an editable
schedule input. Revision 3 (`ad939fa2-30a0-4e7b-b878-507e6f409cc0`) closed with package
format 3, 625 incurred, 175 underspend, zero balance and the unchanged open records
obligation. The 390px form carried the obligation and its Enter key submitted the
revision. `revised-closeout-custody.json` proves revision 1's original hash and the
obligation were retained. This is synthetic engineering evidence only.

390px DOM width was 390 with no page overflow, but screenshot commands timed out.
A subsequent UI download call timed out and reset the browser kernel. Fresh setup
then repeatedly failed because the trusted browser worker imports the removed path
`browser/26.814.41957/scripts/browser-service.mjs`; installed plugin files are now
under `browser/26.901.51231`. One explicit kernel reset did not repair it. No plugin,
native-host, browser-profile or browser-service files were modified. Browser acceptance
needs a refreshed plugin/runtime connection. The owned tab is 1406501167, last at task
A Closeout, synthetic finance signed in; its viewport remains emulated 390x844 because
control failed before it could be reset. Do not attach old stalled tabs 1406500898/0901.
New package UI downloads did not complete. Main and the demo were not changed.

An independent **unissued local renderer check** used the actual retained synthetic
state, without creating a snapshot or simulating a UI download. Its format 7 PDF and
XLSX were rendered, and the early invoice/closeout tables visibly show 24 payments,
zero balance, 625 incurred, 175 underspend and one obligation. The PDF is 133 pages
including history; the spreadsheet was inspected through LibreOffice's read-only PDF
render because the artifact runtime loader is unavailable. These temporary renders
are not issued reports or browser-delivery evidence. Full source-receipt, accounting
handoff and long-cell inspection remains open, including preservation of numeric-looking
external identifiers by the existing generic workbook conversion.

### Typed accounting exports and caller view correction

Found an export defect: the generic workbook conversion changed numeric-looking invoice and external source identifiers (`00123.00`) into numbers. New format 7 converts explicit amount/hour columns only, keeps revision/count cells integral, retains one accounting row per stable record, and links long notes to a readable text-parts sheet with repeated record and field identities. Original full cell values remain retained. Older issued formats are unchanged. Unissued local format-7 PDF (133 pages) and XLSX (48 sheets) were rendered from the existing synthetic agency read state; current financial/closeout positions and accounting text were visually inspected through the PDF renderer and LibreOffice. These are local renderer evidence, not newly issued or browser-delivered artifacts. Browser plugin bootstrap still points to a removed module, so revision-3 UI downloads and fresh 390px screenshots remain outstanding.

CI on b81d4795 failed the public-view invoker guard, migration inventory/changelog checks, and copy ledger; RLS and restore workflows passed. Migration 27 puts the consultant view under caller privileges and moves the narrow identity/own-return-count read into a caller-bound function with no actor argument. Anonymous execute is denied. Migration 26 remains historical; 27 is additive. Both owned disposable stacks applied 27. Populated v0.46 baseline, actual and time records remain byte-equivalent under canonical JSON (a6b1bfe272ecc1b77c37730603d9a0267878f7ec5a09bb50a0a1803fa42b31ca).

Validation: 74 focused export/layout/queue/inventory/copy/release tests; six live queue tests; TypeScript and lint passed. Controls: two harmless survivors and ten targeted failures, including identifier coercion, lost text/links, owner-view regression, anonymous execute, foreign rows and another participant's return count. The first budget-type mutation removed both the header and its type mapping and survived through accidental column realignment; narrowing it to the amount-column mapping produced the intended failure. Checks do not establish browser delivery, original evidence authenticity, or human PM/finance acceptance.

### Preview calculation leaves the page thread

Forecast previews now use a disposable browser worker; reviewed forecast requests go directly to the existing durable worker queue. Cancel, navigation and changed input state terminate the preview. Late replies and previews for an earlier state are suppressed. Worker calculation, transport and cloning failures remain visible. The calculation method and retained forecast format are unchanged.

Seven worker/component tests plus the existing layout checks exercise lifecycle and exact results. One harmless comment survived and nine targeted breaks failed. A first cleanup mutation failed the unmount assertion but not the intended input-change assertion because the simulated late response itself terminated the worker; the test now checks termination immediately on input change, before delivering that response. The actual bundled browser-worker source also ran through a Node message bridge: 40 synthetic tasks, 20 people and 180 days produced 144,000 reservation rows in 771 ms, with 68 main-thread heartbeat callbacks and exact equality to the direct calculation. This does not establish browser bootstrap/CSP, maximum-size structured-clone/render behavior or an agency calendar. Browser acceptance remains blocked by the stale plugin module. TypeScript/lint and production build are being checked before this checkpoint is pushed.

### Completed outside reviews and ordered completed-work dates

Completed client, agency and public reviews can now retain explicit actual start/finish dates and the responsible reviewer's evidence in a new immutable schedule version. They remain separate from deliverable acceptance. Completed reviews no longer need a new future availability/duration estimate. Future completion relative to the forecast as-of date, unresolved predecessors or contradictory finish-to-start dates retain reported actuals but withhold a supported finish and explain the conflict. The schedule form and exported review-evidence table expose those inputs. Legacy schedules omit the optional field unchanged.

Found and fixed an additional date defect: zero-remaining staff work completed before the forecast as-of date could show a forecast start after its actual finish. It now uses the reported actual start, or the finish date if start is unknown, while the actual-start column remains unknown when unreported. Migration 28 rejects absent evidence, work-node review actuals, malformed/reversed/future completion dates, and changes the calculation hash revision to v4. Prior forecasts remain retained and become stale. Both owned isolated stacks applied migration 28; populated baseline/actual/time canonical SHA remains a6b1bfe272ecc1b77c37730603d9a0267878f7ec5a09bb50a0a1803fa42b31ca.

Validation: 73 focused calculation, response, worker, export, inventory/release and copy checks; six live database checks; TypeScript and lint passed. Two harmless mutations survived and thirteen targeted breaks failed. The copy guard caught two unnecessary uses of “record”; the new instructions now say “Outside review completed” and “Use dates supplied by the outside reviewer.” Live review checks exercise exact retries, staff refusal, immutable evidence and absence of automatic deliverable acceptance or baseline change. Browser/form rendering and newly issued artifact acceptance remain open; the user's reconnect suggestion was checked with a fresh runtime reset, but the tool still loads the removed 26.814.41957 service module. Production still serves the verified 996bd753 worker checkpoint until this change is rebuilt.

CI 21815c29 is now green across ordinary CI, RLS isolation and restore. The 996bd753 production build, TypeScript and lint passed and it is pushed; ordinary CI remains under observation, while its RLS and restore workflows passed. No release, main merge, human acceptance or M11 completion is declared.
