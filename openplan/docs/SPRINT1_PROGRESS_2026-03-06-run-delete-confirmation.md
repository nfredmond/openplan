# Sprint 1 Progress — 2026-03-06 — Run Deletion Safety Guard

## What shipped
Implemented a low-risk safety improvement for run deletion in OpenPlan:

1. **Server-side confirmation gate** on `DELETE /api/runs`
   - Deletion now requires `confirm=true` in the request query string.
   - Requests missing explicit confirmation return `400` with a clear error.
   - This reduces accidental or malformed destructive requests.

2. **Client UX confirmation + in-flight protection** in `RunHistory`
   - Users now see a browser confirmation prompt before deleting a run.
   - Delete action sends `confirm=true` only after user approval.
   - Delete buttons are disabled during in-flight deletion to prevent duplicate clicks.

3. **Route auth test coverage expanded**
   - Added a test asserting `400` when explicit confirmation is missing.
   - Updated existing delete authorization tests to include `confirm=true`.

## Why this matters
- Improves **operational safety** for a destructive action.
- Keeps deletion behavior explicit and auditable at API boundaries.
- Prevents accidental double-delete attempts from rapid repeated clicks.
