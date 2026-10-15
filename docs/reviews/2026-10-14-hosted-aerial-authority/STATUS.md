# Hosted aerial guard and authority, October 14

Hosted migrations 20261017000011 and 20261017000012 are applied after a separate
fresh database and Storage capture before each. Explicit locked transactions
preserve original source text in migration history. This handles the lower
versions even though migration 13 is already applied. All earlier history rows
remain exact. The resulting hosted history has 416 rows, including 11, 12 and 13.

[Readback receipts](readback-receipts.json) identify the exact source/body hashes,
function properties, trigger and execute scope. Migration 11 is an enabled row
trigger before updates and runs as SECURITY INVOKER. Migration 12 has the
six-argument signature, pg_catalog-only search path and service-only execute.
Readback controls detect five intended metadata faults for each migration.
Read-only history controls preserve harmless variants and reject a changed hash.
Four actual execute/unavailable-request refusals exercise migration 12 on hosted.
Authorized processing, callback and archive recovery are separate isolated proofs.

The pre-11 archive has 7,264,996 bytes and 7,523 index entries. The pre-12 archive
has 7,267,293 bytes and 7,527 entries. Both Storage captures contain 11 buckets,
220 objects and 117,871,050 bytes. Certificate verification is enabled, archive
indexes are readable, and an independent retained-byte readback matches all
recorded sizes and hashes. Active writers make the captures non-atomic. They
have not been restored on another machine. Private captures remain outside git.

Production health still serves e27efa1900c2 after both applies. That health
response does not check the database; the SQL readbacks above do. The migration
turn is released to Claude for migration 14. Combined candidate CI and deployed
source/worker verification remain separate. No default worker, scientific,
planner, capacity, independent-host or v1 acceptance is declared.
