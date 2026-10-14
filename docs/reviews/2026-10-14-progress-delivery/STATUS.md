# Original progress callback delivery

This candidate saves exact accepted and running callback bytes before a
POST. A restarted process reuses the saved callback identity, occurrence time,
body and endpoint. It does not create a replacement event after an uncertain
send. A retained receiver acknowledgement prevents another POST; an explicit
4xx refusal stops retries. A transient or unconfirmed response remains pending.

The private command binds installation, target, event, request, worker job,
original start context, original application job and actor, dispatch hash,
endpoint, credential reference and body hash. Credentials resolve locally for
transport and are not saved in the command. Writers preserve original records
and reject altered bindings, missing commands, orphan replies and sequence gaps.
An operator declares a bounded attempt-retention limit. Reaching it refuses
additional attempts rather than discarding the retained history.

The adapter checks current original-actor access before preparation, before
transport and after the received response. It retains the historical received
response before the final access check. That fact does not grant current access.
An acknowledgement describes the receiver response, including an ignored or
superseded callback. It does not prove that the application applied every effect.

The POST transport uses the existing URL, address, DNS and TLS helpers. It pins
the original endpoint and credential reference, follows no redirects and sends
the exact saved body. A supervised child bounds stalled network work. Ownership
loss, cancellation or the outer deadline stops that child. Short, oversized or
unconfirmed response bytes cannot become a delivery acknowledgement. The
credential adapter is a trusted local lookup; blocking external credential
resolution is not covered by this transport.

## Evidence and limits

The 23 source cases cover original scope and bytes, uncertain transport,
interruption after remote acknowledgement, a replacement runtime, explicit
refusal, malformed responses, changed records, actor revocation, cancellation,
attempt limits and terminal/artifact refusal. Both Python 3.11 and 3.14 source
cohorts pass four positives, 37 intended faults and 296 failure-oracle controls.
The source cohorts peak at about 47.5 MiB under 256 MiB with no swap or OOM.

The 11 transport cases use real loopback HTTP connections. Cancellation and
ownership loss close a stalled response socket. The deadline case advances a
plain test clock after response headers arrive, then checks actual socket
closure. It makes no runner-speed claim. Redirect, exact body/bearer/path,
private-address refusal, incomplete responses and response-envelope checks
retain separate assertions. Final matching source bindings, both-interpreter
transport controls and complete joined checks are recorded below as they finish.

The native driver starts a real child, receives a callback through a local
receiver fixture and exits 44 before saving its response receipt. A replacement
process sends the same bytes. The fixture records one effect across two POSTs.
Later recovery makes no POST, and a current-access refusal prevents another
delivery claim. The access RPC and receiver are synthetic local HTTP fixtures.
They do not establish live RLS or the application's receiver implementation.
The receiver correction and its separate database proof belong to
[the callback application record](../2026-10-14-aerial-callback-retry/STATUS.md).

This increment supplies no terminal callback, artifact URL, remote artifact
transfer, processing-quality claim, default-worker configuration, hosted setting,
migration, version or release tag. Complete worker integration, public DNS/TLS,
hosted workflow, separate-host restore and practitioner acceptance remain open.
M3, M5b.2 and the full v1 contract remain open.

## Retained failed trials

The first source harness trials expose an absent output parent, an ambiguous
guard binding, one indentation error, mismatched failure diagnostics and
fixtures that either exhaust their replies or let a secondary guard mask the
intended fault. The corrections preserve the assertions and keep those trials.

The first HTTP control service reaches its 256 MiB cap during a deliberately
broken deadline check. A recording mocked clock accumulates calls in the
resulting busy loop. That is not passing evidence. A plain clock function
replaces the recording mock. The killed process cannot run its `finally` block;
the exact one-line mutation is restored manually, and the following baseline,
harmless and restored cohorts pass. The HTTP controller now also saves original
source bytes before mutation so an interrupted controller has a retained restore
copy. Subsequent HTTP cohorts peak below 47 MiB with zero swap and OOM.

Private proof base:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-progress-delivery-20261014/`.
Only sanitized counts, resource records and source bindings belong in this report.

## Matching final control cohorts

Both interpreters pass the following cohorts against matching retained source
bindings. Every normal mutation restores in `finally`. The kernel-terminated
clock trial retains its separate manual-restoration record above.

| Boundary | Positive runs per interpreter | Intended faults | Failure-oracle controls |
|---|---:|---:|---:|
| Original progress journal, 23 cases | 4 | 37 | 296 |
| Supervised POST transport, 11 cases | 4 | 21 | 168 |
| Actual interrupted process and HTTP recovery | 4 | 6 | 36 |

The final transport cohorts peak at about 46.1 MiB and 47.6 MiB. The final native
cohorts peak at about 59.3 MiB and 67.2 MiB. Their 256 MiB limits, zero swap,
zero max-pressure and zero OOM events are retained in the resource records.
The first HTTP OOM trial remains a failed result. Complete joined entry points,
documentation checks and exact-head GitHub CI are separate boundaries.

## Joined worker entry points

All 49 aerial worker entry points pass. This includes 934 unittest cases in 42 files and seven other contract/CLI entry points. The serial run takes 116.84 seconds and peaks at about 69.5 MiB under 1 GiB, with zero swap, max-pressure and OOM events. Product direction passes from the actual nested application package; dated jurisdiction and capability review reminders remain. A mistaken root-level npm invocation fails before running that check and is corrected by the nested invocation. Exact-head GitHub CI remains separate and pending.

## Existing receiver contract

The candidate initially admits `queued`, which the receiver does not support, and imposes an unnecessary ASCII ID limit. These are corrected before publication. Progress statuses come from the existing worker contract, with terminal states excluded. ID and message lengths follow the receiver's UTF-16 units. Original fractional timestamps remain exact. Executing the actual TypeScript callback schema confirms the four-emoji ID and 12-digit fractional timestamp; harmless and restored cases survive, and queued/short-ID controls fail at their expected fields. This source-schema check does not establish a hosted or database journey.

Eight nested application direction/roadmap guards pass under one Vitest worker. Three report-link positives survive and the missing-link fault fails at its intended assertion. A formatter invocation matches no Python file and supplies no formatting acceptance; the actual Python entry points and source controls provide the recorded code checks.
