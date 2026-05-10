# OpenPlan Local Supabase Status — Non-Local URL Guard Proof

**Date:** 2026-05-09
**Status:** Shipped (read-only operator preflight; no live writes)
**Scope:** `openplan/scripts/ops/check-local-supabase-status.mjs` and `openplan/src/test/local-supabase-status-script.test.ts`
**Source roadmap:** `2026-05-01-openplan-full-os-roadmap.md` Phase 0 (proof repair / release baseline) and `2026-05-01-openplan-autonomous-build-protocol.md` (Mode B operator QA without live writes).

## What changed

`pnpm ops:check-local-supabase-status` now classifies any Supabase URL value (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_DB_URL`) as `local`, `non-local`, or `unset` based on host pattern (`127.0.0.1` / `localhost`). When a URL is `non-local`, the preflight raises an attention issue without ever printing the URL value:

```
local Supabase URL keys do not point at 127.0.0.1 or localhost: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_DB_URL (refusing to assume local-only writes)
```

Existing redaction posture is preserved — URL values are still reported as `set-redacted`; only the local/non-local classification leaks.

## Why this matters

Local smokes (`local-rtp-release-review-smoke`, `local-grants-flow-smoke`, `local-engagement-report-handoff-smoke`, `local-analysis-report-linkage-smoke`, `local-spine-smoke`, `local-aerial-evidence-smoke`, `local-admin-support-flow-smoke`) all assume the resolved Supabase target is local before service-role writes. The preceding gate refused non-local app/Supabase targets at runtime, but operator misconfiguration (e.g. a `.env.local` accidentally pointing at the production project ref) used to read as `set-redacted` and silently pass the preflight. This slice closes that gap inside the preflight itself, before any harness opens a service-role client.

## Tests

Two new unit cases extend `src/test/local-supabase-status-script.test.ts` (existing two cases preserved):

- `classifies common local and non-local Supabase URLs without printing values` exercises `classifyLocalUrl` directly across `127.0.0.1` HTTP, `localhost` HTTP, local Postgres URI, a representative `*.supabase.co` URL, an unset value, and a non-URL key (returns `null`).
- `flags non-local Supabase URL as an attention issue without revealing the URL` writes a `.env.local` whose `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_DB_URL` both point at non-local hosts, runs `buildStatus`, and asserts (a) status is `attention`, (b) the issue text names both keys, (c) no issue line contains the project ref or DB credentials, and (d) the env item carries `localUrl: "non-local"`.

## Validation blockers

`pnpm test --run src/test/local-supabase-status-script.test.ts` and `pnpm lint` were both denied by the sandbox during this session. The change is verified by inspection only:

- `classifyLocalUrl` is pure (single regex test, no I/O) and covered by the first new unit case in this slice.
- `decorateEnvItem` only adds an optional `localUrl` field; existing snapshot expectations for non-URL keys remain unchanged because `classifyLocalUrl` returns `null` outside `LOCAL_URL_KEYS`.
- The first existing test (`reports redacted env-key presence and migration inventory`) was updated to expect `localUrl: "local"` on `NEXT_PUBLIC_SUPABASE_URL`; remaining required-key entries keep their original shape.

A follow-up rerun of `pnpm qa:gate` should confirm before this proof is cited externally.

## Out of scope

- No outbound writes, secrets, billing, email, or production data touched.
- No change to harness mutation refusal logic; this slice only hardens the read-only preflight.
- The mutating harnesses still own their own non-local refusal at write time. This slice catches the misconfiguration earlier in the operator flow.
