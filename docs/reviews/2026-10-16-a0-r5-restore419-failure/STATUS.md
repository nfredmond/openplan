# The R5 archive restore succeeds but verification fails

October 16, 2026. The single admitted restore419 attempt reaches parent exit 1. Its exact source remains `1b21ef6dbc3c9a75872ad6d36e6b7d369c6fda9a`, application `d577a9cd955018b3253f42b3d9af2a96a9a10b53`. Independent source/metadata review `98cff4cf63ab760dc6be8550263470a019be1ec7` is preserved beside this report. It conditionally supports one restore proposal and supplies no operating acceptance.

Root verifies 652 source, nine runtime, five binding and seven helper pins, predecessor receipts, archive identity, modes, unit absence and exclusive window before publication. It publishes only the reviewed proposal. The parent invokes restore419 once, without a successor.

Requests 001 through 020 return zero. Request 017 is the fixed single-transaction archive restore; it returns zero with empty stderr. Request 019 reads the complete 419-entry history, latest `20261017000016`, with the expected ordered versions and full-row digest. The archive still matches its original SHA-256 afterward. The original catalog scope matches before restoration.

Request 021, the native snapshot query, returns 3. PostgreSQL reports `relation "http_request_queue_id_seq" does not have a composite type`. The helper emits `SELECT to_jsonb(s) FROM schema.sequence s` for sequences. This actual failure prevents the snapshot from returning. The separate manager request returns 1, and root parent session 78154 ends 1 after 5.029465 seconds. Invocation is `932f850eb7044404bb354d13e6f1974e`. Retained parent limits are 1 GiB, zero swap and 50 percent CPU; measured parent peak is 14,065,664 bytes. Database work runs in the existing container outside that cap.

No history, snapshot, definition, completion or manager-terminal receipt follows. Final original-scope comparison is not reached. Archive exit zero and matching raw history do not establish complete data/sequence custody, owner/locale, structural equivalence, rollback, backend absence or accepted recovery. No application or provider defect is established by this helper failure.

The target `openplan_a0_limit_c2e1f4598374c1bf439baa3b`, OID 6212363, and its stage remain fenced. Root does not retry, repair receipts, overwrite, clean up, migrate or reuse the target. A new R6 preparation addresses explicit sequence-field capture and uses a new unallocated target. Any query-only diagnostic against this retained failed target needs its own reviewed scope and cannot complete the old stage.

The private proof manifest retains request inputs/outputs, returned PIDs, hashes, exits, publication records and parent custody. A root metadata reader initially used the stage parent instead of the controller directory for request019; that read-path error and correction remain recorded. It sends no native command and changes no subject. The original failure journals remain unchanged.

Native receipt/RLS/case/race acceptance, actual installed-client outcomes, browser journeys and full A0 remain open. Main, hosted settings and release stay held. This failed attempt is new evidence for a narrow proof-helper correction, not a completed restore or a reason to narrow V1.
