# Combined candidate preview preparation

Prepared October 15, 2026 for parent candidate
`b4dbcac21a58f61bd480ccade4dec69383dacbc7`, using Sol at high reasoning.
No nested delegation occurred. This packet prepares execution. It does not prove
that the launcher, database clone, helpers, build or browser journey works.

## Ownership and identities

This branch owns this review directory and the following private directory:

```text
/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-combined-preview-20261015
```

The parent's integration tree at
`/home/nathaniel/.t3/worktrees/openplan/t3-0f743997` remains untouched.
The launcher creates its future detached candidate checkout inside the private
directory. It does not build or serve either assigned T3 checkout.

The planned database is
`openplan_project_combined_preview_4a0447f4f966dfa1e3b0a820`.
It does not exist as a result of this preparation. Its retained source is
`openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up`, inside exact container
`a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce`
(`supabase_db_openplan-restore-target-2026091050`). Read-only SQL confirms
419 migrations, latest `20261017000016`. The candidate's 419 migration versions
match that source. Every candidate migration file has a private byte binding.

The planned API is `http://127.74.19.10:29948`.
The planned web origin is `http://127.74.19.10:3585`.
Read-only preparation checks found both ports available. This does not reserve
them; execution checks them again.

## What preparation checks establish

The private launcher and committed templates have matching SHA-256 hashes in
[preparation.json](preparation.json). That file also anchors the private binding
manifest and source logical fingerprint. No credentials, row contents, account
identifiers, Storage filenames or database dumps appear in this packet.

The private directory holds fresh local JWT credentials, separate helper
configuration, the captured source fingerprint, prior input hashes, Storage
inventory and the planned target identity. Its directory permissions are 0700;
private files are 0600. During parent execution, the gateway phase changes its
bind-mounted Kong file to 0444 so the container's image user can read it. The
host parent directory remains 0700. Never print `envs-private.json`, `app-env-private.json`,
Kong configuration, private environment files, dumps or private logs.

`capture` and `check` use read-only PostgreSQL sessions. The source fingerprint
covers ordinary tables, sequence state, migration history, schema catalogs,
database properties, global roles/memberships and relevant role settings.
The fingerprint matches across the captured observations. This is a logical
state comparison at observation times. It does not lock the retained source
against another operator or prove that no transient change ever occurred.

The source has no foreign tables, subscriptions, cron table, database-specific
settings or delegated database ACL grantors. The launcher refuses when these
prerequisites change. It never edits roles, source settings, server configuration
or retained helper configuration to overcome a refusal.

The [control summary](controls.json) records 478 synthetic observations:
403 intended refusals and 75 survivors. The harness first accepts harmless notes
or ordering changes, then rejects named faults, and finally accepts exactly
restored in-memory inputs. Faults cover source/container identity, migration
counts, source fingerprints, wrong/missing/mistyped fields, target prefixes,
source-as-restore-target, parallel restore, source dump arguments, file bytes,
helper environment/mounts/labels/networks/limits, gateway ports/origins, SMTP,
provider credentials and launch/build bindings. Raw Docker observation mapping
also runs against synthetic inspect/image inputs with tool calls replaced.
Detailed trials remain private. These controls do not establish live behavior.

## Parent execution after combined QA

The following commands are instructions for the parent. None of these mutating
phases has run. The existing private configuration is already captured. Do not
rerun `capture` or overwrite its bindings. Evidence and phase intents use
exclusive creation, so a failed attempt remains reviewable.

Set the private path and run the read-only preflight:

```bash
COMBINED_PREVIEW_DIR=/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-combined-preview-20261015
python3 -B "$COMBINED_PREVIEW_DIR/launcher.py" check
```

Check the committed template hashes and the private binding manifest against
`preparation.json` before execution. `check` verifies private bytes, planned
configuration, exact source container/image/network, unchanged source state,
prior helper configuration, retained Storage bytes and free ports. A changed
source requires a reviewed new preparation, not an automatic new baseline.

Create the independent logical clone and separate Storage copy:

```bash
python3 -B "$COMBINED_PREVIEW_DIR/launcher.py" clone
```

This phase requires eight GiB of free disk. It performs one serial custom-format
`pg_dump` with read-only options and a serializable, deferrable snapshot. It
retains the dump and its hash, creates a fresh target from `template0`, and runs
`pg_restore --jobs=1 --single-transaction --exit-on-error` into that target.
It binds the new database OID before restore and before helper use, and checks
the retained dump hash before and after restore. It preserves source ownership,
effective database ACLs, locale, account/password
records, private rows, migration history and sequence state. It compares all
restored table contents before starting helpers, copies Storage bytes to its
own directory and rechecks the untouched source. No migration runs are planned.
The earlier 417 fixture and journey accounts/projects travel through native419;
they are not recreated or reseeded. Source database settings must remain absent.

Create and verify the four owned helpers:

```bash
python3 -B "$COMBINED_PREVIEW_DIR/launcher.py" services
python3 -B "$COMBINED_PREVIEW_DIR/launcher.py" verify-services
```

Each new PostgREST, GoTrue, Storage and Kong container receives its own name,
purpose/candidate/database labels, pinned local image, exact returned ID,
512 MiB memory limit, equal memory-plus-swap limit, 0.5 CPU and 128-process cap.
Equal Docker memory and memory-swap limits mean zero additional swap. The shared
Postgres container's resource configuration stays unchanged. Only Kong publishes
a host port. The other helpers use the existing exact Docker network internally.
Storage mounts only its private copy; Kong mounts only its new configuration.
The gateway allows 3585 and retains the signed-download GET/HEAD route.
Earlier helpers, CORS and Storage directories remain unchanged.

Helpers use existing engine login roles and connection-local search paths.
PostgREST disables database configuration discovery and OpenAPI. GoTrue disables
signup, uses local auto-confirmation, has no SMTP/provider/hook configuration,
and issues tokens for the new API. Fresh signing keys require a fresh login;
retained password hashes and account rows remain intact. The launcher does not
rotate global role passwords or edit global role search paths. A startup error
requiring those edits is an unsupported prerequisite. Stop this path and retain
the exact private error for the parent; do not repair the shared cluster.

The service phase retains IDs before starting each helper. If immediate health
checks run before startup settles, `verify-services` can be run again. It checks
exact identities and bindings, three local API health responses and CORS
acceptance for 3585 with rejection of the old origin. It follows no redirects
and uses no proxy. A partial or uncertain Docker creation leaves its intent,
creation log and per-helper receipt. Inspect that exact evidence before taking
further action. Do not rerun `services`, guess IDs or delete retained resources.

Create the separate pinned app checkout:

```bash
python3 -B "$COMBINED_PREVIEW_DIR/launcher.py" checkout
```

The checkout receives the sealed local app environment. GTFS managed ingestion
is `0`. AI, email, Census and map-provider credentials are absent. No workspace
integration decryption secret is introduced, and no stored ciphertext is
rewritten. Retained encrypted provider records remain present but their
operation is unassessed. Basemap/provider-backed behavior is outside this
credential-free preview configuration. No helper or worker starts a provider
job as part of these instructions.

The parent installs dependencies with
`npm --prefix "$COMBINED_PREVIEW_DIR/candidate/openplan" ci`. No dependency
installation occurred during preparation. Then run the planned webpack build
and preview in separate user units:

```bash
systemd-run --user --wait --collect \
  --unit=openplan-combined-preview-build-20261015-01 \
  -p MemoryMax=10G -p MemorySwapMax=0 -p TasksMax=256 -p CPUQuota=200% \
  /usr/bin/python3 -B "$COMBINED_PREVIEW_DIR/launcher.py" build

systemd-run --user --collect \
  --unit=openplan-combined-preview-web-20261015-01 \
  -p MemoryMax=512M -p MemorySwapMax=0 -p TasksMax=128 -p CPUQuota=100% \
  /usr/bin/python3 -B "$COMBINED_PREVIEW_DIR/launcher.py" start
```

The build requires ten GiB of available memory and eight GiB of free disk. Its
10 GiB scope follows the prior build envelope, separately from helper/web caps.
The web process uses a 320 MiB V8 heap inside its 512 MiB scope. These budgets
are planned, not capacity-tested. No other process is stopped to make room.

`start` binds the successful build ID, every `.next` file, app environment,
clean candidate commit, migration bytes and exact service receipts. It checks
build OOM counters, source preservation, free web port and its own cgroup.
It sanitizes the inherited environment before executing `npm run start`.
The parent then owns identified-build navigation, desktop and 390px journeys,
console review and usable-artifact checks. No browser has opened for this work.

## Evidence limits and failed trials

Three preparation errors remain recorded privately:

- The first role inventory queried `rolconfig` from `pg_authid`; PostgreSQL
  rejected it. The corrected read uses `pg_roles`.
- The first control trial replaced a null field with null and correctly reported
  a surviving supposed fault. The mutator now changes its type. An attempted
  parse of that empty failed output also raised `JSONDecodeError`.
- The added endpoint guard initially expected an implicit PostgreSQL port and
  rejected the materialized explicit `5432` URIs. The guard and synthetic inputs
  now pin exactly `5432`. Private configuration bytes remain unchanged.

Prior template revisions, failed output and failure records remain private.
The corrected read-only preflight and synthetic controls succeed. Python source
parses without running operational phases. The direction check succeeds with
its existing dated review reminders. No full suite, live RLS, dump/restore,
service startup, application build, browser, network-provider workload,
PR, push or merge has run.

The controls cannot prove Docker's enforcement, restore compatibility, helper
schema migrations, actual credentials, endpoint readiness, cgroup capacity,
planner usability, artifact quality or scientific/agency acceptance. Concurrent
source activity can cause a conservative fingerprint refusal. Same-user file
modification and a privileged Docker operator remain outside these local hash
checks. No automatic cleanup, resource deletion, DB reset, source-role repair
or retained-process stop is included.
