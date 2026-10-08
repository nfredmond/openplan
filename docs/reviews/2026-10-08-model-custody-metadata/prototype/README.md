# Model stage claim prototype

This executable database prototype starts the attempt-ownership design in the parent directory. It is deliberately outside application migrations and has no worker caller. Do not deploy it as a completed ownership fence.

The claim transaction retains request and response identities, takes request then parent-run then stage locks, records an attempt only for an eligible queued stage, and binds the active attempt to its actual stage with a composite foreign key. A repeated request returns its original response, including a lost claim. Different contents under an existing request identity fail. An unfinished predecessor prevents claiming a later stage. New attempts and request receipts are unavailable for direct public or service-role table writes; only the service-role command is exposed.

Run against an explicitly named disposable database:

```bash
OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER=supabase_db_openplan-restore-target-2026091050 \
  python3 -B docs/reviews/2026-10-08-model-custody-metadata/prototype/verify_claim.py
```

The runner checks that prototype tables are absent, loads the SQL and synthetic fixtures in one transaction, runs assertions as the service role, and rolls back. It checks table absence after each connection closes. Baseline, harmless comment and restored controls pass. Ignoring changed request contents and ignoring an unfinished predecessor each fail for their specific assertion. Native verification completed October 8, 2026 in the named restore-target stack. No prototype tables remain installed.

This is sequential transaction evidence, not simultaneous-process contention or production recovery. It does not yet provide attempt-bound progress, terminal writes, artifacts, expiry, reaper invalidation, relaunch, immutable receipts against privileged database administration or old-worker bypass protection. Existing stage-ID REST writes remain possible until the complete lifecycle is connected. No migration history is changed and no existing study or output bytes are altered.

Next implement and test the progress/terminal commands and direct-write boundary, then connect reaper, relaunch and both worker packages before promoting this design into an additive migration. Preserve the complete M3 definition of done and the scientific-ingestion attempt requirements.
