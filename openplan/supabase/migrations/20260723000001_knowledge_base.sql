-- Wave 7.1 — Knowledge Base (Document Intelligence) ingestion spine.
--
-- Lets a workspace upload its own planning corpus (current RTP, comment letters,
-- prior studies, grant NOFOs, staff reports) so those documents become CITABLE
-- evidence in the Planner Agent, Grant Writer, and Report Generator. This
-- migration provisions:
--   * kb_documents        — one row per uploaded/pasted document + its status.
--   * kb_document_chunks   — extracted, page-anchored text chunks + a Postgres
--                            full-text-search vector (tsvector) for retrieval.
--   * kb-documents bucket  — PRIVATE object store for the raw uploaded bytes.
--
-- Posture (matches the app's established seams):
--   * Retrieval is Postgres FULL-TEXT SEARCH (tsvector/GIN), NOT a semantic /
--     embedding model. Screening-grade keyword matching, $0, deterministic. A
--     future `embedding vector(...)` column can be added additively for a
--     semantic layer (a separate provider decision — Anthropic has no embeddings
--     API), which is why none is created here.
--   * RLS grants workspace MEMBERS read (SELECT) only. Every write — document
--     row, chunk rows, status transitions, deletes — goes through authed API
--     routes using the service-role client after an explicit workspace-membership
--     check (same posture as engagement notifications / run-artifacts). This
--     keeps write authorization centralized in the routes and read isolation in
--     the database.
--   * The private kb-documents bucket carries NO storage.objects policies
--     (service-role-only, like run-artifacts / engagement-photos); object paths
--     are <workspace_id>/<document_id>/<filename> and reads are proxied by authed
--     routes via short-TTL signed URLs.

------------------------------------------------------------------------------
-- 1. DOCUMENTS — one row per uploaded/pasted document.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Optional project association: a document can be workspace-wide or scoped to
  -- one project (retrieval can then narrow to a project's own corpus).
  project_id        uuid REFERENCES projects(id) ON DELETE SET NULL,
  uploaded_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title             text NOT NULL,
  -- Planning-domain document taxonomy (drives filtering + provenance labels).
  doc_kind          text NOT NULL DEFAULT 'other' CHECK (doc_kind IN (
    'rtp','comment_letter','prior_study','nofo','staff_report','policy','other'
  )),
  source_kind       text NOT NULL CHECK (source_kind IN (
    'uploaded_pdf','uploaded_docx','uploaded_txt','uploaded_md','pasted_text'
  )),
  original_filename text,
  content_type      text,
  byte_size         bigint,
  -- storage://kb-documents/<workspace_id>/<document_id>/<filename> (null for pasted text).
  storage_ref       text,
  page_count        integer,
  chunk_count       integer NOT NULL DEFAULT 0,
  char_count        integer,
  -- sha256 hex of the raw bytes (or pasted text) — used by the upload route for
  -- idempotent dedup within a workspace. Indexed, not UNIQUE (a re-upload is
  -- allowed; the route chooses to return the existing ready document instead).
  checksum          text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','extracting','ready','failed','archived'
  )),
  -- Honest failure record: e.g. a scanned/image-only PDF with no text layer.
  extraction_error  text,
  citation_label    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_documents_workspace
  ON kb_documents (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_documents_project
  ON kb_documents (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kb_documents_checksum
  ON kb_documents (workspace_id, checksum) WHERE checksum IS NOT NULL;

------------------------------------------------------------------------------
-- 2. CHUNKS — extracted, page-anchored text + full-text-search vector.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_document_chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  -- Denormalized workspace_id so RLS + the retrieval RPC scope without a join.
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chunk_index    integer NOT NULL,
  page_from      integer,
  page_to        integer,
  char_start     integer,
  char_end       integer,
  content        text NOT NULL,
  -- Immutable two-arg form so the generated column is allowed. English config is
  -- adequate for screening-grade keyword retrieval over U.S. planning prose.
  content_tsv    tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  token_estimate integer,
  -- Reserved for a future semantic layer (net-new embeddings provider decision):
  --   embedding vector(1024)
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kb_document_chunks_tsv
  ON kb_document_chunks USING gin (content_tsv);
CREATE INDEX IF NOT EXISTS idx_kb_document_chunks_document
  ON kb_document_chunks (document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_kb_document_chunks_workspace
  ON kb_document_chunks (workspace_id);

------------------------------------------------------------------------------
-- 3. RLS — workspace members read; all writes go through service-role routes.
------------------------------------------------------------------------------
ALTER TABLE kb_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_document_chunks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kb_documents' AND policyname='kb_documents_read') THEN
    CREATE POLICY kb_documents_read ON kb_documents FOR SELECT USING (
      EXISTS (SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = kb_documents.workspace_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kb_document_chunks' AND policyname='kb_document_chunks_read') THEN
    CREATE POLICY kb_document_chunks_read ON kb_document_chunks FOR SELECT USING (
      EXISTS (SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = kb_document_chunks.workspace_id AND wm.user_id = auth.uid()));
  END IF;
END $$;

------------------------------------------------------------------------------
-- 4. updated_at trigger (own per-module function; search_path pinned inline).
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_kb_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_documents_updated_at ON kb_documents;
CREATE TRIGGER trg_kb_documents_updated_at BEFORE UPDATE ON kb_documents
  FOR EACH ROW EXECUTE FUNCTION set_kb_updated_at();

------------------------------------------------------------------------------
-- 5. PRIVATE storage bucket for the raw uploaded bytes (service-role-only).
------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kb-documents',
  'kb-documents',
  false,
  26214400, -- 25 MiB
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'application/octet-stream'
  ]
) ON CONFLICT (id) DO NOTHING;

-- Environments that provisioned the bucket out-of-band may have created it
-- public; force private so /object/public/ URLs never serve uploaded documents.
UPDATE storage.buckets SET public = false WHERE id = 'kb-documents' AND public;
