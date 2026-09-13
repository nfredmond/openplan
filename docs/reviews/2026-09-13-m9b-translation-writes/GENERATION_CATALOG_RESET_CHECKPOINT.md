# Usage-reset checkpoint

The user asked whether this thread can resume after the weekly usage reset.
The last verified, pushed implementation is eb2db0eae64d0da13fff766096d87f8b72c21eb1.
Read GENERATION_QUEUE_API_PROGRESS.md for that evidence and the infrastructure.

Three newer files are preserved as unfinished work in this checkpoint:
- openplan/src/lib/engagement/translation-generation-catalog.ts
- openplan/src/app/api/engagement/campaigns/[campaignId]/translations/generation/route.ts
- openplan/supabase/migrations/20261014000015_engagement_translation_generation_catalog.sql

They add a staff request catalog with 20-row keyset pagination and exact UTC
microsecond cursors, so saved requests can be found after browser storage loss.
These changes have NOT had TypeScript, regression, mutation, SQL, browser or
release verification. Migration 15 is not installed. Do not merge or release
this checkpoint as verified work. The changelog still needs migration 15.

Resume in /home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13,
branch work/translation-command-workflow, package openplan/.
First inspect active sessions, git state and current remote main. Preserve the
original checkout, demo and pending reminder constraint. Re-establish browser
and database identity rather than assuming old processes survived.

Next, test catalog permissions, field counts, scope, ordering, equal-millisecond
microsecond differences, UUID ties, 21-row pagination and malformed cursors.
Each changed guard needs a harmless control and a targeted failure. The route
change makes the prior request-control route hash stale; rerun applicable controls.
Use rollback-only fixtures in the named disposable proof database described in
GENERATION_QUEUE_API_PROGRESS.md. Do not attach a worker to its old queued cases.

Then implement publication from exact retained completed output with source and
saved-translation version checks, and integrate discovery/generation/publication
into the editor. Legacy machine routes remain active, protected generated
publication remains refused, and no new browser workflow is accepted yet.
Continue full QA, shuffled tests, isolated RLS, worker and upgrade checks and
final-commit CI before direct main release. No PRs or human-review release gate.
V1 remains the full authorized destination, with local/free operation and honest
scientific and agency-authority limits. Do not restart from the obsolete v0.47 plan.

All expensive earlier evidence remains in this review directory and the private
local evidence paths referenced by its progress files. Live processes are not
part of the persistence guarantee; recreate and verify them when resuming.
