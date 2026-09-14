# Empty history must still enforce staff access

The first native history-reader mutation widened its staff check to include
viewers. The test unexpectedly survived. Its populated history reached the
nested private context reader, which still refused that viewer with `42501`.
That did not prove the new history reader's own access boundary.

An empty history has no nested context call and still returns eligible project
decisions, including private rationale. The native test now checks both empty
and populated histories for viewers and outsiders. The same weakened-reader
mutation now fails the empty-history refusal assertion. Anonymous and service
execution grants are independently tested with a real staff subject set.

No production permission was widened. The mutation and fixtures ran inside
rolled-back transactions on the explicitly isolated application test database.
The first surviving result was observed in the tool run; its per-case logs were
superseded by the corrected run. `decision-history-results.json` records only
the final test and source hash. This note preserves the earlier contrary result.

The first TypeScript test-file creation also used a repository-relative path
while already inside the application package. The write failed, and Vitest
reported no tests found. The corrected package path produced the actual tests;
that earlier command is not passing evidence. A later ESLint glob treated the
route's square brackets as glob syntax and found no files. Use explicit existing
paths or the ordinary whole-package lint command instead.
