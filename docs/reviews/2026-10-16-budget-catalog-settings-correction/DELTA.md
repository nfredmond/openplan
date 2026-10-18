# Proposed delta for root technical disposition

This is a design fragment, not executable source or admission. Keep all old
runtime, request, wrapper, controller, journal, policy, templates and evidence
bytes and modes. Prepare new consumers only after root approves this footprint.

## 1. Use absent credential paths without weakening stderr

For a future NEW capture, keep env clearing, `HOME=/nonexistent`, fixed owned
container, internal Unix socket, port5432, admin `supabase_admin`, maintenance
database `postgres`, `-w`, `-XqAt` and ON_ERROR_STOP. Set explicit paths:

- `PGPASSFILE=/nonexistent/openplan-budget-catalog-v2-20261016.pgpass`
- `PGSERVICEFILE=/nonexistent/openplan-budget-catalog-v2-20261016.pg_service.conf`

Do not pass PGPASSWORD, PGSERVICE, inherited credentials or connection strings.
The libpq source returns before service-file lookup when no service is selected.
The explicit file paths also prevent fallback to a real home credential file.
Keep the native transport's zero-stderr rule unchanged.

Proposed absence guard: one fixed Docker exec after container inspect, before
psql. Run cleared-env `/usr/bin/find -P / -mindepth 1 -maxdepth 1 -name nonexistent -print`.
Require code0, empty stdout and empty stderr, within5 seconds and4096 bytes per
stream. This examines the one root-directory entry name, including a symlink,
without reading credential contents. A present entry, unavailable tool,
permission error or uncertain terminal refuses before SQL. No install, fallback
or warning suppression is permitted. Tool availability and exact behavior are
UNVERIFIED. Root must approve this guard source before its later pure request.
The fixed container ID remains `a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce`;
the image remains `sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f`.

Absence is an observation at one instant. Root's exclusive scope must also
exclude container filesystem changes between guard and psql. This does not
prove arbitrary hostile same-user or container-owner race resistance. No file
is created, deleted or chmodded inside the container.

## 2. Replace raw per-database settings with a versioned full-row summary

Use scope marker `scopeSchema: budget-protected-catalog-v2`. Keep every protected
database's name, OID, owner and ACL, ordered by database name. Exclude only the
fixed planned budget name, as before. Replace its settings value with the
following proposed scalar subquery, where `d` is that database's catalog row:

```sql
SELECT pg_catalog.jsonb_build_object(
  'rows', pg_catalog.count(*)::int8,
  'digest', pg_catalog.md5(coalesce(
    pg_catalog.string_agg(pg_catalog.md5(pg_catalog.jsonb_build_object(
      'row', pg_catalog.to_jsonb(s),
      'setconfigType', pg_catalog.pg_typeof(s.setconfig)::text,
      'setconfigDimensions', pg_catalog.array_dims(s.setconfig)
    )::text), '' ORDER BY s.setrole), '')))
FROM pg_catalog.pg_db_role_setting s
WHERE s.setdatabase = d.oid
```

COALESCE remains SQL syntax rather than a schema-qualified function. No SQL
parser or database evaluates this proposed expression here.

Hashing happens on the server before serialization. The hash payload includes
the complete catalog row, its settings SQL type and array dimensions. SQL NULL,
empty array, NULL element, element order and nondefault lower bounds remain
distinct in that payload. Ordering by setrole covers every row, including role0;
do not select a subset of roles. Zero rows yields integer0 and MD5 of empty text,
not a null summary. The schema version and canonical JSONB text define the
comparison format for this PostgreSQL17 package. Require exact typed shapes,
nonnegative integer counts and32 lowercase hexadecimal digest characters.

Retain MD5 to match the existing scope's change-detection approach. Count plus
ordered full-row hashes does not eliminate MD5 collisions. Digests also permit
guessing low-entropy settings; keep artifacts private0600. Do not call this
cryptographic secrecy or adversarial collision resistance. Roles, memberships
and global-setting digests keep their old projections and limitations.

Define this expression once in the NEW sql.py and reuse it for NEW SCOPE and
PROPERTIES.settings. The latter currently serializes raw settings too. Keep
later target stages held until that consumer uses the same summary. Do not
change target snapshots, migrations or their transaction semantics here.

The NEW capture stays a fixed catalog SELECT in explicit REPEATABLE READ READ
ONLY on maintenance postgres, bounded at15s statement/3s lock/10s idle and16MB
work_mem, ending in ROLLBACK. It reuses the exact existing role-OID identity
projection. Use pg_catalog search-path confinement for the fixed catalog query.
Do not query source419 data, retained targets or settings values through any
secondary query. No role, grant, owner, database or persistent config write.

Every originalScope consumer requires schema2 and compares the FULL object.
That includes ready/admission, observe, allocation predecessor, every stage's
before/after scope, final scope and proposal builder. No old scope conversion,
subset equality, default-empty settings or metadata-only recapture is allowed.
Capture actual rows/digests and bind their retained artifact hashes. Actual
identity and scope remain MISSING until a separately admitted successful capture.

## 3. Bind manager identity while the one owned unit is alive

Use a NEW fixed unit, proposed `openplan-budget-catalog-settings-v2-20261016`.
ExecStart runs Python-B directly, so manager MainPID must equal the entry PID.
Reserve durable capture intent before any external call. Before Docker or SQL,
make ONE fixed `systemctl --user show` read of that exact unit with these fields:

`Id,InvocationID,MainPID,ControlGroup,ActiveState,SubState,RuntimeMaxUSec,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax`.

Use5 seconds and16KiB per stream, require zero exit/stderr and all unique expected
properties. No arbitrary unit, polling, retry, status query or recovery. For this
manager-only call, allow PATH/HOME/LANG plus XDG_RUNTIME_DIR and bus address
derived from the actual grant UID. The native Docker/SQL environment stays
sanitized. Reuse bounded journal custody with one narrowly fixed manager-self
purpose in the NEW copy, rather than assuming old `Transport.run(manager=True)`
exists. It does not. No general environment override is proposed.

Require exact Id; nonempty32-hex InvocationID equal to the actual entry env;
MainPID equal to actual self PID; actual kernel real/effective/saved UID equal
to grant UID; manager ControlGroup equal to `/proc/self/cgroup`; and exact
manager limits90s/536870912/0/CPU500ms per second/64 tasks. Check actual cgroup
memory, swap, CPU quota/period and task limits against those values. Accept only
the reviewed active/running state. Unknown or transitional values refuse with
no second read. No invented manager UID property is used.

Retain request, actual helper PID, raw bounded streams, terminal and parsed
manager ack. Persist its hash before Docker. The complete record binds ack hash,
actual entry PID/UID/cgroup/invocation, request, grant and input. The NEW collector
requires that independently read manager payload plus matching intent/complete.
If a manager start-line ID exists, require agreement. A missing suffix is allowed
only with the independently bound in-flight ack. Child self-report alone fails.
Post-show defaults remain raw and unbound, with no fallback or extra query.

Preserve115s outer deadline,1MiB stdout and64KiB stderr, durable intent before
Popen, actual returned PIDs, observed/retained lengths and hashes, parent and
manager terminals, O_EXCL namespace and UNKNOWN_NO_REPLAY on uncertainty.
Normal manager progress stderr is retained. Keep one nonblocking EXCLUSIVE
global-file lock across manager wait and the unchanged fixed-show pattern.
The added in-flight read occurs under that acquisition. No stop, reset, collect,
RemainAfterExit or cleanup workaround is proposed. A0/native18 stays separate.

## Exact proposed consumer footprint, all held

All paths below are proposed inside the NEW review and private roots named in
REPORT.md. None exists yet as executable source. No old private admissions,
reviews, windows or publications receive writes.

| NEW copy | Necessary delta |
| --- | --- |
| runtime/sql.py | One summary expression; schema2 SCOPE; PROPERTIES summary. |
| runtime/policy.py | Schema2 validator and new unit prefix; unchanged source/app/target pins. |
| runtime/journal.py | Fixed manager-self transport purpose only; native stderr and ENV stay strict. |
| runtime/controller.py | NEW ROOT/PACKET/unit prefix; schema2 full comparisons; in-flight ack before native work. |
| plan.json and source-pins.json | NEW package seal and schema marker, same422 migration bindings. |
| capture_catalog.py and catalog-capture.sql | NEW root/unit/runtime pins, absence guard, schema2 query/validator and ack. |
| collector.py and wrapper | NEW root/unit/request pins, ack correlation; preserve exclusive lock and resource limits. |
| build_observe_proposal.py | Require actual schema2 capture/ack hashes and concrete new root records. |
| requests/manifests | NEW exact source/input/argv/limits pins after review; no approved null bindings. |

Keep REPO/MIGRATIONS bound to the existing exact422 donor checkout; make PACKET
explicitly point to the NEW review packet rather than silently following REPO.
Root must approve this source/package separation and new private runtime ROOT.
Do not point these bindings at current423. Proposed private namespaces are
`runtime-v2`, `capture-v2` and `outer-v2` under the NEW private root. No attempt,
grant or admission directories are created now. Later stage resources retain
their separately reviewed profiles; this design admits none of them.

Root's disposition is required on scope schema, credential guard and the fixed
manager-read footprint before authoring these consumers. Final package, query,
request, review, publication, window, actual scope and grant hashes are MISSING.

For subsequent OBSERVE, the NEW controller's catalog-only sql path also needs
explicit READ ONLY and catalog search-path confinement. Other snapshot and
migration paths retain their distinct transaction needs. The existing policy's
Docker exec argv does not clear the container environment. Its NEW fixed sql
argv must use the same cleared environment and absent credential paths, with
the approved absence guard before the unit's first SQL request. These are
necessary policy/controller deltas, not new acceptance of inherited argv.
Allocation, restore and other command kinds stay held for their own assessment;
this capture proposal does not approve their credential handling or operation.
