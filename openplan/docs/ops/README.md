# Application operations records

Two kinds of file live here, and confusing them is how a stale record becomes a
plan.

## Current — read these to operate a deployment

| File | What it is for |
|---|---|
| `RUNBOOK.md` | Operating a live deployment: health checks, common failures, what to do about them. |
| `BACKUP_AND_RESTORE.md` | The recovery procedure, and the drill that proves it (`npm run ops:restore-drill`). |

The rest of the current operating documentation is one directory up:
`../SELF_HOSTING.md`, `../FIRST_DEPLOYMENT.md`, `../PLAIN_WORDS_FEWER_BOXES.md`,
`../READING_AN_ADOPTED_PLAN.md`.

## Dated evidence — read these only to find out what was true then

Everything with a date in its name is a record of what was observed, tested,
accepted, or rejected on that date. **None of it is a queue, and none of it may
be rewritten to match current behavior.** The active queue is
`../../../docs/ROADMAP.md`; the quality register is
`../../../docs/ops/KNOWN_ISSUES.md`.

By period, as of 2026-08-25:

| Period | Count | What it covers |
|---|---|---|
| 2026-03 | 1 | Earliest application-side record. |
| 2026-04 | 95 | The build-out era: phase and slice proofs, RLS and multi-tenant audits, cartographic shell, modeling evidence backbone, monitoring foundation. |
| 2026-05 | 4 | Provenance trust labels, URL canonicalization, deep-link and guardrail release evidence. |
| 2026-08 | 5 | First-week readiness closure and work list, jurisdiction closure, v0.33/v0.34 release proofs. |

**These files are deliberately not moved into an `archive/` subdirectory.**
Several are cited by path from shipped code and from `COMMENT ON POLICY`
statements inside applied migrations. A migration is history: rewriting one to
chase a moved file would falsify a shipped record, and leaving the citation
dangling would be worse. The index above is the navigation; the paths stay
where the citations point.
