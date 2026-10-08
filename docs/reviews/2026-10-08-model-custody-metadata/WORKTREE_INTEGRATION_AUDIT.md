# Worktree integration audit

Snapshot: 2026-10-08T07:32:13.601947+00:00. Fetched GitHub main: `37e69c94f2e73e5a20234066e6f28e2be35a5c2e`.

All 69 registered worktrees were inspected with `git status --porcelain` and exact-head ancestry checks. Sixty-six heads are ancestors of remote main. Three remain outside main in the active integration stack. The canonical checkout has one untracked `.directory` file and remains 31 commits behind remote main. No worktree was reset, deleted or advanced during this audit.

A separate `git rev-list --branches --not --remotes --count` returns zero. This checks reachability of every local branch commit on fetched remote references, not merely the existence of a similarly named remote branch. Seven local branch tips remain outside main: the six PR layers #152 through #157 and the type-correction branch incorporated into #155. All are pushed. The frozen QA checkout remains at db92ca1b while its remote branch includes correction c800c6bd.

The `fix/evidence-ci-20261007` remote branch is absent, but its local head is already an ancestor of main. The detached translation-resolution checkout is also an ancestor of main. Neither contains an unpushed branch commit. T3 retains 305 local checkpoint references outside the source branch namespace. They remain local recovery records; this audit does not publish or remove them or claim to review every historical checkpoint payload. Ignored data, dependencies and private evidence are outside Git status and are not asserted to be backed up by GitHub.

This audit establishes source custody at the snapshot, not release readiness. PR #155 corrected-head CI and earlier local QA are running. PRs #156 and #157 remain stacked. Browser capture, practicing-planner acceptance and nationwide scientific acceptance remain incomplete. The product-direction check passes with registry and capability review reminders; those reminders are not new evidence that the registries are current.

## Registered worktrees

| Worktree | Exact head | In remote main | Working changes |
|---|---|---|---|
| `openplan` | `565cd983c7e101910eba3da091334a3e5c7bd350` | Yes | Untracked .directory |
| `agent-hold-receipts-2026-09-10` | `e006b98bd8aeedbde48a74bec2169e1f1d01c9ad` | Yes | None |
| `assistant-audit-outcomes-2026-09-10` | `d87a04d4271ee7e46e21d09e4fc63cd3fec6f5b3` | Yes | None |
| `award-acceptance-20261007` | `15e22c220a75ffbf6085960e64ce9ff1c392fecf` | Yes | None |
| `award-obligation-custody-20261007` | `4e0392435457248f9f3f38c45daae59ed0caeb92` | Yes | None |
| `award-obligation-review-20261007` | `db92ca1bc80a36cdb20f5fcc3f28fa24e3bb5fe3` | No | None |
| `award-reopen-choice-20261007` | `431c8927b21dbf0b1adcbae2706c269729543be9` | Yes | None |
| `bca-workbench-20261006` | `ff3d2d2d895fa42c6e1b7b388bbfed87a86ba774` | Yes | None |
| `contract-reconciliation-2026-09-07` | `76f019bfb80300434c23273db07c43610cbf1625` | Yes | None |
| `dependency-patch-2026-09-10` | `5d7ccdb067bb4db639132889f8efd5db160dfc6b` | Yes | None |
| `engagement-complete-case-20261006` | `2276b4d23563f8eb79aab6cdbe0099ed2dda4934` | Yes | None |
| `engagement-context-handoff-20261007` | `21b1f86adf3bb437032f7cc19af5525d2de08655` | Yes | None |
| `engagement-evidence-refocus-20261007` | `792873761afe20beaf8f0342d9f292778e496f0b` | Yes | None |
| `engagement-execution-controls-20261006` | `c91d68136f927e14339eef694ab9c47f628c795c` | Yes | None |
| `engagement-execution-progress-20261006` | `bd292640a7b50a79370adc0ba9350df96d62306d` | Yes | None |
| `engagement-export-source-labels-20261007` | `f5e4aa1dbf3d4edfd994f9d4f529f45273e9842a` | Yes | None |
| `engagement-first-workflow-2026-09-06` | `860260baa7a84ceacd354d12006fa9d503721037` | Yes | None |
| `engagement-form-recovery-20261006` | `00b849e75a3145f1f99d701520bfeddc3ffe18c8` | Yes | None |
| `engagement-handoff-target-refresh-20261007` | `c255dd49b9f7a3b63e527a81ecd5a1b10246a179` | Yes | None |
| `engagement-main-integration-20261007` | `359ab99204b2afd8ce3c3773092ebe7be3937ab4` | Yes | None |
| `engagement-response-writes-2026-09-12` | `88fb20b619f9108c29c7102ca20fb6423f553e45` | Yes | None |
| `engagement-review-status-labels-20261007` | `57a9f1d35c79d8a800e58d78dda94053b88228ec` | Yes | None |
| `engagement-thematic-inputs-20261007` | `a76bfc94b8014cfdf387eedf84a9a3578352fdb3` | Yes | None |
| `engagement-write-recovery-2026-09-12` | `3f70af98e6fb06b4c0f932769e10f880711d46ec` | Yes | None |
| `evidence-ci-20261007` | `92894d9168be32ea653e9afd7fb68a7480aa1197` | Yes | None |
| `explicit-agent-consent-2026-09-10` | `4d02130b24c7b83ff9111c3bbe058fdfe7f67b86` | Yes | None |
| `independent-fixes-20261001` | `ca3e442cdfd11441247a7df2e3461cf665240d91` | Yes | None |
| `independent-review-20261001-01` | `3072fc155a5c48134646def8a70c2e73d7817385` | Yes | None |
| `land-use-creation-20261007` | `dfada38fac4122d50d075c4f1c5211db18b79efc` | Yes | None |
| `land-use-frozen-rules-20261007` | `d6b5eb3744eca3d30a70f71168b922bd12442784` | Yes | None |
| `land-use-plan-authority-20261007` | `f4eb8a969f90bd0f9af46ec335d2f18fc274b349` | Yes | None |
| `land-use-plan-context-20261007` | `5a2679b01fbe33742b91825e758f3a13474addf1` | Yes | None |
| `land-use-plan-kinds-20261007` | `3e2df7b64fbb62f5620780cbe16c7fb3a361808c` | Yes | None |
| `land-use-report-transaction-integration-20261007` | `b3a03990b9c33f68774472fccc162ceaaff36bcd` | Yes | None |
| `local-font-build-20261006` | `48c52f036f6c4fb76b4bf0f652f162921ab813fa` | Yes | None |
| `m11-delivery-closeout-2026-09-08` | `5850d63e99b755f5c2da2ca930ae67768a5f25d4` | Yes | None |
| `m2d3-reimbursement-2026-09-09` | `88de2d23ff174de8ef7bcf1eeeb76a47d656a1a0` | Yes | None |
| `m2d4-closeout-review-2026-09-09` | `8015a05f15028387e56fcbe952639c23c7f01d9b` | Yes | None |
| `m2d4-multi-carryover-2026-09-09` | `3a752db6c7c249c45fa245530f4b52fda6a54251` | Yes | None |
| `m2d4-period-closure-2026-09-09` | `b0c6c05854a7bef44d1440ef5ed89621332b63e7` | Yes | None |
| `m2d4-refund-matching-2026-09-09` | `609347ade35418765b459c8ba1b6bdb2a07cff2d` | Yes | None |
| `m2d4-settlement-2026-09-09` | `5dffba4bc4813cdee6ac17825b45aa4b629768a2` | Yes | None |
| `october-integration-20261006` | `3e106c566d9d6b21ce3c04d068dea803ece1956c` | Yes | None |
| `owp-full-recovery-2026-09-09` | `051b735fa444fab5287357b30dc2eaafe6783bcf` | Yes | None |
| `owp-preparation-2026-09-06` | `398d8f0df8178cf4c56eca21110c09e139c4d60d` | Yes | None |
| `owp-reporting-2026-09-07` | `dfdb9845974ad870db159a0576eedbb087a38150` | Yes | None |
| `owp-review-2026-09-07` | `e204cdeeaffdf3ac8fca51c067c0c4e38e1a9814` | Yes | None |
| `planner-action-followup-recovery-2026-09-10` | `3ffd2a415f6561cfb37f52e2ce1eeef251522db5` | Yes | None |
| `project-calendar-dates-20261007` | `443e8e6ef797a8bc94bd16be261f3e2a83de8066` | Yes | None |
| `project-engagement-evidence-20261007` | `4e72fb85b0520afeb0c5a5150ccbd7cc28e925a5` | Yes | None |
| `published-model-custody-20261007` | `d1c46c2e70b10b0918abacd6594f88f6e4ca97de` | Yes | None |
| `scientific-ingestion-review-20261008` | `f3100e3ef716ae1fcefedea005772731ac488dcd` | No | None |
| `synthesis-execution-queue-20261007` | `db48f48da592e82305806320b48046cb97599c94` | Yes | None |
| `synthesis-history-ui-20261006` | `b720ba36182213efc98d8b1b975d89da81c77a70` | Yes | None |
| `synthesis-native-output-types-20261008` | `c800c6bd39045c2310af4679dbd3124135648f0b` | No | None |
| `synthesis-resource-assessment-20261007` | `dcbf63c8cb9432235ef37b50678b32e0d65d8a38` | Yes | None |
| `synthesis-staff-generation-2026-10-02` | `9775ab5314dd09a05738163eea0d6632ff8e58bd` | Yes | None |
| `synthesis-supervision-20261007` | `d2f92dcc82a9e01f7171c4d1ce65a05de284ef98` | Yes | None |
| `thematic-import-ui-2026-10-02` | `6f3ffa7b501e4e444add29865d1e104e5069b07d` | Yes | None |
| `translation-command-workflow-2026-09-13` | `a8f7183090378f8b7d124299da31f3c9eeb75958` | Yes | None |
| `translation-resolution-qa-20260913-125bf2a3` | `5a93ae99c32412ccf6a9620d705a4cc9de63f81c` | Yes | None |
| `ui-ux-2026-10-01` | `08d8b12c9a274d5b49d356e9d97109f20a8f9523` | Yes | None |
| `v047-release-2026-09-09` | `f65a27db9432c1f0a460bfe8b966a8c1446327bd` | Yes | None |
| `v048-release-2026-09-09` | `e39258b92f119d5b7d8326155f99188d43a7eaf3` | Yes | None |
| `v068-evidence-20261007` | `57a97530109059f47fec690e0886633b2cc02ec9` | Yes | None |
| `v068-release-20261007` | `10c3bc0cadf32a1714c0bcaf931bb5e33537d817` | Yes | None |
| `v1-integration-20261007` | `60920f8bf1c632f7695d47ef437e516c59bccdfc` | Yes | None |
| `workspace-switch-v0581-2026-09-13` | `ef16f166447ab477ea36588a5c01620f61560b19` | Yes | None |
| `write-outcome-truth-2026-09-10` | `3a6099c119a65dd93ed85ef7f16eb1b641f27a6d` | Yes | None |
