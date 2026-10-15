# Main329 CI and identified delivery pass

The parent releases the sequential delivery hold for exact main
`ced6aced9ddc6bf839891fb8e44d67c2d1dfe053` on October 15, 2026. Seven push
regression workflows pass. Public health identifies that commit. Railway
reports its exact deployment successful, with seven startup messages and seven
fresh running process observations. This is provider and process correlation,
not direct per-worker source attestation or completed-job acceptance.

The earlier [pending checkpoint](REPORT.md) and four pending continuation
readings remain preserved. This record supersedes their pending delivery state,
not their observations. No application, hosted configuration, migration,
credential or deployment command changes in this verification.

## Exact-main CI completes

The commit-filtered read completes at 09:15:38 UTC. All seven push workflows
name the exact full main SHA, attempt one, and conclude successfully:

| Workflow | Run |
|---|---|
| CI | [38704493851](https://github.com/nfredmond/openplan/actions/runs/38704493851) |
| RLS Isolation | [38704493767](https://github.com/nfredmond/openplan/actions/runs/38704493767) |
| Aerial worker custody regression | [38704493800](https://github.com/nfredmond/openplan/actions/runs/38704493800) |
| Node queue process observations | [38704494013](https://github.com/nfredmond/openplan/actions/runs/38704494013) |
| Worker security and cancellation | [38704493992](https://github.com/nfredmond/openplan/actions/runs/38704493992) |
| Research collector evidence | [38704493815](https://github.com/nfredmond/openplan/actions/runs/38704493815) |
| Integration secret rotation | [38704493802](https://github.com/nfredmond/openplan/actions/runs/38704493802) |

Production Health run 38708548734 also succeeds. Two deployment-status health
runs skip; they are not reported as health successes. The ten returned runs
equal the API's total count. A separate main-ref API response at 09:18:28 UTC
still names exact `ced6`. These are workflow-level results, not a new audit of
every job log or branch-protection setting.

## Web and worker delivery identify the new main

At 09:15:38 UTC, public `/api/health` returns HTTP 200 with commit prefix
`ced6aced9ddc`, version `0.68.0`, and expected migrations 418 through
`20261017000015`. The response is a cache miss with no-store headers. Its
database check remains `not_checked`; the advertised migration manifest is
not an installed-schema census.

The explicit Railway project, environment and application service match the
prior authorized installation. Deployment
`1fd9bd72-1e79-4584-8c3a-2ec6d1ca6c77` reports `SUCCESS`, with the exact full
main SHA. The preceding 4ea deployment reports `REMOVED`.

A bounded log request for that deployment returns 95 parsed rows, no parse
errors, and these seven worker-start messages between
`09:10:23.661241399Z` and `09:10:23.661260919Z`:

- document-exports
- engagement-email
- provider-api
- translation-generation
- synthesis-preparation
- synthesis-execution
- contract-calculations

At server time `09:15:38.221932Z`, the existing process reader reports one fresh
running instance and zero stopping instances for each of those seven kinds.
Their latest observations are between 6.6 and 12.7 seconds old. The running
rows start between `09:10:26.015433Z` and `09:10:31.720855Z`, after this
deployment's startup messages. Earlier stopped rows remain historical.

All per-process `build_sha` values are null. The declared scope is
`process_only`, and job completion remains `unassessed`. GTFS remains
`unobserved`; missing observations do not establish zero processes or enable
managed ingestion. The provider's exact deployment and its startup messages
support the correlation. The process reader does not independently attest a
source commit, completed work, queue capacity or sustained operation.

## Database and receipt limits remain explicit

The separate migration SELECT returns 418, latest `20261017000015`, with
candidate 16 absent. It checks count, latest and candidate presence, not every
version, function or grant. The connection requests read-only defaults, but
`SHOW transaction_read_only` returns `off`. Server-enforced read-only status is
not established. Executed statements are inspection SELECTs, the existing
process-summary SELECT, transaction-local role selection and rollback.
No write or configuration repair occurs.

The receipt comparator checks actual captured GitHub, main-ref, web, provider,
startup and process inputs. Harmless extra metadata survives. Eight targeted
receipt faults refuse for their named reasons: unfinished workflow, old web,
waiting deployment, missing startup, stale process observation, wrong non-null
process SHA, unexpected candidate migration and changed main. Original input
hashes remain unchanged after the trials.

The first comparator used a literal expected main ref after a separate manual
API read. The parent identifies that acquisition gap before releasing the hold.
The second version reads the captured API response and binds its hash. Both
scripts and receipts remain private. These controls establish comparator
sensitivity, not authenticated receipt provenance or a common remote snapshot.

Raw reads, logs, scripts, failures and the final receipt hashes remain private
under `node-queue-observation-20261014/main329-continuation-05-20261015` in the
retained GTFS proof root. [Sanitized evidence](delivery-verified-evidence.json)
records the accepted reading. Network and database reads are bounded; no
hosted mutation or external message occurs.

The temporary 10-minute continuation stops after its fifth firing because
frozen 06a local QA and this delivery check are resolved. The separate weekly
model-directive reminder remains unchanged. The local REST-helper recovery,
workbook formatting work, new-HEAD integration/build, browser journeys,
practitioner and scientific acceptance remain open. No release or new main
merge occurs. The next main merge requires its own CI and delivery verification.
