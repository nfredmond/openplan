-- The stage-gate template a workspace is born holding becomes the nationwide
-- US federal-aid floor (us_federal_aid_stage_gates_v0_1) instead of the
-- California pack (ca_stage_gates_v0_1, the default since 20260305000009).
--
-- WHY: the sign-up trigger inserts only (name, slug), so every new workspace
-- inherits this column default with nobody having chosen it. While the CA pack
-- was the only template registered, stamping it everywhere was the least-wrong
-- option; now that a jurisdiction-neutral federal-aid template exists, a new
-- workspace in Ohio or Texas should be born holding the gates that are true
-- anywhere in the United States, not one state's manual.
--
-- EXISTING ROWS ARE DELIBERATELY UNTOUCHED. A stored 'ca_stage_gates_v0_1' on
-- an existing row cannot tell us whether the agency chose California's gates or
-- was merely born under the old default — the data cannot distinguish a choice
-- from an assumption, so no UPDATE here could be honest. The read side owns
-- that honesty: resolveWorkspaceStageGateBinding (template-loader.ts)
-- reconciles the stored id against the workspace's own geography, and
-- KNOWN_DATABASE_DEFAULT_TEMPLATE_IDS lists both ids this column default has
-- ever stamped, so a diverging stored default is labeled assumed
-- ("interim_unconfigured_default"), never presented as explicitly requested.
--
-- stage_gate_template_version keeps its existing DEFAULT '0.1.0': the
-- federal-aid template's version is also 0.1.0.

ALTER TABLE workspaces
  ALTER COLUMN stage_gate_template_id SET DEFAULT 'us_federal_aid_stage_gates_v0_1';
