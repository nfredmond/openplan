# OpenPlan V1 Auth / Access Evidence Note

**Date:** 2026-03-15  
**Owner:** Iris Chen (engineering lane)  
**Status:** PARTIAL PASS — route/API guard posture tightened and validated; production auth smoke still pending

## Scope
This pass refreshed evidence for:
- sign-in and protected-route behavior
- representative protected API behavior
- membership / role enforcement posture
- known remaining auth/access gaps

## What Landed in This Pass
### 1) Protected route coverage was tightened
The previous proxy guard only redirected unauthenticated traffic away from:
- `/dashboard`
- `/workspace`

That left the real Option C app surface (`/projects`, `/plans`, `/programs`, `/models`, `/reports`, etc.) under-protected at the edge.

**Fix landed:**
- `openplan/src/proxy.ts`
  - expanded protected-route coverage to:
    - `/dashboard`
    - `/workspace`
    - `/projects`
    - `/plans`
    - `/programs`
    - `/models`
    - `/scenarios`
    - `/explore`
    - `/data-hub`
    - `/reports`
    - `/engagement`
    - `/billing`
    - `/admin`
  - redirect now preserves the full requested path + query string in `?redirect=`

### 2) App-shell routes now have a server-side auth backstop
- `openplan/src/app/(app)/layout.tsx`
  - now checks `supabase.auth.getUser()`
  - redirects unauthenticated requests to `/sign-in`

This gives the app two layers of protection:
1. proxy redirect before route handling
2. server layout redirect inside the protected route group

### 3) Sign-in now respects the requested return path
- `openplan/src/app/(auth)/sign-in/page.tsx`
  - reads `redirect` from search params
  - returns users to the originally requested protected route after successful sign-in
  - falls back to `/dashboard` if the redirect target is missing or unsafe

## Representative API Verification
### Verified patterns
The reviewed API surface consistently uses this posture:
1. call `supabase.auth.getUser()`
2. return **401** when unauthenticated
3. for sensitive detail/write routes, resolve workspace membership
4. enforce permissions through `canAccessWorkspaceAction(...)`
5. deny unsupported roles by default

### Representative evidence reviewed
- `src/app/api/plans/[planId]/route.ts`
- `src/app/api/programs/[programId]/route.ts`
- `src/app/api/models/[modelId]/route.ts`
- `src/app/api/billing/checkout/route.ts`
- `src/app/api/runs/route.ts`
- `src/lib/auth/role-matrix.ts`

### Role enforcement posture
`src/lib/auth/role-matrix.ts` currently defines:
- `owner`
- `admin`
- `member`

With deny-by-default behavior for:
- unknown actions
- unsupported roles
- missing / malformed role values

Notable restriction already present:
- `billing.checkout` is limited to **owner/admin**

## Validation Run
### Targeted tests passed
```bash
npm test -- --run \
  src/test/middleware.test.ts \
  src/test/model-detail-route.test.ts \
  src/test/plan-detail-route.test.ts \
  src/test/program-detail-route.test.ts \
  src/test/runs-route-auth.test.ts \
  src/test/billing-checkout-route.test.ts \
  src/test/op001-role-matrix-conformance.test.ts
```

Result: **7 files passed / 27 tests passed**

### Additional validation passed
```bash
npm run lint
npm run build
```

Result: **passed**

## Known Gaps
### Gap A — Production auth/session smoke still not re-run here
This pass did **not** complete a real browser-authenticated production smoke against deployed records. That means cookie/session behavior on the live domain still needs direct confirmation.

**Impact:** closure evidence is strong in code/test posture, but not yet final from a production-trust standpoint.

### Gap B — Some list surfaces still rely on RLS more than explicit membership UX
Several list/page surfaces primarily rely on authenticated Supabase access and database scoping rather than always returning an explicit "no workspace membership" denial state.

**Impact:** an authenticated user without a usable membership may encounter empty/default states instead of a more explicit access-resolution flow, depending on route and data shape.

### Gap C — Role model remains coarse
There is still no dedicated read-only/viewer role in the current matrix.

**Impact:** current posture is simple and safer than an under-specified viewer role, but it is not yet nuanced if pilot customers need read-only reviewers.

## Mitigations in Place
- Protected app routes are now explicitly guarded in proxy and layout.
- Redirect continuity is now preserved through sign-in.
- Detail/write APIs continue to use membership + role checks.
- Billing remains owner/admin only.
- Deny-by-default role matrix behavior is already covered by regression tests.

## Production Smoke Prep Checklist
To reduce friction for the remaining authenticated production smoke, use this checklist:
1. Open an incognito window on production.
2. Request `/projects` or `/plans` directly while signed out.
   - Expected: redirect to `/sign-in?redirect=...`
3. Sign in with a real workspace user.
   - Expected: return to the originally requested route, not always `/dashboard`
4. Open `/models`, `/plans`, `/programs` and one real detail record in each.
5. Confirm no guest shell renders on protected routes.
6. If a route fails, capture:
   - URL
   - record id
   - redirect behavior
   - visible error state
   - whether the failure is auth, membership, or data-loading related

## Bottom Line
**Auth/access posture is materially stronger after this pass.**

Honest v1 statement right now:
- **Protected route coverage: improved and validated locally**
- **Representative API auth/role enforcement: verified in code/tests**
- **Live authenticated production confirmation: still pending**
