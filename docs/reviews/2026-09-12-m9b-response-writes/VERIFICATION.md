# Transaction prototype evidence and open joins

response-write-transaction.sql is a prototype under this review, not an applied
migration. No route or UI calls it. Do not treat these database probes as an
implemented user workflow or promote the SQL before completing its missing joins.

prove-transaction.py ran the schema and probes in separate rolled-back transactions
on only supabase_db_openplan-restore-target-2026091050. The retained synthetic
campaign belongs to this thread's browser account. Each probe creates temporary
response/receipt records; the original campaign's existing response is untouched.
The final catalog check confirmed the prototype receipt table was absent.

The baseline covers create/correct/remove, identical request replay, refusal of a
changed payload with the same request ID, refusal of a stale update, strictly
advancing versions, retained originals and immutable completed receipts. One
harmless comment survived; four intended mutations failed for their named reason:
accepting stale versions, accepting changed retries, regressing timestamps and
allowing a completed receipt to change. See transaction-mutations.json.

The initial receipt guard rejected its own legitimate finalization because a
before-update trigger sees the generated digest before recomputation. Comparing
only the immutable input fields fixes this; the digest is still generated from
the immutable payload. The next probe reproduced the existing now()-based timestamp
problem: two writes in a transaction shared the same time and the stale editor
was accepted. The late response timestamp trigger now advances with clock time
and a one-microsecond lower bound. Initial failed logs and source hashes remain.

These probes do not yet establish direct-write refusal, actor/role/tenant isolation,
concurrent requests in separate connections, automatic source withdrawals,
publication/withdrawal races, reason display in history, receipt privacy under
revocation, durable notification outcomes, or browser recovery. Those are required
before this can be an installable migration and a user-visible increment. The
existing public-copy guard, immutable history and pending reminder constraint
remain unchanged in the applied database. No email was sent by these probes.
