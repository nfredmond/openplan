# OpenPlan public-surface Opus 4.7 review packet

Date: 2026-04-27
Lane: public positioning / open-source-first + services model
Reviewer requested: Opus 4.7 UI/UX + public copy review

## Review status

Prepared for a separate Opus 4.7-style review. A direct local attempt was made with:

```bash
openclaw infer model run --model anthropic/claude-opus-4-7 --prompt "$(cat /tmp/openplan-opus-review-prompt.txt)"
```

The attempt was blocked by local OpenClaw tool/provider execution configuration:

```text
No callable tools remain after resolving explicit tool allowlist
```

Do not treat the implementation as having received a completed Opus 4.7 review until that reviewer or an equivalent configured design/copy lane has run.

## Surfaces touched

- `openplan/src/app/(public)/page.tsx`
- `openplan/src/app/(public)/pricing/page.tsx`
- `openplan/src/app/(public)/request-access/page.tsx`
- `openplan/src/app/(public)/legal/page.tsx`
- `openplan/src/app/(public)/terms/page.tsx`
- `openplan/src/app/(public)/layout.tsx`
- `openplan/src/app/(public)/examples/page.tsx`
- `openplan/src/components/top-nav.tsx`
- `openplan/src/app/(auth)/sign-up/page.tsx`
- `openplan/README.md`
- `README.md`
- `LICENSE-NOTICE.md`
- `CONTRIBUTING.md`
- `SECURITY.md`

## Positioning intent

OpenPlan should read as Apache-2.0 open-source planning software with paid Nat Ford services around it:

- managed hosting and workspace administration;
- onboarding, implementation, and training;
- support retainers and operational QA;
- planning services for RTP, ATP, grants, engagement, and project-list workflows;
- custom extensions, integrations, reports, and AI-assisted workflow buildouts.

Billing/subscription mechanics remain because hosted workspaces need payment, entitlement, usage, and support infrastructure. Copy should make clear that this does not convert the open-source core into a proprietary software license.

## Required review criteria

### Verdict

Determine whether this checkpoint is safe to ship after code validation, or whether copy/UI changes are required first.

### Must fix

Look for blockers in:

- closed SaaS/subscription-first framing;
- implied automatic provisioning;
- unsupported planning-grade claims;
- confusing `pricing` route vs `Services` label;
- license boundary ambiguity;
- hosted billing language that appears to narrow Apache-2.0 rights;
- CTA mismatch between `self-hosted`, `managed-hosting`, and `implementation` lanes.

### Should fix

Look for refinements in:

- public agency clarity;
- CTA hierarchy;
- wordiness or excessive operational caveats;
- repeated use of `supervised` where `managed service` or `services review` would be clearer;
- visible consistency between nav, footer, landing, service lane, request-access, legal, terms, privacy, examples, and sign-up.

### Copy notes

Check whether the core message is clear:

> OpenPlan is Apache-2.0 open-source planning software. Nat Ford Planning earns revenue by operating hosted workspaces, onboarding teams, supporting planning workflows, providing planning services, and building custom extensions.

### UX notes

Check whether the public surface feels like a serious civic planning workbench rather than a generic AI SaaS landing page. Prefer dense, operational hierarchy over decorative card sprawl.

## Local validation already completed

```bash
npm test -- src/test/pricing-page.test.tsx src/test/request-access-page.test.tsx src/test/request-access-form.test.tsx src/test/access-request-route.test.ts src/test/admin-operations-page.test.tsx src/test/access-requests-migration.test.ts
npm run lint
npm run build
```

Results:

- 6 targeted test files passed.
- 27 targeted tests passed.
- ESLint passed.
- Next.js production build passed.

## Browser/text spot check

Local URL checked with OpenClaw browser at:

- `http://127.0.0.1:3010/pricing`

Observed:

- Nav label: `Services`
- H1: `Open-source planning software, with managed hosting and implementation help when teams need it.`
- Footer label: `Services`
- Footer posture: `Open-source planning software with managed services for teams that need traceable work, not dashboard theater.`

## Exact identifiers preserved for audit trail

- `100644`
- `/lib/http/body-limit`
- `/lib/observability/audit`
- `@/lib/http/body-limit`
- `@/lib/observability/audit`
- `20260427000078_access_request_service_pipeline.sql`
- `20260424000074_access_requests.sql`
- `20260424000075_access_request_intake_hardening.sql`
- `20260424000076_access_request_review_events.sql`
- `20260424000077_access_request_provisioning_link.sql`
- `/sign-up?plan=starter`
- `/sign-up?plan=professional`
- `/request-access?lane=self-hosted`
- `/request-access?lane=managed-hosting`
- `/request-access?lane=implementation`
- `/pricing`
- `/request-access`
- `/legal`
