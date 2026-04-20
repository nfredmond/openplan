# Anthropic call telemetry on `/api/analysis` (2026-04-20)

## What shipped

`generateGrantInterpretation` now surfaces `usage` metadata from AI-SDK v6's `generateText` response, and `/api/analysis` audit-logs it as part of the `analysis_completed` event. The monthly-run quota still counts calls, but Anthropic spend is now observable at per-call granularity through Vercel runtime logs, keyed on `event="analysis_completed"`.

## Changes

### `src/lib/ai/interpret.ts`

`InterpretationResult` extended from `{ text, source }` to:

```ts
{
  text: string;
  source: "ai" | "summary-fallback";
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  fallbackReason: "missing_api_key" | "generation_error" | "empty_output" | null;
}
```

- AI-SDK v6's `LanguageModelUsage` shape is `{ inputTokens, outputTokens, totalTokens }` (each `number | undefined`). `nullIfUndefined` normalizes to `number | null` for consistent downstream serialization.
- `estimatedCostUsd` is computed against a module-level Haiku rate card (`$1.00/MTok` input, `$5.00/MTok` output, the public Anthropic price for `claude-3-5-haiku-latest` on 2026-04-20) and rounded to 6 decimal places.
- Three distinct fallback reasons let the route distinguish between config errors (missing key), infrastructure errors (upstream throw), and soft degradation (model returned whitespace).

### `src/app/api/analysis/route.ts`

The existing `audit.info("analysis_completed", ...)` call at line 509 gained five new fields: `aiModel`, `aiInputTokens`, `aiOutputTokens`, `aiTotalTokens`, `aiEstimatedCostUsd`. All are `null` on the fallback path.

A new `audit.warn("analysis_ai_fallback", ...)` fires when `fallbackReason` is non-null — so the three failure modes surface as queryable events distinct from the completion log line.

No caller-visible shape change; the route's JSON response is unchanged.

## Rate card notes

The Haiku rate card is frozen in code rather than an env var or config table. If Anthropic updates prices:

- Update the two `HAIKU_*_USD_PER_MTOKEN` constants in `src/lib/ai/interpret.ts`.
- Historical log lines won't retroactively update — `estimatedCostUsd` is a snapshot at emit time, not an authoritative cost. The authoritative cost comes from Anthropic's own invoicing; this telemetry exists for per-workspace budget visibility, not billing accuracy.

If a second model lands, prefer a small `MODEL_RATES: Record<ModelId, {input: number; output: number}>` map over a fork of the helper.

## Why log-only, not a table

Same discipline as the CSP report-only rollout (`docs/ops/2026-04-20-csp-report-only-proof.md`): observe first, then add infra if the data justifies it. A `billing_ai_calls` table would be premature before we know:

- Query patterns we actually want (per-workspace daily aggregate? per-model breakdown? time series?)
- Retention expectations (7 days? forever?)
- Whether to persist raw usage or aggregate at write time

Log-grep covers a 1-2 week observation window; `grep '"event":"analysis_completed"' + jq` is sufficient for ad-hoc budget health checks.

## Tests

`src/test/interpret.test.ts` — new, 5 cases:

1. **Missing `ANTHROPIC_API_KEY`** → `summary-fallback` + `fallbackReason: "missing_api_key"`, `generateText` never called.
2. **`generateText` throws** → `summary-fallback` + `fallbackReason: "generation_error"`, no throw escapes.
3. **Whitespace-only model output** → `summary-fallback` + `fallbackReason: "empty_output"` (distinct from the two error paths).
4. **Successful completion** → `source: "ai"`, tokens + model populated, cost computed from rate card.
5. **Cost rounding** → specific `(1234, 5678)` token pair asserts the 6-decimal rounding result (`0.029624`).

Import-level `vi.mock` for both `ai` and `@ai-sdk/anthropic` — same shape as `src/test/csp-report-route.test.ts`. `process.env.ANTHROPIC_API_KEY` is saved/restored per test to avoid leaking state.

## Gates

From `openplan/`:

```bash
pnpm exec tsc --noEmit     # exit 0
pnpm lint                  # 0 warnings
pnpm test -- --run         # 174 files · 818 tests · 12.34s
pnpm audit --prod          # No known vulnerabilities found
```

Net +5 tests (813 → 818), +1 file (173 → 174).

## Manual verification recipe

Requires `ANTHROPIC_API_KEY` set locally:

```bash
pnpm dev
# trigger /api/analysis with a valid corridor + query against a seeded workspace
# then:
grep '"event":"analysis_completed"' <dev-log-stream> | jq '.payload | {aiModel, aiInputTokens, aiOutputTokens, aiTotalTokens, aiEstimatedCostUsd}'
```

Expect each matched line to have all five fields populated when an AI call happened, or all `null` on fallback. If fallback, a preceding `event="analysis_ai_fallback"` line names the reason.

## Files

- `openplan/src/lib/ai/interpret.ts` — extended (was 49 LOC, now ~110 LOC).
- `openplan/src/app/api/analysis/route.ts:508-530` — `analysis_completed` payload expanded; new `analysis_ai_fallback` warn branch.
- `openplan/src/test/interpret.test.ts` — new (108 LOC, 5 tests).

## Not this slice

- **Cost-based quota.** Needs cost-per-workspace distribution data first. Post-observation slice.
- **`billing_ai_calls` table.** Same — log observation first.
- **Dashboard / aggregation UI.** Separate slice.
- **Rate-card config externalization.** YAGNI until a second model lands or pricing churns.
- **AI Gateway migration.** The PreToolUse hook flagged the direct `ANTHROPIC_API_KEY` usage and recommended routing through the Vercel AI Gateway for OIDC auth + failover + cost visibility. That is a larger refactor (new env vars, provider routing config, potentially different error shapes) and out of scope for this telemetry-only slice. Record as a future candidate; the cost visibility we wanted for *this* session is now in the audit log.

## Pointers

- Prior slice (dep CVEs): `docs/ops/2026-04-20-dependency-cve-patch-proof.md`
- Observation-first discipline reference: `docs/ops/2026-04-20-csp-report-only-proof.md`
- AI-SDK v6 usage type: `node_modules/ai/dist/index.d.ts` (`LanguageModelUsage`)
- Audit logger: `src/lib/observability/audit.ts:117`
