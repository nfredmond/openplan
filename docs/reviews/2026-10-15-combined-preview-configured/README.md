# Combined candidate preview with retained configuration

Prepared October 15, 2026 for parent candidate
`b4dbcac21a58f61bd480ccade4dec69383dacbc7`, using Sol at high reasoning.
This correction copies templates from exact prior commit
`9d7b8edc9fd851905e01c23c2aa2e5cbaa37a21b` and changes configuration preparation
only. The assigned tree started clean and fast-forwarded to `b259d73e5`;
`product:direction:check` succeeds with its existing dated reminders.
No nested delegation occurred. This packet prepares execution. It does not prove
that the launcher, database clone, helpers, build or browser journey works.

## Ownership and identities

This bounded correction owns this review directory and the following private directory:

```text
/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-combined-preview-configured-20261015
```

The parent's integration tree at
`/home/nathaniel/.t3/worktrees/openplan/t3-0f743997` remains untouched.
The launcher creates its future detached candidate checkout inside the private
directory. It does not build or serve either assigned T3 checkout.

The planned database is
`openplan_project_combined_preview_02edd1c162e1c09a5d05b95c`.
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

The private directory holds newly generated local JWT/API credentials, separate helper
configuration, the captured source fingerprint, prior input hashes, Storage
inventory and the planned target identity. Its directory permissions are 0700;
private files are 0600. During parent execution, the gateway phase changes its
bind-mounted Kong file to 0444 so the container's image user can read it. The
host parent directory remains 0700. Never print `envs-private.json`, `app-env-private.json`,
Kong configuration, private environment files, dumps or private logs.

The original `capture` and this packet's `check` use read-only PostgreSQL sessions. The source fingerprint
covers ordinary tables, sequence state, migration history, schema catalogs,
database properties, global roles/memberships and relevant role settings.
The fingerprint matches across the captured observations. This is a logical
state comparison at observation times. It does not lock the retained source
against another operator or prove that no transient change ever occurred.

The source has no foreign tables, subscriptions, cron table, database-specific
settings or delegated database ACL grantors. The launcher refuses when these
prerequisites change. It never edits roles, source settings, server configuration
or retained helper configuration to overcome a refusal.

The [control summary](controls.json) records 567 synthetic observations:
474 intended refusals and 93 survivors. All 478 original control rows remain
identical. The 89 added observations cover optional configuration custody and
source-anchor enforcement, including the real private-reader call paths with
filesystem observations replaced by synthetic inputs. The harness first accepts harmless notes
or ordering changes, then rejects named faults, and finally accepts exactly
restored in-memory inputs. Faults cover source/container identity, migration
counts, source fingerprints, wrong/missing/mistyped fields, target prefixes,
source-as-restore-target, parallel restore, source dump arguments, file bytes,
helper environment/mounts/labels/networks/limits, gateway ports/origins, SMTP,
provider credentials and launch/build bindings. Raw Docker observation mapping
also runs against synthetic inspect/image inputs with tool calls replaced.
Detailed trials remain private. These controls do not establish live behavior.

## Parent execution after combined QA

Execute this packet only after combined QA and parent review. It replaces the
prior packet for execution, but does not overwrite it. Both packets plan the
same ports; execute only one.

The following commands are instructions for the parent. None of these mutating
phases has run. The existing private configuration is already captured. Do not
overwrite its bindings. This launcher removes the `capture` phase and pins the
original source fingerprint in its policy. It cannot silently recapture a changed
source as a new baseline. Evidence and phase intents use
exclusive creation, so a failed attempt remains reviewable.

Set the private path and run the read-only preflight:

```bash
COMBINED_PREVIEW_DIR=/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-combined-preview-configured-20261015
python3 -B "$COMBINED_PREVIEW_DIR/launcher.py" check
```

Check the committed template hashes and the private binding manifest against
[preparation.json](preparation.json) before execution. The file records exact
SHA-256 values; these commands print only file hashes and paths:

```bash
sha256sum "$COMBINED_PREVIEW_DIR/private-bindings.json" \
  "$COMBINED_PREVIEW_DIR/launcher.py" \
  "$COMBINED_PREVIEW_DIR/policy.py" \
  "$COMBINED_PREVIEW_DIR/controls.py"
```

`check` verifies private bytes, planned
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

The checkout receives the sealed local app environment. It retains these three
existing optional values from the specifically authorized private source:

```text
/home/nathaniel/.local/state/openplan/project-map-integration-20261015/openplan/.env.local
CENSUS_API_KEY
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
OPENPLAN_INTEGRATION_KEY_SECRET
```

All three keys exist in this preparation. Their values and the full source file's
SHA-256 remain private in `configured-source-private.json`. That file is itself
bound by the frozen private manifest. Each preflight checks the exact source
path, private permissions, full source-file hash, selected values and exact app
configuration. It rejects source changes, dropped keys and mismatches. The parser
reads no shell expressions and accepts no variable expansion. Optional absence
is supported only when captured from an absent source key; it does not excuse
omitting any of the three keys present in this packet.

This retains existing Census/map setup and the existing fixture integration
secret for the parent's actual geography/map journey. It does not add a provider,
subscription or spend authorization. No value is copied into helper environments.
GTFS managed ingestion stays `0`; AI and email credentials remain absent. Fresh
local JWT signing material and local API keys differ from the prior packet.
Existing engine role credentials remain unchanged. Retained encrypted fixture
records remain in native419 and travel through the planned logical clone without
reseeding or rewriting ciphertext. This preparation does not test decryption or
use those records to call a provider. The parent owns actual map/geography and
fixture custody evidence after combined QA.

The parent installs dependencies with
`npm --prefix "$COMBINED_PREVIEW_DIR/candidate/openplan" ci`. No dependency
installation occurred during preparation. Then run the planned webpack build
and preview in separate user units:

```bash
systemd-run --user --wait --collect \
  --unit=openplan-combined-configured-build-20261015-01 \
  -p MemoryMax=10G -p MemorySwapMax=0 -p TasksMax=256 -p CPUQuota=200% \
  /usr/bin/python3 -B "$COMBINED_PREVIEW_DIR/launcher.py" build

systemd-run --user --collect \
  --unit=openplan-combined-configured-web-20261015-01 \
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

The original packet at commit
`9d7b8edc9fd851905e01c23c2aa2e5cbaa37a21b` remains authoritative for its
credential-free preparation evidence. Its complete private directory remains
unchanged, including three earlier preparation errors:

- The first role inventory queried `rolconfig` from `pg_authid`; PostgreSQL
  rejected it. The corrected read uses `pg_roles`.
- The first control trial replaced a null field with null and correctly reported
  a surviving supposed fault. The mutator now changes its type. An attempted
  parse of that empty failed output also raised `JSONDecodeError`.
- The added endpoint guard initially expected an implicit PostgreSQL port and
  rejected the materialized explicit `5432` URIs. The guard and synthetic inputs
  now pin exactly `5432`. Private configuration bytes remain unchanged.

Prior template revisions, failed output and failure records remain in the
original private directory. This new private directory retains both successful
control trials, the first template revision and both read-only preflight logs.
A separate final scan initially flagged existing engine-password substrings in
public identifiers, also present in the exact prior public templates. That failed
assertion remains private. The corrected scan checks complete private connection
URIs and all retained/generated key values, accepts a harmless wording change,
refuses nine injected complete credential values and accepts exact restoration.
No credential value was printed. Both control trials and both configured
preflights succeed. Python source
parses without running operational phases. The direction check succeeds with
its existing dated review reminders. No full suite, live RLS, dump/restore,
service startup, application build, browser, network-provider workload,
PR, push or merge has run.

The optional-key guards cannot prove that a retained key is valid, scoped for
this origin, accepted by its provider, or able to decrypt the retained records.
They do not authorize calls or prove their cost. Whole-file hashing deliberately
refuses even an unrelated source-file edit. The binding must not be refreshed
to bypass a refusal. The original logical source fingerprint remains
`82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547`.

The controls cannot prove Docker's enforcement, restore compatibility, helper
schema migrations, actual credentials, endpoint readiness, cgroup capacity,
planner usability, artifact quality or scientific/agency acceptance. Concurrent
source activity can cause a conservative fingerprint refusal. Same-user file
modification and a privileged Docker operator remain outside these local hash
checks. No automatic cleanup, resource deletion, DB reset, source-role repair
or retained-process stop is included.
