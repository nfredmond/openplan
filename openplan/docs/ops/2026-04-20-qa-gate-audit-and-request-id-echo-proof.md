# `qa:gate` audit integration + `x-request-id` echo (2026-04-20)

## What shipped

1. **`pnpm audit --prod --audit-level=moderate` added to the `qa:gate` script** in `package.json`. Today's 0-advisory state now fails the gate on regression at moderate-or-higher severity.
2. **`x-request-id` is now set on every response from `src/proxy.ts`** (the Next.js 16 middleware). An inbound `x-request-id` is echoed verbatim; if absent, a `crypto.randomUUID()` is generated. Also set on sign-in redirect responses. The request-header copy is set before `updateSession()` runs so the audit logger's existing `firstHeader(request, ["x-request-id", ...])` lookup at `src/lib/observability/audit.ts:103` picks up the same value that the client sees.

End-to-end effect: a client receives `x-request-id` on every response, can cite it in a bug report, and that ID grep-matches the `requestId` field on every `audit.*` log line for that request. Zero new infra.

## Why this pairing

The request-ID correlation was already shipping server-side — `createApiAuditLogger` reads `x-request-id` / `x-vercel-id` / `x-amzn-trace-id` and falls back to UUID generation, and every emitted log line spreads `...base` (including `requestId`). What was missing was the **client-visible** half: without the response header, a user reporting "I hit an error at 2:14 PM" has to be cross-referenced by timestamp + path + user agent. With the header, the user can paste a single string.

The audit change on `qa:gate` is a tiny structural commit tied to the same session: the dep-patch slice earlier today collapsed advisories from 12 → 0, and this locks that state. `--audit-level=moderate` is picked deliberately — low-severity advisories appear regularly in transitive deps and blocking on them would cause alert fatigue, while moderate-or-higher is the band where pinning/override work actually matters.

## Changes

### `package.json`

```diff
-    "qa:gate": "npm run lint && npm test && npm run build",
+    "qa:gate": "npm run lint && npm test && pnpm audit --prod --audit-level=moderate && npm run build",
```

Order: lint → test → audit → build. Audit runs after tests so a flaky network failure doesn't mask a genuine test failure; runs before build so a build artifact isn't produced on an insecure dependency tree.

### `src/proxy.ts`

- New module constant `REQUEST_ID_HEADER = 'x-request-id'`.
- New `resolveRequestId(request)` helper that reads the inbound header (trimmed, non-empty) or generates a UUID.
- `proxy()` sets the ID on the request headers **before** `updateSession()` so audit logs downstream see the same ID the client will receive.
- Sets the ID on the response in both the allow path and the sign-in redirect path.

The direct mutation `request.headers.set(...)` works because Next.js middleware treats the request-header mutations as a forwarding-layer concern — downstream server components and API routes receive the mutated headers. (This is the same pattern Next.js uses for its own framework-level request threading.)

### `src/test/middleware.test.ts`

Three new cases on top of the existing five:

1. Inbound `x-request-id` is echoed verbatim on the response.
2. No inbound `x-request-id` → response carries a UUID-shaped value (validated with a UUID regex).
3. Redirect path also carries `x-request-id` (verifies the sign-in redirect didn't drop it).

Total: 8 cases covering auth guarding + request-ID threading in one test file.

## Gates

From `openplan/`:

```bash
pnpm exec tsc --noEmit                                     # exit 0
pnpm lint                                                  # 0 warnings
pnpm test -- --run                                         # 174 files · 821 tests · 11.99s
pnpm audit --prod --audit-level=moderate                   # No known vulnerabilities found
pnpm qa:gate                                               # runs all four above + build
```

Net +3 tests (818 → 821), same file count (174).

## Verify in a browser

```bash
pnpm dev &
curl -sI http://localhost:3000/ | grep -i x-request-id
# → x-request-id: <some-uuid>
curl -sI -H 'x-request-id: my-trace-id' http://localhost:3000/ | grep -i x-request-id
# → x-request-id: my-trace-id
```

Then load any authenticated page in the browser, open DevTools → Network → pick any HTML request → Response Headers → confirm `x-request-id` is present. Copy it. Server logs for that request will all carry `"requestId":"<same-value>"`.

## Files

- `openplan/package.json` — `qa:gate` script extended with an audit step.
- `openplan/src/proxy.ts` — request-ID helper + header set on request and response (both allow and redirect paths). 42 → 57 LOC.
- `openplan/src/test/middleware.test.ts` — +3 test cases.

## Not this slice

- **CI pipeline that runs `qa:gate` automatically.** No `.github/workflows` exists; adding GitHub Actions (or Vercel checks) is a platform decision, not an autonomous slice. The `qa:gate` script is a local discipline until then.
- **Pass the request ID through as a structured field on all response bodies.** The header is enough for correlation; bodies stay schema-stable.
- **Propagate the request ID to Supabase queries / Anthropic calls / outbound HTTP.** Supabase doesn't expose a per-query tracing hook; the Anthropic SDK doesn't forward tracing headers. Downstream propagation is a separate slice.
- **Replace `crypto.randomUUID()` with a nanoid / ULID for sortable correlation IDs.** UUID v4 is sufficient for lookup-by-exact-match; ordering isn't needed for this use case.

## Pointers

- Prior slice (telemetry): `docs/ops/2026-04-20-anthropic-telemetry-proof.md`
- Prior slice (dep CVEs): `docs/ops/2026-04-20-dependency-cve-patch-proof.md`
- Audit logger that reads the ID: `src/lib/observability/audit.ts:101-114`
- Middleware (Next.js 16 `proxy.ts` convention): `src/proxy.ts`
