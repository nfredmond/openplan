-- Grant application assembly: per-opportunity application sections, an
-- append-only per-section AI draft history, an attachment checklist, and an
-- export register — the schema behind assembling a real application from a
-- funding opportunity instead of one undifferentiated narrative blob.
--
--   funding_opportunity_application_sections — one row per application section
--     (seeded from a catalog template by explicit key, or fully custom).
--     Status walks not_started → drafting → operator_review → final; the
--     operator-approved text lives in final_markdown. ai_drafting_enabled is
--     persisted per row so the budget/fee/certification never-AI rule survives
--     catalog drift and applies to custom sections too.
--   funding_opportunity_section_drafts — append-only AI draft history per
--     section (mirrors funding_opportunity_narrative_drafts, plus revision_of
--     chains: a revision points at the draft it restyles, and its facts are
--     rebuilt fresh from workspace evidence on every call).
--   funding_opportunity_attachments — the checklist of documents the
--     application must carry; items can link an uploaded Knowledge Base
--     document or a generated report artifact as fulfillment.
--   funding_opportunity_application_exports — register of packaged
--     application exports written to the grant-application-exports bucket.
--
-- All additive. RLS mirrors the existing grants tables (workspace-member
-- read/write); drafts and exports are append-only for authenticated users.

CREATE TABLE IF NOT EXISTS funding_opportunity_application_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES funding_opportunities(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  guidance TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('catalog', 'custom')),
  -- Workspace evidence families drafting should emphasize (JSON array of
  -- evidence-kind strings from the catalog template; empty for custom
  -- sections until an operator sets it). Never a jurisdiction.
  suggested_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Budget figures, cost estimates, fee schedules, and certifications are
  -- never AI-drafted. The drafting route refuses when this is false.
  ai_drafting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (
    status IN ('not_started', 'drafting', 'operator_review', 'final')
  ),
  final_markdown TEXT,
  -- FK added after funding_opportunity_section_drafts exists (below).
  finalized_from_draft_id UUID,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, section_key)
);

CREATE TABLE IF NOT EXISTS funding_opportunity_section_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES funding_opportunities(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES funding_opportunity_application_sections(id) ON DELETE CASCADE,
  draft_markdown TEXT NOT NULL,
  model TEXT,
  grounding_json JSONB,
  grounded_sentence_count INTEGER,
  total_sentence_count INTEGER,
  -- Revision chain: which stored draft this one restyles. Facts are rebuilt
  -- fresh from workspace evidence on every generation, so a revision can
  -- change tone but can never smuggle a claim past the grounding validator.
  revision_of UUID REFERENCES funding_opportunity_section_drafts(id) ON DELETE SET NULL,
  revision_instructions TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- finalized_from_draft_id → drafts, guarded so re-running is safe. Declared
-- after both tables exist because the two tables reference each other.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fo_application_sections_finalized_from_draft_fk'
  ) THEN
    ALTER TABLE funding_opportunity_application_sections
      ADD CONSTRAINT fo_application_sections_finalized_from_draft_fk
      FOREIGN KEY (finalized_from_draft_id)
      REFERENCES funding_opportunity_section_drafts(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS funding_opportunity_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES funding_opportunities(id) ON DELETE CASCADE,
  attachment_key TEXT NOT NULL,
  title TEXT NOT NULL,
  guidance TEXT,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  -- A checklist item that does not apply is marked not_applicable, never
  -- deleted — deleting a seeded requirement would hide it from review.
  status TEXT NOT NULL CHECK (
    status IN ('missing', 'in_progress', 'attached', 'not_applicable')
  ) DEFAULT 'missing',
  kb_document_id UUID REFERENCES kb_documents(id) ON DELETE SET NULL,
  report_artifact_id UUID REFERENCES report_artifacts(id) ON DELETE SET NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, attachment_key)
);

CREATE TABLE IF NOT EXISTS funding_opportunity_application_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES funding_opportunities(id) ON DELETE CASCADE,
  -- grant-application-exports/<workspace_id>/<opportunity_id>/<export_id>.pdf
  storage_path TEXT NOT NULL,
  pdf_engine TEXT,
  page_count INTEGER,
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fo_application_sections_opportunity_idx
  ON funding_opportunity_application_sections (opportunity_id, sort_order);
CREATE INDEX IF NOT EXISTS fo_application_sections_workspace_idx
  ON funding_opportunity_application_sections (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS fo_section_drafts_section_idx
  ON funding_opportunity_section_drafts (section_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fo_section_drafts_opportunity_idx
  ON funding_opportunity_section_drafts (opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fo_section_drafts_workspace_idx
  ON funding_opportunity_section_drafts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fo_attachments_opportunity_idx
  ON funding_opportunity_attachments (opportunity_id, sort_order);
CREATE INDEX IF NOT EXISTS fo_attachments_workspace_idx
  ON funding_opportunity_attachments (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS fo_application_exports_opportunity_idx
  ON funding_opportunity_application_exports (opportunity_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS fo_application_exports_workspace_idx
  ON funding_opportunity_application_exports (workspace_id, generated_at DESC);

ALTER TABLE funding_opportunity_application_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_opportunity_section_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_opportunity_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_opportunity_application_exports ENABLE ROW LEVEL SECURITY;

-- Sections: workspace members read and write; rows are edited in place.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_application_sections'
      AND policyname='fo_application_sections_member_read'
  ) THEN
    CREATE POLICY fo_application_sections_member_read
      ON funding_opportunity_application_sections
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_application_sections'
      AND policyname='fo_application_sections_member_insert'
  ) THEN
    CREATE POLICY fo_application_sections_member_insert
      ON funding_opportunity_application_sections
      FOR INSERT WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_application_sections'
      AND policyname='fo_application_sections_member_update'
  ) THEN
    CREATE POLICY fo_application_sections_member_update
      ON funding_opportunity_application_sections
      FOR UPDATE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      )
      WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_application_sections'
      AND policyname='fo_application_sections_member_delete'
  ) THEN
    CREATE POLICY fo_application_sections_member_delete
      ON funding_opportunity_application_sections
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- Drafts: append-only history — members read and insert; no update/delete.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_section_drafts'
      AND policyname='fo_section_drafts_member_read'
  ) THEN
    CREATE POLICY fo_section_drafts_member_read
      ON funding_opportunity_section_drafts
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_section_drafts'
      AND policyname='fo_section_drafts_member_insert'
  ) THEN
    CREATE POLICY fo_section_drafts_member_insert
      ON funding_opportunity_section_drafts
      FOR INSERT WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
        AND created_by = auth.uid()
      );
  END IF;
END
$$;

-- Attachments: workspace members read and write; checklist rows are edited
-- in place (status transitions), and custom rows may be removed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_attachments'
      AND policyname='fo_attachments_member_read'
  ) THEN
    CREATE POLICY fo_attachments_member_read
      ON funding_opportunity_attachments
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_attachments'
      AND policyname='fo_attachments_member_insert'
  ) THEN
    CREATE POLICY fo_attachments_member_insert
      ON funding_opportunity_attachments
      FOR INSERT WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_attachments'
      AND policyname='fo_attachments_member_update'
  ) THEN
    CREATE POLICY fo_attachments_member_update
      ON funding_opportunity_attachments
      FOR UPDATE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      )
      WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_attachments'
      AND policyname='fo_attachments_member_delete'
  ) THEN
    CREATE POLICY fo_attachments_member_delete
      ON funding_opportunity_attachments
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- Exports: append-only register — members read and insert.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_application_exports'
      AND policyname='fo_application_exports_member_read'
  ) THEN
    CREATE POLICY fo_application_exports_member_read
      ON funding_opportunity_application_exports
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='funding_opportunity_application_exports'
      AND policyname='fo_application_exports_member_insert'
  ) THEN
    CREATE POLICY fo_application_exports_member_insert
      ON funding_opportunity_application_exports
      FOR INSERT WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
        AND generated_by = auth.uid()
      );
  END IF;
END
$$;

REVOKE ALL ON TABLE funding_opportunity_application_sections FROM PUBLIC, anon;
REVOKE ALL ON TABLE funding_opportunity_section_drafts FROM PUBLIC, anon;
REVOKE ALL ON TABLE funding_opportunity_attachments FROM PUBLIC, anon;
REVOKE ALL ON TABLE funding_opportunity_application_exports FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE funding_opportunity_application_sections TO authenticated;
GRANT SELECT, INSERT ON TABLE funding_opportunity_section_drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE funding_opportunity_attachments TO authenticated;
GRANT SELECT, INSERT ON TABLE funding_opportunity_application_exports TO authenticated;

GRANT ALL ON TABLE funding_opportunity_application_sections TO service_role;
GRANT ALL ON TABLE funding_opportunity_section_drafts TO service_role;
GRANT ALL ON TABLE funding_opportunity_attachments TO service_role;
GRANT ALL ON TABLE funding_opportunity_application_exports TO service_role;

-- Private storage bucket for packaged application exports, mirroring the
-- report-artifacts bucket (20260420000060): workspace-prefixed paths, RLS on
-- the workspace_id prefix via workspace_members membership.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'grant-application-exports',
  'grant-application-exports',
  false,
  52428800,
  ARRAY['application/pdf', 'text/html', 'application/octet-stream']
) ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'grant_application_exports_workspace_read'
  ) THEN
    CREATE POLICY "grant_application_exports_workspace_read" ON storage.objects
      FOR SELECT USING (
        bucket_id = 'grant-application-exports'
        AND split_part(name, '/', 1) IN (
          SELECT workspace_id::text FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'grant_application_exports_workspace_insert'
  ) THEN
    CREATE POLICY "grant_application_exports_workspace_insert" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'grant-application-exports'
        AND split_part(name, '/', 1) IN (
          SELECT workspace_id::text FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

COMMENT ON TABLE funding_opportunity_application_sections IS
  'Application sections per funding opportunity, seeded from a catalog template by explicit key or added as custom rows. final_markdown holds the operator-approved text; ai_drafting_enabled=false pins the sections a model must never draft (budgets, fees, certifications).';
COMMENT ON TABLE funding_opportunity_section_drafts IS
  'Append-only AI draft history per application section. revision_of chains revisions; facts are rebuilt fresh from workspace evidence on every generation and validated with the grounding contract. Drafts are writing support only and require operator review.';
COMMENT ON TABLE funding_opportunity_attachments IS
  'Attachment checklist per funding opportunity. Items link Knowledge Base documents or report artifacts as fulfillment; inapplicable items are marked not_applicable, never silently dropped.';
COMMENT ON TABLE funding_opportunity_application_exports IS
  'Register of packaged application exports written to the grant-application-exports storage bucket.';
