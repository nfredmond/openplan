# Data Hub provenance trust labels proof (2026-05-09)

> **DATED RECORD — 2026-05-09.** This describes what was true on the day it was written.
> It is kept because it records *why* decisions were made, which nothing else captures.
> **Do not treat any factual claim here as current** — verify against the code, the
> database, or `CHANGELOG.md` before acting on it. A stale doc that reads as current
> costs more than a missing one: on 2026-07-30 a roadmap in this folder listed two
> "remaining" items that had both already shipped, and nearly cost a full rebuild of a
> feature that already exists.


## Slice

Added a small, pure Data Hub provenance classifier and surfaced its label on each dataset registry row.

## Why

Dataset cards already exposed citation, source URL, license, schema, checksum, vintage, and refresh timestamp, but operators had to mentally inspect those fields to know whether a dataset was audit-ready. The new label gives a quick trust posture without adding schema or changing ingestion paths.

## Shipped

- `src/lib/data-sources/dataset-provenance.ts` resolves four trust levels: verified, traceable, partial, unverified.
- `/data-hub` dataset rows now show a trust badge beside readiness badges and include the classifier detail in the provenance panel.
- `src/test/dataset-provenance.test.ts` covers complete, traceable, partial, and unverified metadata combinations plus badge tone mapping.

## Verification

- `npx eslint 'src/app/(app)/data-hub/page.tsx' src/lib/data-sources/dataset-provenance.ts`
- `npx vitest run src/test/dataset-provenance.test.ts`

Note: this worktree did not have local `node_modules`; commands were run after temporarily symlinking to the main OpenPlan checkout's installed dependencies, then the symlink was removed.

## Merge risk

Low. The slice adds a pure helper, one focused unit test, and a read-only UI label. No migrations, API writes, or seed data changes.
