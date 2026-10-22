# Per-row JSON precision precedes aggregate cent arithmetic

This is inspected source, not native catalog or HTTP acceptance. SQL19 returns
JSON numbers for money, not decimal strings. Exact-money helpers cannot recover
digits that JavaScript JSON.parse has already rounded. Keep that distinction
even if later helper arithmetic passes.

| Source | Declared storage | SQL19 JSON expression | Maximum source cents |
|---|---|---|---|
| projects.budget_amount | nullable NUMERIC(14,2), nonnegative check | jsonb_build_object('budget_amount', p.budget_amount) | 99999999999999 |
| project_deliverables.budget_amount | nullable NUMERIC(14,2), nonnegative check | fixed projection, to_jsonb(r) inside jsonb_agg | 99999999999999 |
| project_spend_entries.amount | NOT NULL NUMERIC(14,2), nonnegative check | fixed projection, to_jsonb(r) inside jsonb_agg | 99999999999999 |
| client_invoice_line_items.amount | NOT NULL NUMERIC(14,2), nonnegative check | jsonb_build_object('amount', l.amount) in nested jsonb_agg | 99999999999999 |
| project_deliverables.percent_complete | nullable NUMERIC(5,2), 0–100 check | fixed projection, to_jsonb(r) | progress, not money |

Definitions come from migrations 20260727000012, 20260727000010 and SQL19.
Invoice header totals are not projected into SQL19. SQL19 aggregates arrays,
not money sums. Its numeric JSON leaves remain per-row values. The source
maximum has 14 significant decimal digits and integer cents below
Number.MAX_SAFE_INTEGER (9007199254740991). This bounds a potential JSON hazard;
it is not a measured native JSON/Supabase round-trip result.

Prepare 0.00, 0.01, 19999.99 and 999999999999.99 native records for EVERY money
column, preserving optional null separately. DESIGN's separate rolled-back
variants cover these boundaries; the generator supplies ordinary and maximum-row
cases. Capture stored amount::text, raw native JSON tokens, actual Supabase parsed
values/types, JavaScript shortest decimal spellings and production-loader output.
Reconstruct cents independently from those stages and compare to literal cents
without passing the reference through a Number first.

Literal 90071992547409.92 has 9007199254740992 cents, beyond safe integer cents.
It exceeds every declared NUMERIC(14,2) money column here, as does adjacent
90071992547409.91. A later native savepoint must retain explicit 22003 typmod
refusal for each column, not claim accepted native exposure. No source-valid
per-row money record in these inspected typmods crosses that boundary. If the
allocated catalog has a wider typmod, stop and record source/catalog drift before
choosing an oracle. Do not widen types, cast numbers to strings in SQL19 or disable
constraints to manufacture a native counterexample.

Aggregate totals can exceed that cent boundary without any invalid stored row.
The 101/1001 maximum-row cases test downstream summation, representation and
serialization separately. Aggregate decimal strings are expected outputs of the
approved future money builder, not values emitted by SQL19's native JSON.
Frozen f520 remains historical. R2 explicitly binds the reviewed current
d0d12/app44e638d6 source in source-pins.json, without importing application
source or claiming native acceptance from root's joined-check receipt.

Later ordinary HTTP capture must use actual Supabase createClient/rpc with a
narrow capture fetch. Clone the Response and save body bytes, length/hash and
credential-free headers before the SDK parses the original. Preserve the SDK
result and a separate JSON.parse of those same retained bytes, then feed the
actual SDK result through the pinned production loader. Enforce the byte bound
before body allocation grows unbounded. Do not replace the SDK's real parse with
Python Decimal, supplied numeric strings or a reserialized response and call that
native transport acceptance. Exact-money helpers cannot reverse an earlier
JSON parsing loss. Native origin and any defect remain unproved here.
