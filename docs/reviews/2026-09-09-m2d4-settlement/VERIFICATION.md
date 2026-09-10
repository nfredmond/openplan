# M2d.4 saved reconciliation and carryover — engineering evidence

Status: bounded implementation verified locally; unreleased. This does not complete M2d.4. GitHub results must be read against the pushed main commit separately from these local checks.

## Start gate and ownership

Work began only after main `8015a05f15028387e56fcbe952639c23c7f01d9b` had successful full QA and shuffled tests in [CI run 34415775590](https://github.com/nfredmond/openplan/actions/runs/34415775590), plus [RLS isolation run 34415775596](https://github.com/nfredmond/openplan/actions/runs/34415775596). Isolated branch: `work/m2d4-settlement`; checkout `/home/nathaniel/.local/state/openplan/m2d4-settlement-2026-09-09`. No draft PR. The pending reminder constraint is untouched.

## What works

Programs → Administer a reporting period → Saved reconciliation. Owner/admin access only, with executable refusal for unregistered agent commands. A saved revision retains the management report, original baseline, current claims and earlier claim evidence, exact receipt sources, and adopted successor baselines with their authority evidence. Locked source hashes and command versions reject stale input. Exact retries recover one command; earlier draft, approval and reopening content stays immutable.

Receipts allocate current approved payments in the source currency using exact cents and a combined physical-payment ceiling. Claims stay with the old cycle. Refund due and outstanding commitments begin unknown; approval requires explicit assessment and evidence. Carryover maps one work element/fund into one adopted successor element/fund, including overlapping cycles, without creating costs. Competing source programs and successor amendments share the target fund ceiling. Reopening retains the last approved allocation until a replacement is approved. These ceilings do not establish available cash or external authority.

See [operation](../../ops/OWP_CLOSEOUT_RECONCILIATION.md) for the workflow and limits.

## Identified production browser

Application commit `c2ab479f9cb1d4f1f267962ad60284dfb8910a6c`, production webpack build, port 3259. [Build identity](build-identity.txt) matches the isolated checkout. An intentionally wrong expected SHA failed before financial actions. The installed Chrome harness used fresh contexts and real navigation: sign in → dashboard → Programming Cycles → program → Administer a reporting period → Saved reconciliation. At 390px the module picker and Enter reached Programs. Tab moved from the source selector to Reload reconciliation; Enter performed reload. Save, approval and downloads also used keyboard activation.

[Browser results](browser-results.json) retain the exact version counts, source hashes and console inspection. Desktop saved an uncertain command, reloaded, and retried that same request once; it recovered one saved version. Approval version 6 carried 20.00; mobile reopening/correction retained version 6 and approved version 9 at 19.00. The original version downloaded at both widths with SHA256 `dc7e8a7cd61cf2e3bd337f25b02086764ee12147f891f2ac185cc4e318e1ec00`. The source fiscal cycle begins 2026-07-01 and the successor calendar cycle begins 2027-01-01. Both exact baselines remain retained.

The synthetic case keeps a 10.00 claim, 7.00 matched receipt, 3.00 unpaid portion and 15.00 outstanding commitment visible. [Access checks](access-results.json) establish owner GET 200, member 403, anonymous 401 and foreign-workspace owner 404; denied identities cannot POST either. The original approval remains identical, and the three physical ledger entries remain three. [Custody checks](custody-results.json) recompute all nine retained content hashes; changed hashes are detected, and rollback restores identical contents. The database content hash covers canonical content; the browser SHA above covers the downloaded file bytes.

Injected failed history reads hid exports; a successful reload restored them and cleared the error. Console inspection found only the deliberately injected failed save and 503 history responses, with no unexpected warnings/errors. No document-width overflow at either viewport. Native select displays shorten long labels at 390px; the retained JSON contains full titles, dates and identifiers. Practicing-finance usability remains unproved.

[Desktop balance](claim-balance-1440.png) · [Desktop carryover](carryover-details-1440.png) · [390px balance](claim-balance-390.png) · [390px carryover](carryover-details-390.png).

## Checks and their provenance

[QA results](qa-results.json) distinguish commits rather than treating all runs as final-head proof.

- Full QA at `992c7600`: lint, existing dead-code check, 13,449 passing tests, 275 live isolation checks across 40 files, zero production dependency audit findings, and webpack build.
- Shuffled suite at `35249a53`: 13,449 passing tests, seed `957256`. Later changes tightened a SQL reservation test and fixed reload messaging; main CI must rerun the suite on the final pushed commit.
- The browser-discovered message fix at `c2ab479f` has 23 focused passing tests, lint/type checks and a new production build, followed by the successful browser journeys above.
- All 52 worker suites passed; no worker source changed afterward.
- [SQL mutations](sql-mutations.json), [currency/reservation mutations](extra-mutations.json), [UI/API mutations](ui-mutations.json) and [inventory/navigation mutations](guard-mutations.json): four harmless controls survived and 66 targeted failures were detected. These cover roles, direct execution grants, immutable history, current source/command identity, unknown evidence, physical payment limits, currency, chronology, fund ceilings across amendments and reopening, exact retry recovery, private export withdrawal, restored error messaging, and test-inventory reachability.
- [Populated upgrade](upgrade-results.json): the retained disposable upgrade stack at 306 migrations received the exact v0.47.0 reimbursement migration and representative OWP source/claim data inside a transaction, then `20261004000001_work_program_closeout_reconciliation.sql`. Counts and hashes across nine source tables stayed identical. A harmless comment survived; a changed saved program title failed the custody comparison. Each exercise rolled back, retaining the original stack.

The development test database is `supabase_db_m2d3-reimbursement-verification` (API 58821, DB 58822); CLI workdir `/home/nathaniel/.local/state/openplan/m2d4-settlement-verification` points to this checkout's migrations. No demo reset or migration. The separate upgrade transaction used `supabase_db_m11-contract-verification-upgrade` (DB 58722). All identities and authority statements were labelled synthetic. Source preparation, review/adoption, actuals and reports came through existing product routes/RPCs; only test identity setup used fixture inserts.

## Failures found and corrected

Initial full QA found missing inventory/script entries, a new inline editor declaration, plain-language wording and an unrecognized changelog migration reference. The editor is an existing-program reconciliation workspace under the documented R3 rule; no form-debt ceiling or guard was weakened. Database review found currency and successor-amendment allocation gaps, then the premature release of an approved allocation during reopening. Targeted tests and mutations now cover them.

The first browser injection reloaded before the intercepted request had settled; the harness now waits for an enabled retry. A later strict label-text query included an existing textarea value; the harness now uses its correct, independently inspected accessible textbox name. Neither was an application defect. The browser then found a real stale error after successful history recovery; the regression failed on the old code and passes after the fix. Raw local logs, protected fixture logins and downloaded private JSON stay in `/home/nathaniel/.local/state/openplan/m2d4-settlement-evidence-2026-09-09` or `/tmp`, not in the repository.

## Limits and next M2d.4 work

This is a reconciliation approval record, not period closure, general-ledger posting, funder acceptance or permission to spend. It supports one successor/fund mapping per work element; split/merged and multiple-fund carryover are unfinished. Refund due is assessed but not matched to outbound refunds. Later work and unrecorded external obligations may exist. Interim reports stay explicitly interim. Human register and authority evidence remains the responsible reviewer's assertion; synthetic tests do not establish genuine agency authority, independent reconstruction, usefulness or completeness. Prescribed agency forms and automatic reminders remain unproved.

Next: actual period closure and authorized reopening with source-write guards, richer carryover mappings, refund payment matching and independent reconstruction/restore evidence. The roadmap remains the sole queue; provider choice, engagement, capital delivery, RTP updates and separate model validation retain their early obligations.

SQL tests cannot see browser reachability or unseen external records. HTTP mocks cannot establish live RLS; live RLS cannot establish usability. Hashes establish identity, not truth of evidence. The browser case does not prove large-agency history performance or practicing-PM/finance acceptance. No agency outcome, capability rating or model claim is promoted.
