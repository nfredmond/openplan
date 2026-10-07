# Working-plan checklist review and recovery

October 7, 2026. This continues the [reconciliation design](DRAFT_RULE_RECONCILIATION_DESIGN.md)
and [installed backend](RULE_RECONCILIATION_BACKEND.md). It adds the staff control
and browser recovery. Rendered acceptance remains open.

## Staff behavior

The workbench lists blank sections to add and sections to mark applicable. Staff
must review those exact additions. A different version, revision, rule hash or
list of additions invalidates that review. Earlier keyed and unkeyed sections
remain visible and editable in a working draft. Their text and evidence do not
automatically satisfy a different checklist item. Historical editions remain
read-only.

Before transport, the browser retains exact command bytes under the account,
workspace, plan and command ID. Reading, remounting and importing a request do
not send it. Explicit retry sends the retained bytes and checks the scoped
receipt and response status. A changed or missing browser copy prevents transport.
The control distinguishes confirmed changes, local-copy cleanup and view refresh.
A lost reply keeps the original request. Recovery copies preserve unreadable
originals as well as valid requests; restoring a copy remains a local action.

The workbench blocks new requests, retries and refreshes while context, content,
evidence or named staff forms have unfinished edits. Review disposition and
withdrawal fields participate in that guard. An ordinary form save resets fields
only when they still match the submitted snapshot. Text entered while saving
stays present and dirty. If new edits arrive during reconciliation, confirmation
remains visible and refresh waits for an explicit later action.

The account-switch regression found that a failed storage read could leave the
previous account's recovery list visible. Scope changes now clear that list before
reading the next account. Aborted requests and late file reads cannot acknowledge,
refresh or restore an earlier account's request.

## Verification and fault controls

The [final land-use regression](rule-reconciliation-ui/regression.log) plus the
affected CI guards passes 712 cases across 31 suites. TypeScript, changed-file
ESLint and the product-direction check also pass. Thirteen native cases skip in this ordinary invocation. Those native
cases passed on the installed isolated stack before this UI change; they are
separate database evidence, not browser acceptance.

The [fault report](rule-reconciliation-ui/controls.json) preserves each run,
assertion failure and source-restoration hash. The first run detects 35 faults
and passes its baseline and harmless control. One removed early-abort guard
survives because the later cancellation check still rejects the reply. The test
now also requires that the response body is not read after cancellation. The
follow-up detects that fault and the removed account-list clearing, with passing
baseline and harmless cases. Two further faults remove the review disposition and withdrawal field names;
both fail the unsaved-retry assertions. Across the three runs, 39 distinct faults
are detected and six baseline or harmless cases pass. No production refusal was
weakened to obtain green.
The original account-switch failure is retained alongside the report.

The scripts require explicit opt-in and an owned idle checkout. They temporarily
change source files and restore their exact bytes. They do not access a database
or rerun installed migrations. Do not run them during browser acceptance.

GitHub QA on `eba86de3` also found a missing product caller, a stale relation/table
count and four undocumented journal columns. The recovery library now calls the
endpoint. Inventory counts reflect the installed 285 application tables and
14 views. The four column entries identify exact-byte SQL replay or retained
audit data. No route exception, schema omission or policy relaxation is added.

The React review checks explicit mutation handlers, scope cleanup, effect listener
cleanup, labeled controls, bounded imports and preservation of newer edits. The
new control uses the existing component system and adds no dependency. Mounted
checks cannot establish focus order, keyboard usability, contrast or mobile layout.

## Boundaries

Mounted tests use synthetic plans and mocked transport. They do not prove live
row-level security, HTTP concurrency, storage behavior in every browser, a usable
downloaded recovery file, or a practicing planner's acceptance. Form custody
tracks named form fields and the existing controlled context/content drafts.
Future fields outside those structures must join the guard explicitly. Page
closure or navigation recovery for all ordinary staff forms is not implemented
by this change.

Current-source build, authenticated HTTP concurrency, desktop and 390px T3
navigation, console review and downloaded-file checks remain separate work.
The user requires T3 preview only. Prior snapshot failures and an available
preview are not rendered acceptance. GitHub checks must pass on the pushed
checkpoint before any merge. This is not a release or completion of M1 or V1.
