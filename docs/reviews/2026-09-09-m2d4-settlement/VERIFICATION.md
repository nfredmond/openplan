# M2d.4 saved reconciliation and carryover — engineering record

Status: implementation under verification, unreleased. No complete M2d.4 claim.

## Start gate and ownership

Started only after main `8015a05f15028387e56fcbe952639c23c7f01d9b` had successful full QA and shuffled tests in CI run `34415775590`, plus RLS isolation run `34415775596`. Work belongs to `work/m2d4-settlement`, isolated checkout `/home/nathaniel/.local/state/openplan/m2d4-settlement-2026-09-09`. The pending reminder constraint is excluded. No PR is planned; verified work lands directly on main.

## Implemented boundary

Existing Programs → Administer a reporting period → Saved reconciliation. Owner/admin only, with explicit executable refusal for unregistered agent commands. A saved revision retains the report, original adopted baseline, current claim and prior claim evidence, exact receipt sources, adopted successor baselines and their authority evidence. Server-locked source hashes and command versions reject stale input. Exact retries recover one command. Earlier draft/approval/reopening content is immutable.

Receipts allocate current approved physical payment amounts, using exact cents and a combined ceiling. Unpaid claims remain in the old cycle. Refund due and outstanding commitments begin unknown; explicit human assessment/evidence is required for approval. Carryover maps work/funds between retained adopted baselines in the same workspace/currency, including overlapping cycles, without creating costs. Source/successor fund ceilings are necessary limits, not evidence of available cash. Competing source cycles and successor amendments share the successor fund ceiling. A human must establish actual carryover authority and fund conditions.

## Verification in progress

- Named disposable database: `supabase_db_m2d3-reimbursement-verification`, API 58821, DB 58822. CLI workdir `/home/nathaniel/.local/state/openplan/m2d4-settlement-verification` points to this checkout's migrations. No reset or demo migration.
- Additive migration `20261004000001_work_program_closeout_reconciliation.sql` applied. Development function refreshes are confined to this disposable stack; final upgrade verification remains pending.
- Focused SQL and HTTP/UI checks exercised. Mutation logs are retained locally pending the final evidence summary.
- Initial browser access identified checkout on 3259. Turbopack could not use the dependency symlink; webpack started successfully. Final production desktop/390px acceptance remains pending.
- Full QA, complete isolation, worker and final main CI remain pending for this increment.

## Limits and what these checks cannot establish

This is a reconciliation approval record, not period closure, general-ledger posting, funder acceptance or permission to spend. It supports one successor/fund mapping per work element; split/merged or multiple-fund carryover is still unfinished. Refund due is assessed but not matched to outbound refund payments. Later work and unrecorded external obligations may exist. Interim reports remain explicitly interim. Human register/authority evidence is asserted by the responsible reviewer; synthetic fixtures do not establish genuine agency authority, usefulness, independent reconstruction or completeness. Prescribed agency forms and automatic reminders remain unproved.

SQL tests cannot see browser reachability or unseen external records. HTTP mocks cannot establish live RLS; live RLS does not establish operator usability. Browser tests use labelled synthetic records and do not replace practicing-PM/finance acceptance. Hashes establish retained-record identity, not truth of supplied evidence. No model claim, provider priority or other roadmap obligation is promoted.
