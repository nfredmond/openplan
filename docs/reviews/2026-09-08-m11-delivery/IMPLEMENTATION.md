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
