# OpenPlan Restore Drill Approval Intake

**Date:** 2026-05-01
**Status:** Superseded by completed drill log; see `2026-05-01-openplan-restore-drill-staging-supabase.md`
**Audience:** Nathaniel Ford Redmond and trusted OpenPlan operators
**Related preflight:** `2026-05-01-openplan-restore-drill-preflight-plan.md`
**Related approval packet:** `2026-05-01-openplan-restore-drill-approval-packet.md`

## Intake Summary

Nathaniel sent approval intent in chat: "I approve. Please continue."

That is enough to continue non-mutating preparation, but it does not satisfy the approval packet's required mutation gate because it does not name a staging Supabase target, source restore point, operator, mutation window, cleanup posture, or evidence log path.

At intake time, no Supabase cloud command, project link, restore, dump import, storage replay, service-role staging inspection, cleanup, Vercel mutation, billing mutation, email operation, or secret operation had been run from this approval intake. The later completed staging drill is logged separately in `2026-05-01-openplan-restore-drill-staging-supabase.md`.

## Dry-Run Checks Completed

- PASS: Confirmed `openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md` exists and contains the drill-log template.
- PASS: Confirmed `docs/ops/2026-05-01-openplan-release-to-sale-plan.md` still keeps the first quarterly restore drill unchecked.
- PASS: Confirmed existing restore-drill docs are limited to the preflight plan, approval packet, and this intake note; no completed dated drill log existed before this note.
- PASS: Confirmed the preflight and approval packet require explicit written approval naming the target, source restore point, operator, window, cleanup posture, and evidence log before mutation.
- PASS: Confirmed this note commits only sanitized process evidence and no project refs, tokens, dashboard URLs, backup ids, raw customer data, or service-role output.

## Missing Required Fields

The actual staging restore drill remains blocked until the approval names:

- staging Supabase target: private project name or alias, with the project ref recorded privately and verified not to match production;
- source restore point: backup id, dump path, or PITR timestamp;
- operator: named trusted operator;
- mutation window: date, time, and timezone;
- cleanup posture: wipe, restore baseline, retire project, or retain until a named date;
- evidence log: `docs/ops/YYYY-MM-DD-openplan-restore-drill-<slug>.md`;
- service-role inspection scope, if staging inspection queries are authorized.

## Required Approval Text For Mutation

Use this shape before any cloud operation:

> I approve the first OpenPlan staging restore drill for staging target `<project name or private alias>`, source restore point `<backup id or timestamp>`, operator `<name>`, mutation window `<date/time/timezone>`, cleanup posture `<wipe | restore baseline | retire project | retain until date>`, and evidence log `docs/ops/YYYY-MM-DD-openplan-restore-drill-<slug>.md`. Production Supabase, Vercel production, billing, email, customer, auth-session, and secret operations remain out of scope. Service-role inspection against staging is `<approved | not approved>`.

## Release-To-Sale Status

SUPERSEDED: this intake did not complete the restore-drill release gate. The later staging drill log records the approved target, validation, cleanup, and PASS result.
