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
