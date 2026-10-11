# Hosted demo AI and schema catch-up, October 11, 2026

This record updates the AI and managed-database statements in the [initial
public cutover checkpoint](HOSTED_LIVE_2026-10-11.md). It preserves that
checkpoint's source and acceptance boundaries. Final independent review and
the public-readiness handoff remain separate work.

## Demo AI

Nathaniel creates the Anthropic key for the `OpenPlan hosted demo` provider
workspace and supplies it for his confirmed synthetic OpenPlan workspace.
The provider workspace has a $5 monthly cap. The inspected console reports
$0.06 of that cap after the first two acceptance requests. No new credits,
subscription, or card charge is purchased for this setup.

The ordinary Integration keys form validates and saves the key. A native
database read confirms v2 encrypted storage. Six actual access checks confirm
that the owner reads metadata, another workspace receives 404, anonymous
access receives 401, and a keyless workspace does not inherit paid AI.
No shared deployment `ANTHROPIC_API_KEY` is configured. Other users supply
their own keys. Preserve the encryption root; changing it can invalidate
stored workspace keys.

On public build `05dd3e8da4a4572437f06e771b0a2477873e681f`, a typed Planner
Agent question returns a complete answer. Report drafting stores an
unaccepted `claude-opus-5-5` draft with 11 of 12 sentences grounded and one
sentence flagged for review. Desktop and 390-pixel review preserve the
warning. No agency decision, measured finding, or accepted narrative is
asserted by the synthetic fixture.

A separate retained project-provider request succeeds with an actual
`claude-opus-5-5` receipt, workspace-key authentication, 1,355 input tokens and
203 output tokens. This Anthropic path runs inside Vercel. It is not a Railway
execution proof. The application worker separately reads and decrypts the
stored key in a read-only diagnostic using its installed crypto module and
environment. That diagnostic makes no provider call or queued AI-job claim.
The project-task DOM retains its result; repeated screenshot capture times
out, so that task has no fresh screenshot acceptance.

## Hosted GTFS schema

Later main merges add the managed GTFS candidate. Its cleanup route requires
`reconcile_gtfs_storage_cleanup` even with managed admission disabled. The
hosted database initially lacks that function and all four candidate
migrations. The reviewed missing-file inventory contains exactly migrations
`20261016000028` through `20261016000031`.

After a protected database capture, `supabase migration up --linked
--include-all` applies those four files to the existing OpenPlan project.
There is no reset, migration rename, history repair, or new worker service.
The resulting history contains 405 migrations. A repeated application has no
pending files. Existing transit-table counts and digests remain unchanged;
those tables are empty, so this is not populated hosted transit evidence.

All private GTFS tables have RLS. The cleanup RPC permits `service_role` and
refuses `authenticated` and `anon`. An actual authenticated public cleanup
request returns 200 with zero scanned and reaped records; anonymous access
returns 401. `OPENPLAN_GTFS_MANAGED_INGESTION` remains disabled. Applying schema
does not commission private file persistence, a polling worker, or feed
capacity. Follow the [candidate runbook](../../openplan/docs/ops/GTFS_MANAGED_INGESTION.md)
before enabling admission.

## Build memory

Later automatic Git builds expose two retained failures: one exceeds Vercel's
45-minute limit, and one receives SIGKILL after exhausting the standard
4-core, 8 GB build container. A later build of `fa9daf8` succeeds on that same
machine and completes the build in about two minutes. That success does not
establish cold-cache reliability.

The follow-up enables Next.js's documented `webpackMemoryOptimizations`
setting. It preserves webpack, TypeScript checks and the existing build
machine. It purchases no enhanced build service. A cold hosted build and
the subsequent checked Git delivery remain required acceptance work;
the setting alone does not prove lower measured memory or future uptime.

## Backup boundary

The post-demo and post-schema database archive contains 7,179,228 bytes and
7,477 readable archive-index entries. Its SHA-256 is
`4937f7f127128292b129e80b70a5ac6391edbf8d4cdde386819f121dd16a4531`.
It uses verified TLS and private local storage. It includes the encrypted
demo key and synthetic draft. The archive has not been restored, active
writers remain, and it is not a quiesced multi-service recovery point.
Earlier restore drills retain their distinct fixture and source boundaries.
