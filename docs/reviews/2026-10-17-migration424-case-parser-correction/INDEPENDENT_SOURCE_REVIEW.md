# Migration 424 CASE parser source review

Source disposition: accept the two-parentheses correction for the reported compiler defect. Native compilation remains untested. This review does not accept migration application, guard behavior, RLS, restore, browser operation, hosted operation, or release.

## Exact source and ownership

The T3 binding identifies `/home/nathaniel/.t3/worktrees/openplan/t3-51ead15c`, branch `t3/migration424-case-parser-review`, clean starting head `05dd3e8da4a4572437f06e771b0a2477873e681f`. Only this new review directory and the new private state root below belong to this reviewer. No nested agent, migration edit, commit, Docker invocation, PostgreSQL invocation, or subject import occurred.

The root checkout is data at `/home/nathaniel/.local/state/openplan/project-budget-reviewed-combined-20261016`. Its committed head is `0895af82f4bf23c327d50e7c17e98b445580807e`; its committed application tree is `42fc0315070f31269325acb264f0260723dbd56b`. Root subsequently edited only the migration. The reviewer compared that working file against the exact committed source, rather than this review checkout's canonical source.

Migration: `openplan/supabase/migrations/20261017014010_land_use_plan_context_geography.sql`, line 58.

- Original: 6,500 bytes, SHA-256 `b083241e879913afe93e848f4bb81191acf5439569c8226a86e14852bf3ee002`.
- Root fixed: 6,502 bytes, SHA-256 `1c0e7cf422b0668d8ebcb9ef29df87a88f3ee6e69498b9c88012bdaf90c42947`.
- Exact difference: insert `(` immediately before CASE and `)` immediately after its END. All other bytes remain equal. No RLS, grant, history, trigger definition, function attributes, literals, operators, or branches change.

## Independent parser finding

The original IF condition contains a searched SQL CASE. Its inner THEN appears after the IN-list parentheses close, at parenthesis depth zero. PostgreSQL's IF expression reader therefore terminates there. It submits an incomplete CASE expression to the SQL parser. Enclosing CASE in parentheses keeps the inner THEN below the terminating depth; the reader reaches the intended outer THEN. This explains the saved diagnostic and supports the exact correction. [PostgreSQL REL_17_6 grammar](https://github.com/postgres/postgres/blob/REL_17_6/src/pl/plpgsql/src/pl_gram.y)

The retained raw source identifies `stmt_if` at line 1167, `expr_until_then` at 2410, `read_sql_expression` at 2637, the depth-zero terminator at 2707, depth tracking at 2713–2720, and SQL validation at 2781–2782. Its SHA-256 is `bc04d4b6329c0e9d8ce76d3cad4e63b6361beb55b10b76fa01ebb51f853c8283`. The grouping preserves the intended 180/90 threshold expression; this source conclusion is not a native behavioral test.

CI run `39016643937`, job `117350013879`, records failure at statement zero while creating this function. The retained log is 122,871 bytes and SHA-256 `ef85b37dd0973e0d9f2148b78d582ca97280769aaa94631b207972520d9838ff`. The reviewer checked those bytes and JOB.json's failed conclusion and head. The log records SQLSTATE `42601`, message `syntax error at end of input`, and the original line. [Saved job's public location](https://github.com/nfredmond/openplan/actions/runs/39016643937/job/117350013879)

The function cannot compile at migration 424, so a later migration cannot repair that earlier compilation step. The task owner states 424 remains unreleased and unapplied outside CI. This reviewer did not query installation history to independently establish that boundary.

## Prepared artifacts and limits

Private root: `/home/nathaniel/.local/state/openplan/migration424-case-parser-review-20261017`, mode 0700. `SOURCE_PINS.json` records hashes. `inputs/` contains four full migration variants, `compiler.sql`, and `container-compile.sh`. Inputs are read-only and readable by the image account; the enclosing host directory remains private. Original CI evidence is unchanged. No predecessor history, candidate fixture, admission record, or old test campaign is reused.

[Native plan](NATIVE_PLAN.md) defines the finite test. Harmless-first, fixed, exact-original failure, and restored outcomes are expectations, not observed results. The SQL and shell have not run. Root must review the short owning controller and authorize its invocation separately. There is no CI rerun, watcher, main update, hosted operation, or release action in this review.
