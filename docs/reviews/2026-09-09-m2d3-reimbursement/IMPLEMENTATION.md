# M2d.3 reporting and reimbursement engineering candidate

September 9, 2026. The implementation is pushed in [draft PR #110](https://github.com/nfredmond/openplan/pull/110). Source began at main `e3efcb6e`; application/export code is `b6815523ee5d`. Work occurred in the isolated `work/m2d3-reimbursement` checkout at `/home/nathaniel/.local/state/openplan/m2d3-reimbursement-2026-09-09`. Main, its running browser instance, the demo and the M11 acceptance environment were not changed. No tag or release is declared.

## Result and acceptance boundary

A synthetic OWP cycle connects approved staff effort and an existing shared M11 contract expense to reviewed eligibility, funding/match shares, dated progress, remaining-work estimates and retained deliverable evidence. Saving, reviewing, recording submission, return, correction, resubmission and acceptance produces eight immutable command events. The corrected request replaces the original request.

| Retained fact | Original | Corrected |
| --- | ---: | ---: |
| Approved staff cost | 12.35 | 12.35 |
| Approved shared contract expense | 25.00 | 25.00 |
| Total incurred source cost | 37.35 | 37.35 |
| Eligible cost | 37.35 | 36.35 |
| Reimbursement requested | 30.00 | 29.00 |
| Match | 7.35 | 7.35 |
| Physical contract spending entries | 1 | 1 |
| Source reservations | 2 | 2 |

The full local QA gate, isolated database suite, worker suites, mutation controls and browser state transitions pass. **The later shared-cost browser downloads remain unconfirmed.** Its four exports exist in private Documents custody and were independently inspected from checksum-verified worker artifacts. The earlier staff-only cycle delivered all four PDF/XLSX files through Chrome. These are separate observations, not interchangeable download evidence. The PR remains a development candidate.

M11 human acceptance and reminder approval remain open and separate. Actual authority, cost eligibility, external receipt authenticity, agency-specific prescribed forms and practitioner usefulness have not been established by synthetic tests. M2d.4 and full OWP administration remain open.

## Implementation and custody

The new reimbursement panel extends the existing work-program reporting page and issued period reports. `report_kind` keeps reimbursement packets out of management correction ancestry and management report lists. Existing private Documents exports, worker leases, immutable file identities and storage access apply to both report kinds. Document titles and filenames now identify the reimbursement packet and its packet version.

Owner/admin commands require exact request identities and optimistic versions. The service-only database function checks the authenticated actor's workspace role. Agent writes receive an executable refusal because this workflow is not registered as an approved agent action. HTTP history queries are scoped and paginated; failed reads do not become empty ledgers.

Review requires the current issued management report, an unwithdrawn adopted baseline, authority/form-review evidence, an eligibility decision for every approved incurred source in the period, current source valuations, exact balanced reimbursement/match shares, covering fund dates and dated progress/remaining-work evidence. Shared M11 costs must have the current approved matching contract valuation of the same physical source. The packet freezes that valuation, cost/work links, deliverable records and prior receipt history.

Workspace/program locks and unique physical-source/entry reservations prevent a second packet lineage from reserving a cost. Return keeps the reservation. A correction retains the reporting period, creates another immutable packet and changes the current request pointer. Billing, cash and source costs are not duplicated. Submission and acceptance controls only retain human-entered external evidence; they do not transmit files or record money.

A pending browser save retains its exact command in local storage scoped by user/program. After a lost response or reload, retry returns the original server result. Saved packet history remains available after reopening. Operator steps and explicit limits are in [OWP_REIMBURSEMENT.md](../../ops/OWP_REIMBURSEMENT.md).

## Executed checks

| Check | Observed result | What it cannot establish |
| --- | --- | --- |
| `npm run qa:gate` | Passed: 13,430 tests in 1,228 files; lint/dead-code gate; zero production dependency audit findings; webpack production build | Human usability, live RLS and real agency rules; 221 tests explicitly skipped in this ordinary unit run |
| Final workbook/fixture refinement | Seven focused tests, targeted lint and another production webpack/TypeScript build passed at `b6815523ee5d` | New agency form compatibility; the full gate preceded this small layout/fixture refinement |
| `OPENPLAN_SUPABASE_WORKDIR=.../m2d3-verification npm run test:rls-live` | 250 tests in 39 files passed | Separate-installation restore and actual concurrent maximum workloads |
| `npm run test:workers` | All 52 Python worker suites passed | Scientific accuracy or real model-job performance |
| New reimbursement SQL cases | 11 positive/adverse tests passed: full correction cycle, duplicates, stale OWP/M11 sources, authority, eligibility ceiling, balancing, foreign funds, remaining work, role/privacy/history, management ancestry and shared contract integration | Real financial reconstruction by a practitioner; authenticity of entered evidence |
| New arithmetic/export/HTTP tests | Exact cents, schema limits, duplicate sources/funds, numeric-looking evidence preservation, export reconstruction, authorization, agent refusal, exact query projections and conflict handoff | Browser layout, storage delivery and database enforcement by themselves |
| Mutation controls | [11 SQL controls](sql-controls.json) and [7 TypeScript controls](typescript-controls.json), including one harmless survivor in each harness | Untargeted predicates and all possible input combinations; no perfect-score claim |
| Browser | Two synthetic cycles; desktop and 390px; exact retry after a blocked request/reload; accepted state survives final-build reopening; current console has no warnings/errors | Practitioner usefulness, authentic external receipt, and later shared-cost file delivery |

The disposable stack is `supabase_db_m2d3-reimbursement-verification`, project ID `m2d3-reimbursement-verification`, API 58821, database 58822, explicit workdir `/home/nathaniel/.local/state/openplan/m2d3-verification`. Tests use rollback transactions. The additive migration applied to the existing disposable schema; refined functions were reapplied only there. No database reset, DROP or demo fixture writes occurred.

The existing contract suite had hardcoded M11 workdir assumptions. Its test-only helper now accepts the exact named M2d.3 disposable container alongside previously allowed M11, restore-target and GitHub Actions containers. It rejects the normal local/demo database. The corresponding unit mutation lets a demo database through and is caught. Temporary alias workdirs were not used for the final passing run. Existing per-worker virtual environments are ignored symlinks into the canonical checkout; worker sources/tests run from this branch.

The changed static inventories include all three new RLS tables and their policies. Existing detector controls still exercise unknown policies, missing RLS, hidden inline forms and copy violations; their scope remains static syntax, not live enforcement. Added source-identity metadata is read by SQL and retained in export traces.

## Browser and artifacts

Entry: sign in → dashboard → Programming Cycles → synthetic program → Administer a reporting period → Reimbursement packets. This reaches the existing work-program page, not a hidden feature URL.

The first staff-only cycle changed request 10.00 to 9.00 while retaining cost 12.35 and match 2.35. Chrome delivered original/corrected PDF and XLSX. Independent SHA-256 checks match all four Documents checksums. Redownloading the original PDF after correction yields identical bytes. One network-blocked resubmission survived reload and exact retry as a single event. [Receipt](browser-receipt.json), [return](returned-desktop.png), [pending save](pending-save-390.png), [accepted narrow view](accepted-summary-390.png), [desktop](accepted-desktop.png).

The staff/contract cycle uses program `40fd212d-5862-48d4-901f-a1888b7eeeb9`, packet lineage `6e09b1a1-caae-4693-a35d-c2f180596025`. [Receipt and reconstruction](shared-cycle-receipt.json) retain two source reservations, one physical spending entry, eight events and one approved contract valuation in each version. Original snapshot hash is `a27f53e6d6e484223f001ead299b08319dc8fd9c5be5207aaa43d6bb58133184`; corrected hash is `dc47256d55d0de3740dca207c123eba8fe84426ca9770a8a26c9a1a01c4e2453`. [390px](shared-cycle-390.png) and [desktop](shared-cycle-desktop.png) show the accepted corrected request. Document and viewport widths both measured 390px in the narrow case. The final production build was identified by matching health commit `b6815523ee5d`, process cwd and checkout. Reopening it retained accepted command version 8 and current request 29.00.

All ten pages of the corrected shared-cost PDF were rendered and inspected. Its source costs, eligibility, funding, progress, historical receipts, physical source IDs, approved contract valuation and deliverable record remain readable. The workbook's first sheet was printed through LibreOffice; widening the evidence column removes the earlier unnecessarily narrow layout. Independent Python ZIP/XML plus `Decimal` reconstruction checks both workbooks, sums each request, preserves vintage text `000123.45`, and matches the shared physical spending ID and 25.00 contract valuation. The packet snapshot retains the complete source objects; the financial summary precedes detailed records.

[Original PDF](artifacts/synthetic-shared-v1.pdf), [original XLSX](artifacts/synthetic-shared-v1.xlsx), [corrected PDF](artifacts/synthetic-shared-v2.pdf), [corrected XLSX](artifacts/synthetic-shared-v2.xlsx) are **copies of retained worker artifacts**, not confirmed browser downloads. Packet buttons and the ordinary Documents link did not produce new files in Downloads during the later case. App download authorization was logged without a displayed application error. A request to inspect `chrome://downloads/` was rejected by the browser tool URL policy. No privileged browser command, settings change or alternative browser was used to circumvent that rejection. The cause of the missing downloads remains undetermined. Separate [authenticated HTTP retrieval](http-delivery.json) of all four files returned 200 with exact retained SHA-256 bytes. A [harmless output mutation survived and an incorrect expected checksum failed](http-controls.json) on the successful 200 response. This narrows the unconfirmed boundary to browser saving; HTTP retrieval is not counted as browser delivery.

## Corrections made during verification

- The first dependency symlink used a stale `csv-parse` version and failed existing tests. It was replaced with the existing M11 dependency tree whose lockfile matches this checkout byte-for-byte; no shared dependencies were modified.
- After that change, the own dev cache produced a webpack interop error. Restarting this task's server with its old cache moved to `/tmp` resolved it. An initial cache rename inside the app accidentally put generated files under lint; moving that cache outside the app restored the intended lint scope. Source lint was not weakened.
- Reused report export labels initially said internal management. The new enqueue function now uses reimbursement titles/filenames. Previously retained files are not rewritten.
- The first packet did not retain the matching M11 valuation. Review now checks/fixes that seam and exports its retained identity; a stale-mapping mutation is caught.
- A narrow missing-fund mutation survived because a separate null-date guard caught it. Removing the whole membership/date predicate fails for the intended foreign-fund reason. The first agent-refusal mutation hit an unconfigured mock writer; providing a valid writer makes it fail on the intended 403 assertion. These initial results were not counted as successful controls.
- A short eight-character runtime commit stamp confused the instance checker. The final server uses the full recorded SHA and the checker reports a match. No stamped SHA was used on the earlier dev server.

## Remaining limits and next handoff

This is a private supporting packet, with reviewer-supplied authority, eligibility and prescribed-form references. It has no jurisdiction-specific filing template or automatic legal decision. It covers the retained register, not undiscovered costs. Unassessed remaining effort/cost stays unknown.

Each source belongs to one packet lineage, even when excluded or returned; funds can divide the eligible amount within that lineage. Reservation transfer, independent packets claiming portions of one source, accepted-packet reopening and final closeout are not implemented. The request limits are 3,000 cost decisions, 100 shares per cost and 500KB of command JSON; no maximum-history performance claim is made. Internal report export access/custody is inherited and tested, not rebuilt.

Resolve the later browser file-delivery gap in a supported browser environment without bypassing tool policy before treating this candidate as fully accepted. Inspect exact-head CI independently of push success. GitHub RLS and restore checks passed on code commit `b6815523ee5d`; QA/order-independence and the later evidence-head checks were still running at the final local checkpoint. Do not change the active main checkout or its browser evidence without a safe handoff. Keep M11 human acceptance and reminder approval open. No paid service, external submission, email or real agency authority was involved.
