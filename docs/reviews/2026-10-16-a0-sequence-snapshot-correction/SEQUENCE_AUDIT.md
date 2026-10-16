# Explicit sequence fields replace one sequence pseudo-row conversion

October 16, 2026. This is source preparation. No new SQL or diagnostic executes.

The actual R5 restore runs its archive request017 successfully, then reads a
matching 419-entry migration history at request019. Request021 fails while the
snapshot serializes net.http_request_queue_id_seq through to_jsonb(s). Its retained
stderr identifies a missing composite type. No complete snapshot, definitions,
final originalScope, child completion or manager-terminal acknowledgement follows.
The restored R5 target remains failed and permanently fenced.

The new R6 Controller.snapshot sequence branch prepares this dynamic query:

```sql
SELECT pg_catalog.jsonb_build_object(
  'last_value', s.last_value,
  'log_cnt', s.log_cnt,
  'is_called', s.is_called
)
FROM %I.%I s
```

The existing format() call still quotes the enumerated schema and relation as
identifiers. It still selects relkind S alongside ordinary and partitioned tables.
The complete map retains each sequence under its schema/relation label. All three
fields remain values, without text coercion, omission, nextval, setval or reset.
Ordinary table count/digest hashing, FROM ONLY, row-hash ordering, complete table
inventory, pg_sequences census digest, repeatable-read transaction and rollback
remain byte-identical to R5. Later full-map before/after comparisons still see
sequence-state differences. Initial retained419 table-map/census expectations
remain the original frozen source pins; no new acceptance threshold is introduced.

The nine runtime files contain one sequence-relation whole-row serialization,
in this snapshot branch. Other to_jsonb(s) calls serialize pg_db_role_setting
rows. Ordinary table to_jsonb(t) and pg_sequences view-row conversions stay intact.
Those are relation rows with their retained comparison purposes, not the failing
sequence pseudo-row. No global replacement occurs.

The seven frozen preceding helpers remain read-only and byte-pinned. Their helper.py
snapshot enumerates ordinary/partitioned tables and serializes pg_sequences view
rows into its census. It does not directly pass a sequence pseudo-row to to_jsonb.
That preceding implementation and its source-data pins are not edited or regraded.
The old R3/R4/R5 runtime sources and failed inputs preserve the original expression.

The focused campaign reaches actual Controller.snapshot/sql/inspect/
identity_guard/argv and real journal.Transport, with Popen as the sole inert
boundary. It inspects the actual generated dynamic query, preserve the full
table map/census, vary every sequence field in before/after comparisons and test
harmless and named source mutations with exact restoration. The source-preparation checkpoint runs no test. The later granted single TEST
unit completes the focused campaign and reduced case continuity;
the full old 15-fault case campaign is not copied or rerun.

This source correction is not an application/connector/SQL18 defect claim. Inert
query recognition cannot prove PostgreSQL parsing, exact native sequence state,
role/ACL behavior, transaction effects, restored table custody or accepted restore.
The separate read-only diagnostic proposal needs root-owned review and admission.
