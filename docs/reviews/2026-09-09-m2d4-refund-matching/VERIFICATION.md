# M2d.4 refund payment matching

Status: local engineering acceptance complete, unreleased. Final main CI is inspected separately on the pushed commit; this record does not declare a release tag.

This increment extends Saved reconciliation with explicit outgoing refund matches to existing approved payment entries. Exact cents preserve partial and excess disbursements independently from incoming claim receipts. Unknown assessments remain unknown. A reviewer identifies the recipient, direction and payment reference in the evidence; OpenPlan does not verify a bank transfer.

An additive migration validates source identity, currency, approved status, positive amounts, evidence, direction and physical payment limits. Other baselines retain their latest approved reservations through drafts and reopening. Comparing physical entry identity prevents corrected versions from bypassing those limits. Closed periods protect matched late refunds. Older approvals, JSON bytes and exact retry payloads remain unchanged.

The named disposable database is `supabase_db_m2d3-reimbursement-verification`, accessed through `m2d4-refund-matching-verification`. The independent upgrade stack is `supabase_db_m11-contract-verification-upgrade`; upgrade probes run inside rolled-back transactions and preserve its original 306 migrations.

Full M2d.4 remains open. Split/merged multiple-fund carryover, independent two-cycle reconstruction and exact restore, practicing-finance usefulness, bank verification and prescribed agency forms require further evidence. The pending reminder constraint change is untouched. Provider choice, engagement, capital delivery, RTP updates and separate model validation retain their roadmap obligations.

## Verification

The named disposable stack has 310 migrations. The final full QA run at `f1d13f4ffdf7e6999df1d0897d21ece63fd4fe52` passed lint, dead-code enforcement, 13,448 ordinary tests, 305 live database tests, production dependency audit with zero vulnerabilities, and a webpack production build. Its explicit process exit was zero. Shuffled tests also passed, with 283 intentional live/environment skips. The final run exited zero in 290.97 seconds. The final main CI also runs shuffled tests, isolated RLS, upgrade checks and worker/modeling/ops Python suites. Worker sources are unchanged. The pushed-commit result is a separate post-push check, not inferred from local success.

Fourteen new live cases cover partial refund retention, exact retries, immutable correction history, invalid or unapproved sources, cents, evidence, same-payment direction conflicts, cross-baseline reservations through reopening and corrected payment versions, and closure of a payment dated after the closed span. Unit checks cover unknown/partial/excess balances, legacy exact-payload identity and UI selection, removal and source reference. Existing role, private-history, action-refusal, concurrency and shared-cost tests remain applicable and run in their existing suites.

The SQL mutation control survived and 14 targeted changes failed for the expected boundaries. The UI/schema control survived and 10 targeted changes failed, including a wrong visible payment reference. One initial SQL mutation removed only an explicit null-source check and survived because currency and amount validation still refused missing sources. The revised mutation breaks the source lookup itself and is detected. The malformed-list mutation produces PostgreSQL's scalar-array error instead of the intended validation message; it proves the error boundary, not that this removal would save bad data.

The browser harness initially inspected a button's own disabled property and missed a disabled parent fieldset. Mobile then sent a stale request, which the application refused with 409. The wait now uses the native disabled state. A separate real-Chrome harmless control and targeted broken wait establish that distinction. The first cross-baseline fixture also failed earlier reimbursement completeness/reservation checks; the final fixture uses a separately incurred later-period cost through product writers, without weakening those checks.

The independent upgrade check retained exact row counts and JSON checksums across 12 tables, including two approved/draft reconciliation rows, one closed-period decision, reports, claims, source allocations and both baselines. A harmless change preserved custody; changing a saved program title failed. Both modified database function bodies match the migration after all rolled-back mutations.

## Boundaries these checks cannot establish

Synthetic identities, costs and authority notes prove engineering behavior. They do not establish bank settlement, actual reviewer authority, agency usefulness or prescribed-form acceptance. Matching is scoped to existing physical OWP entry identity; distinct manually entered source keys for the same external transfer require human reconciliation. Management payment totals remain gross amounts. The guards do not freeze every upstream contract or external accounting system, and the tests do not establish production-scale performance or an independent two-cycle restore. No reminder, provider, modeling or release claim was promoted.

## Identified browser and retained files

The final production build is `f1d13f4ffdf7e6999df1d0897d21ece63fd4fe52`, served from the owned refund-matching checkout at `127.0.0.1:3263`. The build identity script matched. An all-zero expected identity failed before financial navigation or writes. No build ran concurrently with acceptance.

Both 1440×1000 and 390×844 journeys entered through the home page, sign-in, dashboard, Programming Cycles, the selected program, reporting administration and Saved reconciliation. The mobile module picker and reconciliation reload, saves, approvals and JSON downloads were exercised with keyboard input. The synthetic outgoing payment was created through the existing authenticated actual-work producer; its matching and correction used the visible UI.

The retained claim requests 10.00 and has 7.00 in matched receipts, leaving 3.00 unpaid. A separate assessed refund of 6.00 first matches 4.00 of an existing 5.00 outgoing payment, then is corrected to 5.00. Remaining refund changes from 2.00 to 1.00. The original refund approval is version 43 and its correction is version 46. Both widths downloaded the original JSON with SHA256 `fe54eba2950d426cab9a5dad373656e15bd8c3d23984c21fb956b99244c03d4c`; the corrected JSON has SHA256 `6295b5b4274ff0d3c971f04a69000b12c783c242cce6a8b5fb5ce0084525ea3f`. The older pre-refund approval and original closure also remain unchanged. All 46 reconciliation content/source hashes match their retained JSON. Downloads and login fixtures stay local; the repository retains checksum summaries and synthetic screenshots.

A save response was lost after the server committed it. Reload and exact retry created no additional reconciliation. Reusing an incoming receipt as a refund returned 400. Closing the accounting period protected the matched September refund despite the period ending in August; attempted correction returned 409 until authorized reopening. The four physical entries remain one labor cost, one commitment and two payments, with incurred cost still 12.35. Matching creates no additional expense.

Owner access succeeded. Anonymous, member and foreign-workspace reads/writes returned 401, 403 and 404 respectively; responses retain private no-store caching. The console contained only the deliberately injected failed request on desktop and no errors or warnings at 390px. Inspected screenshots show the full payment reference wrapping beneath the clipped native selector, usable controls and no horizontal page overflow.

- [Desktop refund reconciliation](refund-matching-1440.png)
- [390px balance and payment reference](refund-balance-390.png)
- [390px matching controls and evidence](refund-reference-390.png)

The next M2d.4 increment is split/merged, multiple-fund successor carryover, followed by independent two-cycle reconstruction and exact restore. Practicing-finance acceptance remains separate. Other early roadmap obligations remain in the active queue.
