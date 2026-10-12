# Two-month review and plan to v1, October 11 and 12, 2026

Nathaniel asked for a full code review, a look at every pull request and agent
session from August 11 to October 11, 2026, a check of whether the roadmap was
kept current, and a plan to v1 and beyond. Claude Code (Opus 5.5, with Opus 5.5
and Haiku 5.5 subagents) did the work read-only against `origin/main` at
`c735abec3`, then rechecked at `c03788c` after the hosted review fixes in PR 235.

- [PLAN.md](PLAN.md): findings, module grades, and the staged plan to v1.
- [BACKLOG.md](BACKLOG.md): 487 itemized findings by module with file, line,
  severity and source. Rows came from the reports below; verify each before
  fixing, because many come from reading code rather than running it.
- [reports/](reports/): eleven review reports (pull requests by range,
  frontend, backend, workers, infrastructure, tests and guards, module map,
  documentation audit).

Four further reports summarized Nathaniel's Claude Code and Codex sessions.
They quote private conversations and stay outside the repository.

Nothing here changes a capability grade, a milestone or the v1 contract. The
open defects that affect planners, money, public input or a scientific claim
are registered in [KNOWN_ISSUES](../../ops/KNOWN_ISSUES.md) under "Review
findings open on main, October 12, 2026".
