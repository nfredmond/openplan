# Controlled snapshot cases use legal draft and replacement records

This R2 supplement governs Stage5. It supersedes any implication in the copied
original design that issued lines can be inserted, edited or deleted. No stage
executes here. The retained lifecycle stays installed for reader and writer.
All IDs below are literal synthetic UUIDs, independent of the main ordinary
fixture. Each case gets its own small project on the NEW exclusive target.

## Zero to nonzero

Use UUID prefix00000000-0000-4000-8000- and these exact 12-digit suffixes.

| Identity | Suffix |
|---|---|
| Project | 000000000101 |
| Deliverable | 000000000102 |
| New spend | 000000000103 |
| Draft parent | 000000000106 |
| Draft line removed | 000000000107 |
| Replacement line | 000000000108 |

Commit the old state: project budget0.00; one deliverable budget0.00/progress0;
no spend; draft106 with line107 amount9.99 and matching draft totals. The old RPC
contains that deliverable, no spend IDs and no eligible invoice/line IDs. Its
stated/delivery budgets and direct cost/billing are zero. Draft line107 is real
but excluded from eligible billing.

W holds ACCESS EXCLUSIVE on project_spend_entries before R starts the production
STABLE RPC. O must observe R blocked by W, including both PIDs and relation lock.
While holding its transaction, W deletes line107 from still-draft106, inserts
line108 amount2.00 under106, reconciles draft totals2.00, then issues106 draft to
sent. W inserts spend103 amount1.00, updates project budget10.00, deliverable
budget5.00/progress25, and commits. No line is written after106 leaves draft.

The new RPC tuple has spend IDs[103], invoice IDs[106], line IDs[108], stated1000
cents, deliverable budget500, spend/actual100, billing200. Old deleted107 is
absent, but never belonged to the old eligible tuple. R's original statement
must return the entire old tuple; a fresh statement must return this entire
new tuple. Capture actual full UUIDs by concatenating the fixed prefix/suffix,
not short suffixes in runtime receipts.

## Two nonzero tuples

Use the same UUID prefix with these separate suffixes: project201, deliverable202,
spend203, old issued invoice204, retained issued line205, draft parent206,
draft line removed207, replacement line208. Each suffix is zero-padded to12 digits.

Old committed tuple: stated10.00, deliverable5.00/progress25, spend203 amount1.00,
issued sent204 with line205 amount2.50 and matching totals. Draft206 has line207
amount9.99 and matching draft totals, excluded from the RPC. Eligible identities
are invoice[204], line[205], spend[203]; cents stated1000, budget500, cost100,
billing250.

After the observed lock wait, W deletes207 while206 is still draft, inserts208
amount3.75, reconciles206 totals3.75, voids204 using status-only UPDATE, and sends206.
W changes spend203 to1.50, project budget20.00, deliverable7.50/progress40, then
commits. Issued line205 remains physically retained under now-void204. The new
eligible identities are invoice[206], line[208], spend[203]; cents stated2000,
budget750, cost150, billing375. Old205 and draft207 are excluded for different
reasons. No issued line is deleted and no issued parent returns to draft.

For membership and project-move variants, retain the exact identity maps above
and record caller-specific old/new visibility first. A-only loses the project
when it moves to B; B-only previously cannot see it; dual A/B sees any retained
A-invoice/B-project inconsistency as the invoice-source failure22000. These are
refusal/error oracles, not fabricated zero tuples. Do not combine a source-failure
case with a successful old/new money oracle. Role changes require fresh ordinary
caller readback and real commit receipts, as the original design specifies.

A native fixture preparer must retain every header/line before/after record,
actual commit acknowledgements, source hash, ACL/catalogs, snapshot/lock evidence
and finally cleanup disposition. A pure text model can compare these literal
IDs, but cannot establish PostgreSQL MVCC. No sleep wrapper, trigger disabling,
service-role reconstruction or source scan replaces the actual STABLE call.
