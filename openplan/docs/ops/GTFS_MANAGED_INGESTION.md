# Retained transit import operation

This is an opt-in development candidate. Migrations `20261016000028` through `20261016000031` are unreleased. Leave `OPENPLAN_GTFS_MANAGED_INGESTION` unset or `0` until the selected installation has those migrations, private file persistence and an installed polling worker. Enabling the switch changes URL, catalog, ZIP and refresh imports to retained requests. It is operational configuration, with no paid entitlement.

## Configure the app and worker

Run the app and worker from the nested `openplan/` package with Node 24, using the same protected Supabase configuration. The service-role key belongs on the server only. On the demonstrated Linux setup, both processes use the same Unix owner and persistent private file location.

| Setting | Meaning |
|---|---|
| `OPENPLAN_GTFS_MANAGED_INGESTION=1` | Enables managed admission in the app. |
| `OPENPLAN_GTFS_INSTALLATION_ID` | A UUID generated once for this installation and retained across restarts and coordinated recovery. |
| `OPENPLAN_GTFS_PARSER_BUILD` | The deployed parser's source identity, 40 to 64 lowercase hexadecimal characters. Keep the pinned parser and identity for unfinished attempts. |
| `OPENPLAN_GTFS_WORK_DIR` | An absolute private persistent root shared by the app and worker. Select it explicitly for a supervised service. |

The worker derives a target namespace from `NEXT_PUBLIC_SUPABASE_URL`. Submissions and human commands use sibling directories under the configured root. Back up the entire root, including those siblings. It contains exact ZIP/source bytes, parser artifacts and private command/attempt journals. Protect it from other users; the implementation requires private directories and files. Do not substitute an ephemeral container filesystem or copy only the version queue.

From `openplan/`, inspect and run the installed command:

```bash
npm run worker:gtfs-ingestion -- --help
npm run worker:gtfs-ingestion -- --once
npm run worker:gtfs-ingestion
```

The command loads `.env.local` when present. A service must receive its protected configuration explicitly and start in the actual nested package directory. One-shot mode performs a bounded pass, rather than draining the queue. Continuous mode polls serially. Configure supervision, restart behavior and log retention for the chosen installation; an interactive command alone does not establish a dependable service.

Exit 0 means the bounded pass finishes or a continuous worker stops cleanly. Exit 2 means retained work is still unconfirmed or awaiting a later pass. Exit 1 means an error or an interrupted one-shot invocation. Logs distinguish submission handoff, terminal observations and unconfirmed work. A terminal observation may describe a failure or cancellation. It does not mean every import succeeded.

## Planner and recovery behavior

The planner retains a request identity before submission. Check progress or recover the same request when its reply is unavailable. Supply a changed source or corrected ZIP through a new request. Processing preserves exact input bytes and confirms immutable archive custody before parsing. Ready means processing completed; the planner must review the version and explicitly adopt it before analysis uses it.

Cancellation is a separate human command. A cancelled request cannot later admit a version. Cancellation after admission closes unfinished processing and schedules archive reconciliation. Already completed or failed processing cannot be relabelled cancelled. Retain the recurring `/api/cron/reap-gtfs-ingests` schedule: an upload can arrive after cancellation, so a single cleanup pass or Storage RLS alone does not close that boundary.

SIGINT/SIGTERM stops the worker's active transport/parser work and retains journals. Restart with the same target, installation identity, private files and pinned parser. A fresh worker respects an active lease and may replace its claim only after expiry. Do not edit lease times, journals, archive hashes or database statuses to resume work. Do not overwrite an archive object with different bytes.

Before an upgrade, capture database, Storage, the complete private root, configuration and the pinned source/dependency identity together while the affected writers are stopped. Finish or explicitly resolve unfinished attempts with their pinned parser before changing parser identity. Preserve old files and receipts. A different logical origin or installation identity is a different custody boundary; copying a path or changing its journal metadata is not a supported recovery procedure.

## Verified boundary

[The dated evidence](../../../docs/reviews/2026-10-09-gtfs-managed-ingestion/STATUS.md) records native ownership/RLS, interrupted requests, installed CLI, browser roles, representative upgrade, archive reconciliation and retained restoration checks. The reconstruction proof uses fresh services and files in the same physical cluster with existing roles and unchanged logical origin. Cross-host recovery, new agency commissioning, largest-feed capacity, native file selection and practitioner acceptance remain open. Parsed schedules and service rows do not establish observed transit operations or independently validated model accuracy.
