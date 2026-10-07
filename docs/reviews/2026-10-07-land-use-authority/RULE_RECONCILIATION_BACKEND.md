# Working-draft rule reconciliation backend

Follow-up: [staff review and browser recovery](RULE_RECONCILIATION_UI.md) records
the subsequent UI implementation. This backend record retains its earlier
verification boundary.

October 7, 2026. This implements the command and transaction in the
[reconciliation design](DRAFT_RULE_RECONCILIATION_DESIGN.md). It does not yet add
the workbench action or browser recovery. An older specific-plan draft still
needs that visible workflow before this capability is complete.

## Preserved content and explicit changes

A staff command identifies its actor, workspace, plan, working version, displayed
draft revision and selected-rule hash. The route refuses agent-header writes,
checks browser origin and current write access, and bounds the exact request.
Recovery lookup occurs before consulting the current draft or rules. The native
transaction rechecks membership, locks the plan and version, and retains the
original command and receipt. Changed bytes or actor cannot reuse that command.

The transaction appends blank sections for missing selected requirements. A
policy node with the same key does not substitute for a section. It preserves
existing section identifiers, text, evidence, maps, relationships, actions and
frozen editions. Required and locally defined default keys join the existing
applicability keys, matching new-plan creation. Conditional sections remain
available without becoming applicable automatically. Earlier keys remain intact.
Every section, applicability change, draft-counter change and receipt commits
or rolls back together. This operation supplies space for staff to write. It
does not establish completeness, applicability or legal sufficiency.

Migration `20261016000010_land_use_plan_rule_reconciliation.sql` adds the private
append-only journal and service-only RPC. The migration was tested initially as
`20261016000009`, then renamed without changing its bytes to reserve 9 for the
parent restore-cascade correction. Its SHA-256 is recorded in the controls.
Neither migration is installed by this checkpoint's transaction probes.

## Verification

The [focused suite](rule-reconciliation/focused.log) passes 56 route/store/receipt
cases and seven existing product-direction guard cases. The [native suite](rule-reconciliation/native.log)
passes preservation/rollback and two-session lock cases. It proves plan, current
membership and version locks independently, with empty rules so child writes
cannot conceal a missing explicit lock. The peer's exact synthetic fixtures are
removed afterward. The migration, temporary dblink extension and main-session
fixtures roll back. These are database fixtures, not browser-produced plans.

The [controls](rule-reconciliation/controls.json) retain 63 detected faults and
four passing route/native baseline or harmless cases. All four controlled source
files are restored and their hashes match. Earlier unmatched attempts are
retained by run in the report. A duplicate prepared-hash guard originally masked
the removed route check; a route-local spy now proves the early refusal. Removing
an inherited redundant strict call did not permit unknown fields, so the field
control now actually enables unknown fields. The rejection matcher also retains
Vitest's rejected-promise assertion form. These changes strengthen the probes;
no production refusal was removed to make a check pass.

The [control script](rule-reconciliation/controls.py) requires an owned idle
checkout, explicit mutation opt-in and an isolated database path. It changes
source temporarily, restores exact bytes after every case and retains a report.
It must not run during browser acceptance or another source-editing session.

The earlier plan-kind connection commit appended a follow-up link to
`PLAN_KIND_RULES.md` but left its source hash unchanged. GitHub QA and shuffle
correctly refused that mismatch. The readiness registry now pins the reviewed
appended note; the capability registry pins the resulting readiness JSON. No
readiness grade, review date, release field or legal-source finding changes.
The direction check and its seven tests pass with the existing review reminders.

The [land-use regression](rule-reconciliation/regression.log) passes 608 tests
across 26 suites. Six native suites containing seven cases skip in that ordinary
invocation; the two new native cases pass separately as described above.
TypeScript and changed-file ESLint also pass.

## Installed isolated-stack checkpoint

After integrating parent `418ba38f`, combined commit `37696014` installs migrations
9 and 10 in order on the isolated restore target at API 29821 and database 29822.
The CLI confirms all 380 earlier migrations matched before the two new files
were copied. The [installation record](rule-reconciliation/install.log) names
both applied migrations. No demo, hosted or production database changes.

The [installed native suite](rule-reconciliation/installed-native.log) passes all
13 cases across seven suites without migration probe flags. This joins context,
draft revision, freeze, creation, cancellation, restored cascade ordering and
reconciliation behavior. The [catalog check](rule-reconciliation/installed-catalog.txt)
confirms both migration versions and service-only reconciliation execution.
All 285 application tables retain RLS; the separate PostGIS spatial-reference
table remains an extension-owned advisor finding.

The [security advisor comparison](rule-reconciliation/advisor-comparison.json)
retains the same eight warnings and one error before and after. No clean security
audit is claimed. The full archive restore drill is still a separate GitHub gate.
Migration probes that CREATE these installed objects must not run again on this
stack. Installed native fixtures without probe flags remain repeatable.

## Identified build and T3 attempt

The [production build](rule-reconciliation/build-status.json) passes on unchanged
`d7c9215c` with webpack. The owned build service has an 8 GiB memory ceiling and
peaks at 6,674,649,088 bytes. No other heavy local check runs alongside it.
The [server identity](rule-reconciliation/server-identity.json) ties port 3498,
PID 3667600, its working directory and health response to that commit. Health
explicitly leaves the database unchecked; the installed native suite is separate.

The [T3 attempt](rule-reconciliation/t3-attempt.json) reaches the landing page at
1280 by 800 and 390 by 844, then follows the sign-in link. DOM inspection confirms
the 390px viewport, document scroll width 375 and sign-in fields. The role-locator
attempt fails; the text locator succeeds. Snapshot requests fail at desktop,
text-only desktop, mobile landing and mobile sign-in with the same preview-client
error. There is no saved screenshot or visual acceptance. Console, authenticated
workflow and downloaded-artifact review remain unverified. No alternative browser
is used or requested.

The owned server stops before further source edits. Its Next.js process remains
after the listener closes during shutdown; the owner confirms its exact working
directory and service group before terminating that residual process. Port 3498
is clear. BCA, engagement and demo processes remain untouched.

## Remaining boundary

The browser recovery library, explicit workbench action, unsaved-edit protection
and earlier-section presentation remain unfinished. Authenticated concurrent HTTP commands, identified desktop/390px evidence,
console and downloaded-artifact review remain open. The user requires T3 preview
only. Native tests and an available preview do not establish rendered acceptance.
Parent PR126's complete corrected archive restore drill also remains pending.
This checkpoint is not an M1 completion, practitioner acceptance or V1 release.
