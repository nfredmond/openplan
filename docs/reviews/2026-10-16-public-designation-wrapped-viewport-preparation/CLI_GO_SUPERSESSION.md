# A separate Go CLI proposal replaces the unavailable npm donor request

Source preparation only, October 16, 2026 Pacific. ROOT grants no runtime
window. `CLI_GO_REQUEST.json` supersedes the original
`CLI_GENERATION_REQUEST.json`. The original request remains historical and
unchanged. Its combined donor does not exist according to ROOT's read-only
metadata observation. The earlier Bun bootstrap failure stays failed. No npm,
Node launcher, alternate wrapper or global Supabase executable is selected.

## Exact packet and selected tool

The NEW private child is
`/home/nathaniel/.local/state/openplan/public-designation-wrapped-viewport-preparation-20261016/cli-go-source-preparation-02`.
Its `packet/runner.py`, `packet/request.json`,
`packet/frozen-app-tests.sha256` and `packet/GRANT_TEMPLATE.json` are review
sources, not executed artifacts. No `packet/GRANT.json` exists. The future
`runtime-01` directory does not exist and can be created only after a valid
grant. Its exclusive creation prevents a second parent activation from retrying
the same attempt, including after preflight failure.

The selected tool is the existing official Go CLI 2.75.0 at
`/home/nathaniel/.local/state/openplan/land-use-cli-official-go-release-20261016/supabase`.
Independent byte and stat reads in this turn find SHA-256
`ede7713ac26a4e8bd8ebdfad93676d9652b254d4d6bc163a003a6493f4b3302b`,
95,027,384 bytes, mode 0700, UID/GID 1000. No selected-tool code executes.
This older CLI is proposed solely for local empty-file generation. It changes
no project dependency version and establishes no generally supported CLI policy.

ROOT separately reports ELF EXEC with six program headers and no PT_INTERP.
That metadata reduces the apparent interpreter-closure need for this Go binary.
It does not prove execution or the Python/bwrap closure. Earlier version stdout
and new-help text are read as small historical data from
`land-use-migration-generation-root-20261016-r2`. Current version/help must still
be rechecked in the proposed new window. No earlier trial becomes current proof.

## Exact outer argv and grant fields

The outer argv is recorded as an array in `CLI_GO_REQUEST.json`:

```text
/usr/bin/python3 -I -S -B
/home/nathaniel/.local/state/openplan/public-designation-wrapped-viewport-preparation-20261016/cli-go-source-preparation-02/packet/runner.py
--grant
/home/nathaniel/.local/state/openplan/public-designation-wrapped-viewport-preparation-20261016/cli-go-source-preparation-02/packet/GRANT.json
```

The corresponding cwd is the NEW private child above. These lines describe one
argv, not separate shell commands. Do not execute them during preparation.

ROOT alone may publish `GRANT.json`. Required fields are `state: GRANTED`,
`issuer: ROOT`, request ID `designation-viewport-official-go-cli-02`, exact
`requestSha256`, `runnerSha256`, `frozenManifestSha256`, selected `binarySha256`,
`maxCliInvocations: 5`, `maxGenerationInvocations: 1`, and an absolute UTC
`expiresAtUtc`. The template is explicitly NOT_GRANTED and has no valid expiry.
Both parent and inner process require matching hashes and a live expiry.

Prepared hashes are:

- Request: `b4a13bd49746232e7fc4bd27565c0e8256181944ad28bd32b78fbec776fedf56`.
- Runner: `f56ebff3ee89920cfe1c1fb936e8890d7d6d91be27d47578c4185937a4a216a4`.
- Frozen ten-file manifest: `1a20624ae7ddd4edc5da0c03c6a98b258266b038b1fc26238ee2bb689a654af0`.

The separate `packet/packet.sha256` also pins the disabled grant template.
No source change after these pins is covered by a future grant using them.

## Namespace and finite operation

The runner proposes one nonblocking exclusive lock on the existing compiler
file, opened read-only without creation or truncation. Device/inode are pinned
in the request. The parent retains the FD through manager waiting and final
source/identity reads. A closed FD does not prove that an unknown manager unit
has stopped or authorize another window.

The one systemd user unit has MemoryMax 256 MiB, MemorySwapMax 0, CPUQuota 50
percent with a 100ms period, TasksMax 64, no core files and a 128 KiB file limit.
RuntimeMaxSec is 59 seconds with one second reserved for control-group stopping,
within the requested 60-second subject budget. The parent alarm is 75 seconds;
its manager-client wait cap is 70. These are prepared limits, not observed ones.
Inner admission reads the actual cgroup values before the first CLI call.
It also checks actual read-only source/tool mount options and refuses writable
mounts outside `/work` and `/dev/null`. A parent plan is not a mount attestation.

Bubblewrap starts from an empty root, with fixed `/usr` read-only and fixed
library/executable aliases. Nested host mounts under `/usr` cause refusal.
The exact selected tool and packet inputs are read-only before command one.
Application paths are not mounted. The cgroup tree and fresh proc filesystem
are read-only. User/PID/network/IPC/UTS namespaces are new; capabilities are
dropped. The device exposure is `/dev/null` only. The root filesystem is
read-only after setup. Only NEW `runtime-01`, mounted as `/work`, is writable.
Private HOME, cache, config and tmp directories all reside there. Host root,
home, run, tmp, etc, Docker sockets, credentials and prior migrations are absent.
The CLI receives only the declared private environment, including GOMAXPROCS=2.

The parent only inspects assigned Git metadata, frozen source bytes and migration
filenames. It checks exact `d264d691` and the original branch before/after the
unit. It neither imports application code nor copies old migrations. The new
project contains one small project_id config and an empty migrations directory.

Every CLI command uses `/tool/supabase` inside that same namespace, with a
10-second termination deadline and at most 128 KiB per stdout/stderr stream.
Each child also receives RLIMIT_FSIZE and no core allowance. One second may
drain killed pipes; the subject is killed at its deadline. Commands run once,
in this order: version, top help, migration help, new help, then
`migration new public_designation_query_viewport`. Actual help must describe the
local empty script and positional name. Any failure, ambiguity, timeout or
capture overflow stops the attempt without an alternate command or retry.

After generation, require one regular zero-byte file whose actual returned
name matches the chosen slug. Compare that observed name with current maximum
`20261017030608_land_use_plan_publication_transaction.sql`, among 425 base
migrations. Preserve the artifact and comparison for ROOT. No SQL, copy, rename,
slot assumption or worktree migration write occurs. ROOT separately disposes
ordering and any later exclusive copy. Terminal reports remain subject to ROOT
acceptance; manager or process liveness is not inferred from a parent result.

## SQL qualification is a separate source-only delta

The old template and its pins are preserved first in the NEW private child.
`sql-qualification.diff` records the current review-data change. The template
now puts `pg_catalog` before `public`, names built-in types and `count` through
`pg_catalog`, and names PostGIS functions through `public`. Type aliases preserve
the same function signature identities. Predicate, OR windows, count placement,
limit, ACL, RLS, stored data and indexes are unchanged.

Existing migration `20260826000003_model_truth_correction.sql:141,158` explicitly
declares `public.geometry` and calls `public.ST_SetSRID`/`public.ST_GeomFromGeoJSON`.
`20260827000001_model_truth_completion.sql:289-323` and
`20260828000001_model_validation_assessment_custody.sql:278-308` repeat that
qualified PostGIS source contract. These establish the intended schema as
`public`; the template follows it. The two extension-creation statements omit
WITH SCHEMA and do not independently establish installed catalog placement.
No installed catalog is queried or assumed. Actual PostGIS function/operator
placement and template parsing still need later native verification.

## Manual static review and unproved boundaries

The prepared source has one manager invocation site and one fixed five-command
list. The final generation is unreachable until all four version/help gates
succeed. There is no wrapper fallback, network-enabled CLI path, old-migration
copy, SQL write, app import, test/build command or worktree migration write.
The only future source reads outside the namespace are byte/Git metadata reads.

This is manual source review. No interpreter, AST parser, compiler, test, lock,
manager, namespace or selected CLI runs. The fixed `/usr` Python/bwrap closure,
namespace support, cgroup path resolution and minimal CLI config remain
unmeasured prerequisites. Additional files, authority or configuration require
ROOT disposition before dispatch; do not add mounts, install, initialize another
project, broaden privileges or retry automatically. A future failure preserves
raw bounded streams and failed/unknown status. Full v1 and all current holds stay open.

Prospective counterfactuals include a disabled or mismatched grant refusing
before manager launch, changed tool/source bytes refusing before command one,
a busy existing lock refusing once, help mismatch preventing generation, and
timeout/overflow retaining unknown or failed receipts. A harmless source-comment
change must invalidate a prior exact runner hash until ROOT reviews and grants
the new hash. These guards have no observed control outcomes. Exercising any
control needs its own explicit authorization and must not consume/retry the
single real generation grant as a test campaign.

Read limits: an early intent read included its migration-name/hash inventory
and was truncated; no mountinfo dump was emitted. While locating the compiler
file, a bounded pattern search and the first eighteen lines of the earlier
runner were also read. No earlier runner/proof is copied or executed. The
superseding runner is newly authored. Earlier accepted windows remain earlier
evidence; FREE remains no grant.
