# Hosted model pollers on a shared volume

Build from the repository root with
`docker build -f workers/hosted-models/Dockerfile .`. This image runs the existing
AequilibraE and ActivitySim Supabase pollers in separate Python environments.
ActivitySim keeps `requirements-exec.txt` numerical pins. AequilibraE retains
its existing requirements; record the installed engine versions with evidence.
Neither a successful install nor an executed run establishes scientific validity.

Both pollers need the same private persistent filesystem. Their existing
handoffs retain registered `local://` bytes, verify run identity and producing
stage ownership, and compare hashes before use. Separate services with separate
volumes cannot satisfy that contract. This image places AequilibraE run state in
`/data/model-runs` and ActivitySim bundles in `/data/activitysim`. Do not delete
or replace this volume while attempts or local artifacts remain in custody.
Include it in a separate backup and recovery procedure.

Provide the managed Supabase URL and service role through private host variables.
Set `OPENPLAN_DEPLOYMENT_ID` to a stable identity for the installation. The
October 10 hosted installation uses `openplan-hosted-lolckycpdjsgeejsmuzl`.
Preserve that identity and the Supabase logical URL when restoring the same
installation's journal; a new installation needs a different identity.
Set `OPENPLAN_COMMIT_SHA` from the running source's actual commit so heartbeat
records identify the worker build. Railway Git deployments supply
`RAILWAY_GIT_COMMIT_SHA`; the configured start command exports it at runtime.
The service opens no inbound port. The supervisor fails if either poller exits,
including exit zero, and stops its sibling before returning. Operator signals
stop both pollers normally. Existing stage ownership and reconciliation rules
continue to govern interruption; restart is not permission to repeat a write.

The October 10 installation reserves one replica in Railway us-west2, with at
most two CPUs and 8 GB RAM. The workspace alerts at $25 and stops workloads at
$40 monthly compute usage. That stop can interrupt a legitimate long run. It
protects the authorized operating budget and does not make large regional runs
fit this host. Hosted availability is distinct from validation, source coverage,
and calibrated nationwide applicability.

`python workers/hosted-models/test_supervise.py` verifies actual child exit and
operator shutdown behavior. It does not execute either engine. Verify live
heartbeats, queued stages, artifact bytes and application reads independently.
