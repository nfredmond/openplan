# One joined recovery and operations candidate

October14, 2026. This unmerged integration combines main325/eef4253 with the
reviewed recovery stack, owned Service93104a0bd, explicit CLI37b499fd8 and
operator-health/error-report correction aa1acc39a. Only additive changelog and
archive entries conflict. Both sides remain. No default worker, hosted setting,
provider account, new migration application, version or release tag changes.

The original cd7139f3e stack head passes every test job, including live RLS,
restore and the aerial-worker job at58m28s. Those are parent-head results. The
joined candidate requires fresh exact-head CI before merge; the prior green
results do not declare this joined head accepted. Main325 independently has ten
completed-success checks and exact public health at23:31:11Z.

The joined tree passes218 application/documentation cases and95 selected worker
cases. Scoped parent checks remain bound to unchanged source. All134 recorded
source hashes match. Three positive comparison controls preserve bindings;
a wrong original hash and changed source bytes are refused. The historical
native census still covers120 original files. Its four new Service/CLI files
have actual local HTTP/child/source controls, not native processing qualification.
See [source bindings](source-bindings.json), [binding controls](binding-controls.json)
and [combined checks](combined-tests.json).

The CLI passes both-interpreter4x32/41 faults and197 related cases each. Its
review closes an observed startup-fixture race and keeps the historical SIGTERM
exit2 cause unknown. Operator health corrections pass4x8/11 transport faults;
error reports pass4x6/6 faults and3x72 shuffled related cases. The original GTFS
storage-room source and regression evidence remains unchanged. See the separate
[CLI](../2026-10-14-owned-worker-cli/STATUS.md),
[owned Service](../2026-10-14-owned-worker-service/STATUS.md),
[operations](../2026-10-14-ops-health-transport/STATUS.md) and
[retained transit archive](../2026-10-14-gtfs-storage-room/STATUS.md) records.

Read-only hosted history now independently reports417 rows. Exact history/source
hashes match migrations11,12 and14 on the intended installation. See
[the selected readback](hosted-selected-history.json). Migrations11/12 retain
their earlier fresh capture/apply/function/privilege evidence. This readback adds
no schema change, does not recheck every function body, and is not a restore.

No hosted backend/worker execution, real Sentry event, workflow deployment event,
response-body cancellation, native engine processing, complete receiver/Storage,
existing-root adoption, measured capacity, planner observation or independent
installation is newly accepted. M3/M5b grades and the full V1 contract remain.
Stage A still needs its remaining operating work and twelve current-build journeys
before its completion report. No second Linux host is available.
