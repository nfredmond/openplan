# Data Hub provenance trust labels proof (2026-05-09)

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
