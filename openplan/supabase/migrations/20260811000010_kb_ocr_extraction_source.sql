-- OCR: the document library learns to READ a file it can only store today.
--
-- ============================================================== WHY
--
-- A scanned PDF uploaded to the Knowledge Base is extracted by unpdf, finds no
-- text layer, and lands `status = 'failed'` with zero chunks: stored,
-- downloadable, and permanently uncitable. Most adopted Regional
-- Transportation Plans older than a few years are exactly that file. An agency
-- can hold its own adopted plan in OpenPlan and be unable to quote a single
-- line of it.
--
-- 20260811000005 anticipated this migration by name. Its header reads:
--
--     Future values ('ocr', 'spreadsheet_parse') are added by the worker
--     lane's own migration when that capability actually exists — promising
--     them now would be schema describing a capability the product does not
--     have.
--
-- That capability now exists (workers/ocr_worker, speaking the contract at
-- schemas/ocr_extraction_contract.schema.json), so this is that migration and
-- it widens exactly the one value it earned: 'ocr'. 'spreadsheet_parse' is
-- deliberately NOT added — no worker parses a spreadsheet, and adding the value
-- would put the same false promise back into the schema one word later.
--
-- ==================================================== WHAT 'ocr' MEANS AND DOES NOT
--
-- extraction_source records WHERE a document's indexed text came from. 'ocr'
-- means: a machine looked at pictures of words and wrote down what it saw.
-- That is a materially weaker provenance than 'text_layer' (the characters the
-- document's own author embedded), and the distinction is the entire reason
-- this column exists rather than a boolean. A figure transcribed from an OCR'd
-- page can be misread — a 3 for an 8, a decimal point lost in a scan artefact —
-- in a way a text-layer figure cannot, and every surface that shows a
-- transcribed figure has to be able to say which it was.
--
-- WHAT IT IS NOT: a quality score. There is no confidence, certainty or
-- likelihood column here, and there must never be one. The recogniser can emit
-- per-word confidence figures; the worker deliberately does not collect them.
-- A number the machine invents about its own accuracy reads to every human as
-- a quality signal, and an "OCR confidence: 94%" beside a dollar figure in an
-- adopted plan would be doing the one thing this whole lane exists to prevent —
-- a machine vouching for a planning number. The honest answer to "how good is
-- this transcription?" is that a person has to read the quote against the page,
-- which is why every downstream candidate carries its verbatim quote and its
-- page.
--
-- NOT A CLAIM TIER AN AGENT CAN REACH. `an-agent-may-not-promote-a-tier` derives
-- tier columns by matching a CHECK vocabulary against the known tier
-- vocabularies; extraction_source is not one of them, and more importantly NO
-- assistant action writes it. OCR is requested by a person clicking a button on
-- a document they can already see, and applied by a bearer-authenticated worker
-- callback. ACTION_METADATA gains nothing from this migration, so
-- refused-rtp-financial-actions-stay-refused stays green BY CONSTRUCTION rather
-- than by allowlist.
--
-- ==================================================== THE PAGE IS THE ANCHOR
--
-- kb_document_chunks already carries page_from / page_to, and OCR text arrives
-- from the worker AS PAGES — one entry per page of the source, in order,
-- including pages that recognised nothing (delivered as an empty string rather
-- than omitted, because omitting one renumbers every page after it). The
-- callback route hands those straight to chunkExtractedDocument, the same
-- deterministic chunker the text-layer path uses. Nothing in this migration
-- creates a second chunking path, and nothing here lets text into
-- kb_document_chunks without a page number attached to it.

------------------------------------------------------------------------------
-- 1. extraction_source gains 'ocr'.
------------------------------------------------------------------------------
-- The constraint is unnamed in 20260811000005 (it was written as a column
-- CHECK), so Postgres named it kb_documents_extraction_source_check. Both the
-- generated name and an explicit one are dropped, so this re-runs cleanly
-- whichever shape the local database ended up with.
ALTER TABLE kb_documents
  DROP CONSTRAINT IF EXISTS kb_documents_extraction_source_check;

ALTER TABLE kb_documents
  ADD CONSTRAINT kb_documents_extraction_source_check
  CHECK (extraction_source IN ('text_layer','pasted','none','ocr'));

COMMENT ON COLUMN kb_documents.extraction_source IS
  'Where the indexed text came from: text_layer (the file''s own embedded text), pasted (planner-supplied), ocr (a machine read pictures of words on a scanned page — weaker provenance, and every surface showing a transcribed figure must be able to say so), none (a stored file — no extraction attempted). NULL = row predates 20260811000005; not recorded. There is deliberately no confidence or accuracy column beside this one.';

------------------------------------------------------------------------------
-- 2. kb_ocr_jobs — one row per OCR request dispatched to the worker.
------------------------------------------------------------------------------
-- Written BEFORE the worker is called so a crash between the two steps cannot
-- orphan an accepted worker job: the callback route resolves the document and
-- the workspace from request_id via this row. Exactly the aerial_processing_jobs
-- posture (20260721000001), for exactly the same reason.
CREATE TABLE IF NOT EXISTS kb_ocr_jobs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- CASCADE: the job is a fact about a document. Delete the document and the
  -- job describes nothing. (Contrast rtp_extraction_runs.kb_document_id, which
  -- is RESTRICT because accepted figures point back at it — an OCR job is not
  -- evidence for anything on its own.)
  document_id       UUID        NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  -- Caller-generated idempotency key echoed by every callback.
  request_id        TEXT        NOT NULL UNIQUE,
  -- The contract's jobReference, set from the worker's accepted answer.
  worker_job_id     TEXT,
  status            TEXT        NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed')),
  -- The contract's callback statuses are accepted/running/succeeded/failed/
  -- canceled; 'accepted' maps to 'running' here (the worker has it) and
  -- 'canceled' maps to 'failed' with the reason, because a planner looking at
  -- this row needs to know whether text is coming, and both answers are no.
  progress          SMALLINT    CHECK (progress >= 0 AND progress <= 100),
  message           TEXT,
  -- Pages in the SOURCE document, as the worker counted them. NULL until a
  -- callback says; a page count that was never read is not a page count of 0.
  page_count        INTEGER     CHECK (page_count IS NULL OR page_count >= 0),
  -- How many of those pages produced any text at all. A COUNT, not a score:
  -- it lets a surface say "148 of 212 pages produced text" — a fact a planner
  -- can act on — without implying a quality judgement nobody measured.
  pages_with_text   INTEGER     CHECK (pages_with_text IS NULL OR pages_with_text >= 0),
  -- WHICH RECOGNISER READ IT, recorded rather than assumed. Text recognised
  -- with the wrong language pack is the failure mode a reader cannot see: it
  -- comes back looking exactly like text. Two ocrmypdf versions can also differ
  -- on the same scan.
  engine_name       TEXT,
  engine_version    TEXT,
  languages         TEXT[],
  failure_detail    TEXT,
  last_callback_id  TEXT,
  last_callback_at  TIMESTAMPTZ,
  requested_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE kb_ocr_jobs IS
  'One OCR request sent to a self-hosted OCR worker for one kb_documents row. Written before dispatch so a crash cannot orphan an accepted worker job; advanced by bearer-authenticated callbacks. Records WHICH recogniser and WHICH languages read the document, because text recognised with the wrong language pack looks exactly like text. Carries no confidence or accuracy figure, deliberately.';

COMMENT ON COLUMN kb_ocr_jobs.pages_with_text IS
  'How many delivered pages carry any text. A count, never a score — "148 of 212 pages produced text" is a fact a planner can act on; a percentage-accuracy figure would be the machine grading itself.';

CREATE INDEX IF NOT EXISTS kb_ocr_jobs_document_id_idx  ON kb_ocr_jobs(document_id);
CREATE INDEX IF NOT EXISTS kb_ocr_jobs_workspace_id_idx ON kb_ocr_jobs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kb_ocr_jobs_status_idx       ON kb_ocr_jobs(status);

CREATE OR REPLACE FUNCTION public.set_kb_ocr_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_kb_ocr_jobs_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_kb_ocr_jobs_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_set_kb_ocr_jobs_updated_at ON kb_ocr_jobs;
CREATE TRIGGER trg_set_kb_ocr_jobs_updated_at
BEFORE UPDATE ON kb_ocr_jobs
FOR EACH ROW
EXECUTE FUNCTION public.set_kb_ocr_jobs_updated_at();

------------------------------------------------------------------------------
-- 3. kb_ocr_job_callbacks — the idempotency ledger.
------------------------------------------------------------------------------
-- Mirrors aerial_processing_callbacks (20260721000001): the contract allows
-- redeliveries, consumers dedupe on callback_id, and callback_id is UNIQUE here
-- so a replay fails with 23505 and the route answers {ok:true, deduped:true}
-- without re-applying the transition. Without this, a redelivered succeeded
-- callback would insert the document's chunks a second time and every excerpt
-- would appear twice in search.
--
-- WHAT IS DELIBERATELY NOT STORED: the payload. aerial_processing_callbacks
-- keeps its raw vendor payload because it holds signed URLs that must not reach
-- a member-readable table. Here the payload is the DOCUMENT'S OWN TEXT, and
-- keeping it would store a second copy of every scanned plan the workspace
-- OCRs — the same bytes already landing in kb_document_chunks, where they are
-- searchable and page-anchored. The ledger keeps the shape of the delivery
-- (status, page counts, size) and nothing else.
CREATE TABLE IF NOT EXISTS kb_ocr_job_callbacks (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ocr_job_id     UUID        NOT NULL REFERENCES kb_ocr_jobs(id) ON DELETE CASCADE,
  workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  callback_id    TEXT        NOT NULL UNIQUE,
  status         TEXT        NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL,
  page_count     INTEGER,
  -- Serialized size of the delivery. Recorded because "the OCR of this plan is
  -- too big for this deployment's callback ceiling" is an operator question
  -- with a numeric answer, and the number is otherwise gone the moment the
  -- request ends.
  payload_bytes  INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE kb_ocr_job_callbacks IS
  'Idempotency ledger for OCR worker callbacks; callback_id is UNIQUE so a redelivery fails with 23505 and the route answers deduped instead of inserting the document''s chunks twice. The payload is NOT stored: it is the document''s own text, which already lands page-anchored in kb_document_chunks, and a second copy of every scanned plan is not a record, it is a duplicate.';

CREATE INDEX IF NOT EXISTS kb_ocr_job_callbacks_ocr_job_id_idx
  ON kb_ocr_job_callbacks(ocr_job_id, occurred_at DESC);

------------------------------------------------------------------------------
-- 4. Row-level security and grants.
------------------------------------------------------------------------------
-- kb_documents' posture, deliberately: workspace members may READ the job
-- state; every write goes through the authenticated request route (membership
-- and role checked there) or the bearer-authenticated callback route, both of
-- which write with the service role. No INSERT/UPDATE/DELETE policy exists for
-- any client role, so there is no permissive write policy to gate and the
-- viewer-write-denial census does not move.
--
-- Since 20260804000001, a new table is born with NO grants to anon or
-- authenticated: what is granted below is the whole of what these roles get.
ALTER TABLE kb_ocr_jobs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_ocr_job_callbacks  ENABLE ROW LEVEL SECURITY;

CREATE POLICY kb_ocr_jobs_read ON kb_ocr_jobs
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- kb_ocr_job_callbacks gets NO policy at all, which is the strongest posture
-- available: row security is on and no policy exists, so no client role can
-- read a row through it regardless of grants. The ledger is plumbing — a
-- planner reads the JOB, not the deliveries that advanced it — and the
-- aerial_processing_callbacks precedent (its member-read policy was dropped in
-- 20260730000004) is the same conclusion reached the slow way.

GRANT SELECT ON kb_ocr_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_ocr_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_ocr_job_callbacks TO service_role;

REVOKE ALL ON kb_ocr_jobs          FROM anon;
REVOKE ALL ON kb_ocr_job_callbacks FROM anon, authenticated;
