# Errors

## [ERR-20260408-001] codex-cli-missing

**Logged**: 2026-04-08T22:06:10Z
**Priority**: high
**Status**: pending
**Area**: config

### Summary
Attempted to delegate the OpenPlan redesign pass to Codex, but the local `codex` CLI is not installed in this environment.

### Error
```text
/bin/bash: line 1: codex: command not found
```

### Context
- Command attempted: `codex exec --full-auto ...`
- Working directory: `/home/narford/.openclaw/workspace/openplan/openplan`
- Task: multi-file UI refactor / redesign pass

### Suggested Fix
Install and configure the Codex CLI before relying on the coding-agent delegation path in this environment, or fall back directly to local file edits when the binary is unavailable.

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md

---

