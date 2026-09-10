# M2d.4 refund payment matching

Status: implementation candidate, unreleased. Final browser, QA and CI evidence pending.

This increment extends Saved reconciliation with explicit outgoing refund matches to existing approved payment entries. Exact cents preserve partial and excess disbursements independently from incoming claim receipts. Unknown assessments remain unknown. A reviewer identifies the recipient, direction and payment reference in the evidence; OpenPlan does not verify a bank transfer.

An additive migration validates source identity, currency, approved status, positive amounts, evidence, direction and physical payment limits. Other baselines retain their latest approved reservations through drafts and reopening. Comparing physical entry identity prevents corrected versions from bypassing those limits. Closed periods protect matched late refunds. Older approvals, JSON bytes and exact retry payloads remain unchanged.

The named disposable database is `supabase_db_m2d3-reimbursement-verification`, accessed through `m2d4-refund-matching-verification`. The independent upgrade stack is `supabase_db_m11-contract-verification-upgrade`; upgrade probes run inside rolled-back transactions and preserve its original 306 migrations.

Full M2d.4 remains open. Split/merged multiple-fund carryover, independent two-cycle reconstruction and exact restore, practicing-finance usefulness, bank verification and prescribed agency forms require further evidence. The pending reminder constraint change is untouched. Provider choice, engagement, capital delivery, RTP updates and separate model validation retain their roadmap obligations.
