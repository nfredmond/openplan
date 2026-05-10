# Pilot readiness export source-trace proof

**Scope:** Admin pilot-readiness export packet. This is a product-proof slice tied to the real `/admin/pilot-readiness` UI export surface and its Vitest coverage.

## Artifact updated

- `src/app/(app)/admin/pilot-readiness/ExportButton.tsx`
  - Exposes `buildPilotReadinessPacket(...)` so the exported markdown can be tested directly.
  - Adds each lane's source proof document to the exported line item, e.g. `Source: 2026-04-08-openplan-production-authenticated-smoke.md`.
  - Adds operator follow-up text that prevents stale `PASS` summaries from being cited without the named `docs/ops` proof file.

## Test artifact added

- `src/test/pilot-readiness-export-packet.test.ts`
  - Verifies the export packet includes the deterministic generation timestamp.
  - Verifies each tracked lane includes the source proof document, not just status/date.
  - Verifies the packet carries the operator rule for citeable PASS evidence.

## Why this matters for pilot readiness

Before this slice, the admin export summarized lane status and date but did not preserve the underlying proof filename. That made the exported packet weaker for pilot diligence because reviewers had to rediscover the source evidence manually. The export now carries a traceable pointer back to the smoke proof document while keeping the UI action unchanged.

## Validation

Run from `openplan/`:

```bash
npm test -- --run src/test/pilot-readiness-status.test.ts src/test/pilot-readiness-export-packet.test.ts
```

Expected result: both pilot-readiness test files pass.
