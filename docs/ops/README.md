# Technical records index

Files in this directory are dated evidence: they preserve what was observed,
tested, accepted, or rejected at the time. They are not the development queue
and should not be rewritten to match current behavior.

Current sources of truth:

- `docs/ROADMAP.md` — the only active development queue.
- `CHANGELOG.md` — shipped operator-visible behavior and migration order.
- `openplan/docs/SELF_HOSTING.md` — current operating instructions.
- `openplan/docs/ops/BACKUP_AND_RESTORE.md` — current recovery procedure.
- `docs/ops/KNOWN_ISSUES.md` — current quality boundaries and recovery cadence.
- `docs/ADRs/` — durable architecture decisions.

## Evidence groups

- Modeling architecture and specifications: the March 2026 engine, network,
  zone, corridor, worker, skim, and evidence records.
- Modeling validation: dated Nevada and Placer screening studies, later
  nationwide count evidence, rejected candidates, and calibration results.
  Negative results remain evidence and do not become future work by default.
- County validation onramp: the March contract records and May proof UI.
- Planning and legal provenance: stage-gate, reimbursement, plan, adoption, and
  jurisdiction source records.
- Release and browser proof: dated local smoke, first-week, RLS, mutation,
  build, and release evidence.

Git history is the archive for deleted implementation queues. ADR-004 preserves
the MCP server decision; MCP/Buzz scheduling lives only in the canonical
roadmap.
