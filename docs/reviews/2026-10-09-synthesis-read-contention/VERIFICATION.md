# Recover briefly busy synthesis request reads

The October 7 [staff response journey](../2026-10-07-synthesis-execution-queue/STAFF_RESPONSE_ACCEPTANCE.md)
records three 503 responses caused by `lock_synthesis_generation_request_scope`.
Current source confirms that request reads acquire the same exclusive advisory
transaction lock as creation and cancellation. Concurrent reads can therefore
return `PT503`. This investigation does not reproduce the old browser schedule.

The authenticated request adapter now retries only an explicit `PT503` from
`read_engagement_synthesis_generation_request`. It waits 50 milliseconds, then
150 milliseconds, allowing at most three calls. Every call uses the same request
scope, client and original ten-second abort signal. Cancellation interrupts the
wait. A persistent failure still returns unavailable. Each successful response
still passes the existing scope, content and digest verification.

Creation and cancellation receive no automatic retry. Permission refusals,
conflicts, malformed responses, other errors and transport exceptions retain
their existing behavior. Database authorization, locking and write recovery are
unchanged. Other synthesis RPC readers still have their existing contention
behavior. These delays are bounded recovery choices, not measured production
latency thresholds.

## Checks

The 48 adapter tests pass, including short contention recovery, persistent
contention, caller/deadline cancellation, no write retries, exact request identity
and malformed recovered content. Scoped TypeScript and targeted ESLint pass.
The initial scoped compiler invocation lacked the new checkout's generated
`next-env.d.ts`; copying the existing generated declaration resolves that setup
error. This is not a full application build.

`verify_controls.py` runs baseline, harmless-comment and restored checks plus
four targeted mutations. Omitting retries, retrying writes, retrying unrelated
errors and changing the retry arguments all fail their named assertions. It
restores the exact production bytes in a `finally` block. The native database
and preview instance are not modified. Local raw check logs are under
`/tmp/openplan-synthesis-read-controls-wphwbiz_` and are not repository artifacts.

The adapter and six affected consumer suites pass 209 tests across seven files.
They cover progress, execution, continuation, execution history, preview and
thematic-choice discovery. These checks use mocked database responses. They do not establish native concurrent
transaction timing, eliminate all synthesis lock contention, prove clean browser
console behavior or establish human usefulness. T3 capture remains unavailable;
the original browser finding stays open pending identified-build acceptance.

## Native database follow-up

A separate 53 MB database clone supplies the installed functions and grants.
The source database has zero other sessions before cloning. The new database is
`openplan_synthesis_read_dd859cf932624960944c628ad835d9c4` in the existing isolated
restore-test container. No preview database, installed public function or existing
source row changes. The clone is retained for inspection.

The seed transaction runs the existing `synthesis-source-custody.sql` fixture,
resets the role, then runs `synthesis-generation-requests.sql` through its helper
function definitions. It calls `pg_temp.gen_create()` as the authenticated original
owner and commits this synthetic request. No provider call runs. The source
fixture promotes the second account to owner; the proof resets that synthetic
account to viewer before testing its access. The first native run detected that
fixture mismatch with a missing expected refusal. The corrected proof explicitly
asserts the viewer role before reading.

`verify_native.mts` calls the unchanged installed request reader as authenticated
staff through the production TypeScript adapter. Its transport shim uses psql
and preserves the actual SQLSTATE. A second connection holds the request's
advisory transaction lock. The transient case releases it only after the first
native `PT503`, avoiding a timing assumption. The persistent case holds it through
all three reads. Both lock transactions roll back in cleanup.

The retained [native results](native-controls.json) record:

- an ordinary read succeeds;
- a held lock returns `PT503`, then the exact retained request returns after release;
- persistent contention returns three `PT503` results and remains unavailable;
- the viewer receives `42501` with one call;
- the final owner read returns the original request unchanged.

Baseline, harmless-comment and restored controls pass. Removing the retry loop
fails on the native `PT503` response after the first held-lock read. Scoped
TypeScript also checks the native script. The replayable control command is:

```sh
python3 docs/reviews/2026-10-09-synthesis-read-contention/verify_native_controls.py \
  /home/nathaniel/.local/state/openplan/synthesis-read-native-20261009.json
```

That local metadata file identifies the retained proof database and container.
The script requires this proof-specific database prefix and fixed container.
It does not provision a new database or run against an arbitrary demo target.
The earlier command-path failure occurred before the native script existed;
correcting the repository-relative path resolved it without changing production.

This establishes native lock-response recovery for the adapter. The transport is
not PostgREST, and the release is synchronized rather than a measured workload.
HTTP behavior, real concurrency distributions and the original T3 journey remain
open. The read still cannot bypass a held lock or renew execution permission.

## HTTP transport follow-up

The production adapter also passes through the installed PostgrestClient over
loopback HTTP. A separate clone,
`openplan_attempt_cli_8262a39d7f9c4dc5a3b734c9f4fef98b`, retains the same synthetic
request and roles. A private proof schema exposes a single security-invoker SQL
wrapper around the unchanged public request reader, with the same argument
names. Only authenticated callers receive execute permission. The wrapper does
not replace the native authorization or locking function. The existing gateway
helper creates a temporary signing secret and authenticated owner/viewer tokens;
none are retained in the evidence files.

The [HTTP controls](http-controls.json) pass baseline, harmless-comment and
restored cases. The removed-retry mutation fails on native `PT503`. Transient
contention returns `PT503` then unchanged custody; persistent contention returns
three failures; the viewer receives one `42501`. The gateway is removed after the
check, and the script checks cleanup. Scoped TypeScript passes with both transport
paths. Run with the metadata for the retained HTTP clone:

```sh
OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER=supabase_db_openplan-restore-target-2026091050 \
python3 docs/reviews/2026-10-09-synthesis-read-contention/verify_http.py \
  /home/nathaniel/.local/state/openplan/synthesis-read-http-20261009.json
```

The first invocation omitted the helper's required explicit container selection
and stopped before starting a gateway. Subsequent full-public-schema attempts
failed with interrupted sockets. Docker then confirmed `OOMKilled=true` and exit
137 for the 128 MB gateway. Some immediate removal checks caught asynchronous
container removal; later inspection found no surviving proof container. The
successful run narrows the exposed schema rather than increasing the memory
limit. This is a transport fixture, not evidence that a full OpenPlan PostgREST
catalog operates within 128 MB. That resource boundary remains unmeasured above
the failed limit.

This adds authenticated HTTP transport evidence for the adapter and installed
reader. It does not execute the Next.js route, browser session or original
engagement navigation. T3 capture and identified-build browser acceptance remain
open, as do full workload capacity and planner usefulness.
