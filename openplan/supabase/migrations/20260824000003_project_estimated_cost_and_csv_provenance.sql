-- A project may carry one planner-entered, planning-level estimated cost with
-- explicit currency and optional source-document provenance. This is not the
-- project-management burn budget and not a funding award or funding need.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS estimated_cost_amount numeric,
  ADD COLUMN IF NOT EXISTS estimated_cost_currency text,
  ADD COLUMN IF NOT EXISTS estimated_cost_basis_year integer,
  ADD COLUMN IF NOT EXISTS estimated_cost_source_document_id uuid
    REFERENCES kb_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_cost_recorded_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_cost_recorded_at timestamptz;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_estimated_cost_amount_check,
  DROP CONSTRAINT IF EXISTS projects_estimated_cost_currency_check,
  DROP CONSTRAINT IF EXISTS projects_estimated_cost_basis_year_check,
  DROP CONSTRAINT IF EXISTS projects_estimated_cost_coherence_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_estimated_cost_amount_check
    CHECK (estimated_cost_amount IS NULL OR estimated_cost_amount > 0),
  ADD CONSTRAINT projects_estimated_cost_currency_check
    CHECK (estimated_cost_currency IS NULL OR estimated_cost_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT projects_estimated_cost_basis_year_check
    CHECK (estimated_cost_basis_year IS NULL OR estimated_cost_basis_year BETWEEN 1800 AND 3000),
  ADD CONSTRAINT projects_estimated_cost_coherence_check
    CHECK (
      (estimated_cost_amount IS NULL AND estimated_cost_currency IS NULL
        AND estimated_cost_basis_year IS NULL AND estimated_cost_source_document_id IS NULL
        AND estimated_cost_recorded_by IS NULL AND estimated_cost_recorded_at IS NULL)
      OR
      (estimated_cost_amount IS NOT NULL AND estimated_cost_currency IS NOT NULL
        AND estimated_cost_recorded_at IS NOT NULL)
    );

COMMENT ON COLUMN projects.estimated_cost_amount IS
  'Planner-entered planning-level project cost estimate. Distinct from projects.budget_amount, which is the project-management burn budget, and from funding need or awards.';
COMMENT ON COLUMN projects.estimated_cost_currency IS
  'ISO 4217-style three-letter currency code explicitly entered with the estimate. No jurisdiction-derived default.';
COMMENT ON COLUMN projects.estimated_cost_source_document_id IS
  'Optional kb_documents record the planner used as the estimate source. The API verifies it belongs to this project and workspace.';

-- CSV now has a deterministic parser and citable chunks. The provenance value
-- is earned by that implementation and remains distinct from text_layer and OCR.
ALTER TABLE kb_documents
  DROP CONSTRAINT IF EXISTS kb_documents_extraction_source_check;

ALTER TABLE kb_documents
  ADD CONSTRAINT kb_documents_extraction_source_check
  CHECK (extraction_source IN ('text_layer','pasted','none','ocr','spreadsheet_parse'));

COMMENT ON COLUMN kb_documents.extraction_source IS
  'Where indexed text came from: text_layer, pasted, ocr, spreadsheet_parse (deterministic CSV parsing), or none. NULL means not recorded. There is deliberately no confidence or accuracy score.';
