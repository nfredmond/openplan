# The optional diagnostic reads one failed-target sequence and repairs nothing

PREPARATION ONLY. No native request, admission, manager or socket operation runs.
The proposal generator emits fixed SQL and command metadata only after the pure
window is granted. Root independently reviews and decides whether to execute it.

The sole target is the exclusively owned, failed R5 database
openplan_a0_limit_c2e1f4598374c1bf439baa3b, OID6212363, system7683856985084612646.
The sole direct sequence is net.http_request_queue_id_seq, identified in the actual
failed request. It is not the new R6 target. No operation repairs or fills an old
stage receipt, retries restore, adopts that database or authorizes a successor.

Use two new, separately journaled psql requests, both with explicit READ ONLY
transactions. The first tests the original whole-sequence-row expression and
expects its named error. The second reads the three explicit state fields twice,
plus fresh private catalog/global-scope metadata. Keep ON_ERROR_STOP=1. Do not
disable errors, create helpers or catch failures through a new database function.
The expected error's full stderr may differ from the original DO-block context;
retain its actual bytes. A matching message does not become restore acceptance.

Each request has a prelude/body protocol in the same returned psql process.
Journal its exact initial intent, command, environment, prelude input and returned
PID before dispatch. Wait a finite deadline for the prelude identity/scope marker;
fsync the returned prefix and its hash before any dependent body send. Check the
existing strict native identity predicate, known database/OID/system, roles,
positive backend PID and transaction_read_only=on. A mismatched, missing or
unacknowledged identity fences the request. Do not send its body or reconnect.

Journal the exact body before sending it to that same process. Corrected rows must
repeat the same database/OID/system/roles/backend PID and read-only setting. The
three state keys must remain complete: last_value and log_cnt are integers,
is_called is boolean, and the two state objects match exactly. Do not coerce
strings or treat a failed/missing row as zero. Preserve terminal streams, exit,
actual unit/cgroup identity and hashes. Do not assume backend absence, transaction
completion or cancellation from a timeout or collected unit metadata.

Compare fresh original-scope prefixes across the two requests and the corrected
transaction's before/after reads. Root must exclude other native/catalog work.
Repeatable read sees its transaction snapshot; it cannot independently exclude
concurrent commits. Any mismatch, unexpected error, partial intent or unknown
acknowledgement stays failed and fenced. No automatic retry follows.

Bounds remain 1 GiB memory, zero swap, CPU50 and a finite 120-second parent, plus
the prepared SQL timeouts. Database-container resources remain outside that cap.
No DDL/DML/temp object/function/trigger/RLS change, nextval/setval, sequence increment
or reset, credentials, raw application-data output or service operation is proposed.
Returned state and catalog metadata stay private. This cannot establish accepted
419 restoration, owner/locale/data equivalence, R6 admission or target reuse.
