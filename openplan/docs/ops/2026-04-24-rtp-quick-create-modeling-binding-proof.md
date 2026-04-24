# RTP quick-create modeling evidence binding proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Bind one-click RTP packet creation surfaces to the default workspace assignment modeling evidence.

## What shipped

The shared `createRtpPacketRecord` helper now accepts an optional `modelingCountyRunId` and includes it in the existing `POST /api/reports` create request when present.

The RTP registry and RTP cycle detail pages now load the latest workspace assignment claim decision with a non-null county run and pass that county run into the packet quick-create surfaces:

- RTP detail `RtpReportCreator`,
- registry table row action,
- registry advisory dominant create-packet shortcut,
- packet queue command board.

The assistant executable quick links use the same default. Both RTP-cycle and RTP-registry assistant contexts carry `defaultModelingCountyRunId`, and `create_rtp_packet_record` actions pass it into the runtime action registry.

The quick-create UX remains intentionally low-friction: the detail creator and queue command board show a small note when assignment modeling evidence will be attached, but do not add another selector beside the existing one-click control.

## Safety posture

- No schema change in this slice; it consumes the `reports.modeling_county_run_id` linkage already shipped.
- `POST /api/reports` remains the authority for validating that a selected county run belongs to the target workspace.
- Missing or not-yet-applied modeling evidence schema falls back to `null`, preserving historical quick-create behavior.
- Defaults are workspace-scoped and read only from assignment-track `modeling_claim_decisions` rows with a non-null `county_run_id`.
- Operators who need an explicit choice among multiple county runs can still use the full report composer evidence selector.

## Files shipped

Modified:

- `openplan/src/app/(app)/rtp/page.tsx`
- `openplan/src/app/(app)/rtp/[rtpCycleId]/page.tsx`
- `openplan/src/app/(app)/rtp/_components/_types.ts`
- `openplan/src/app/(app)/rtp/_components/rtp-cycle-registry-table.tsx`
- `openplan/src/app/(app)/rtp/_components/rtp-queue-operations-board.tsx`
- `openplan/src/app/(app)/rtp/_components/rtp-registry-advisory-panel.tsx`
- `openplan/src/components/rtp/rtp-report-creator.tsx`
- `openplan/src/components/rtp/rtp-registry-next-action-shortcut.tsx`
- `openplan/src/components/rtp/rtp-registry-packet-queue-command-board.tsx`
- `openplan/src/components/rtp/rtp-registry-packet-row-action.tsx`
- `openplan/src/lib/assistant/catalog.ts`
- `openplan/src/lib/assistant/context.ts`
- `openplan/src/lib/runtime/action-registry.ts`
- `openplan/src/lib/reports/client.ts`
- `openplan/src/test/assistant-context-load.test.ts`
- `openplan/src/test/assistant-respond-rtp-cycle.test.ts`
- `openplan/src/test/assistant-respond-rtp-registry.test.ts`
- `openplan/src/test/reports-client.test.ts`
- `openplan/src/test/rtp-page.test.tsx`

Added:

- `openplan/src/test/rtp-quick-create-modeling-binding.test.tsx`

## Gates

- `pnpm test src/test/reports-client.test.ts src/test/rtp-page.test.tsx src/test/rtp-quick-create-modeling-binding.test.tsx src/test/action-registry.test.ts src/test/assistant-context-load.test.ts src/test/assistant-respond-rtp-registry.test.ts src/test/assistant-respond-rtp-cycle.test.ts`: 7 files / 27 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 209 files / 1072 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean.

## Deferred

The quick-create surfaces intentionally inherit one workspace default rather than exposing a second selector. If a customer starts creating RTP packets from multiple county-run evidence bases in the same workspace, the next slice should add a compact picker to the RTP detail creator and queue surfaces while preserving the current default.
