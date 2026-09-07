# Correction work reported after independent findings

The root agent reported a funding-period correction after receiving this review's finding. The planned behavior keeps invalid/reversed periods editable and unresolved for draft recovery, makes non-covering proposed fund availability/revenue/match unresolved, and adds matching workbook guards. A separate implementation reviewer will verify it. This is reported implementation intent, not acceptance by reviewer B.

The calculator reproduction ran against the reconciliation file before it appeared modified in git status, at base commit 9f4730b3bbaff0848c9865e2e0188c91babd930d. The final source-identity.json was collected later while the root was editing the correction. Its hashes identify the final working-tree snapshot, not the earlier reproduction bytes. The original independent report remains unchanged. Read its funding defect as a reproduced pre-correction finding, pending separate verification of the later fix.

Repository status changed during this review because the parent and other authorized reviewers were working. Reviewer B wrote only the assigned scratch directory and ran one in-memory calculator diagnostic. No browser, service, database, or git mutation was performed.
