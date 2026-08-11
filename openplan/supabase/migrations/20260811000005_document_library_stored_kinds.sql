-- Document library, stored kinds — the Knowledge Base learns to HOLD a file it
-- does not read.
--
-- Until now kb_documents only admitted formats the extractor could pull a text
-- layer from (PDF / DOCX / txt / md / pasted text). A planning office's corpus
-- is wider than that: site photos, exhibits, cost spreadsheets, CAD drawings.
-- Those files belong in the library so they can be found and downloaded — but
-- OpenPlan does not read text out of them, and pretending otherwise is the
-- defect this module was built to refuse.
--
-- So this migration adds a status that says exactly that:
--
--   'stored'  = OpenPlan kept the bytes and DID NOT TRY to extract text.
--               Distinct from 'failed', which means it tried and found none.
--
-- WHY GROUNDING CANNOT BREAK. The retrieval RPC (kb_search_chunks,
-- 20260723000003) filters on d.status = 'ready', and a stored document has
-- zero chunk rows besides — nothing in this migration or in the ingest routes
-- inserts chunks for a stored row. A stored file can never become citable
-- evidence by accident; making one citable is a deliberate future lane (OCR /
-- spreadsheet parsing) that will flip status through its own reviewed write.
--
-- extraction_source records WHERE a document's indexed text came from, for the
-- rows that have text: 'text_layer' (pulled from the file's own embedded
-- text), 'pasted' (the planner pasted it), 'none' (a stored file — no text was
-- looked for). NULL means the row predates this column and the answer was not
-- recorded; the backfill is deliberately omitted rather than guessed. Future
-- values ('ocr', 'spreadsheet_parse') are added by the worker lane's own
-- migration when that capability actually exists — promising them now would be
-- schema describing a capability the product does not have.
--
-- The per-file size ceiling moves out of the bucket row and into the operator
-- env OPENPLAN_KB_DOCUMENT_MAX_BYTES (default 100 MiB), following the aerial
-- imagery pattern: the upload route streams against the resolved ceiling and
-- its refusal names the variable, instead of a bucket-level limit answering
-- with an unexplained storage error after the body was already uploaded.

------------------------------------------------------------------------------
-- 1. status gains 'stored'.
------------------------------------------------------------------------------
ALTER TABLE kb_documents
  DROP CONSTRAINT IF EXISTS kb_documents_status_check;

ALTER TABLE kb_documents
  ADD CONSTRAINT kb_documents_status_check
  CHECK (status IN ('pending','extracting','ready','failed','archived','stored'));

------------------------------------------------------------------------------
-- 2. source_kind gains the four stored kinds.
------------------------------------------------------------------------------
ALTER TABLE kb_documents
  DROP CONSTRAINT IF EXISTS kb_documents_source_kind_check;

ALTER TABLE kb_documents
  ADD CONSTRAINT kb_documents_source_kind_check
  CHECK (source_kind IN (
    'uploaded_pdf','uploaded_docx','uploaded_txt','uploaded_md','pasted_text',
    'uploaded_image','uploaded_spreadsheet','uploaded_cad','uploaded_other'
  ));

------------------------------------------------------------------------------
-- 3. doc_kind gains 'drawing' and 'exhibit'.
------------------------------------------------------------------------------
ALTER TABLE kb_documents
  DROP CONSTRAINT IF EXISTS kb_documents_doc_kind_check;

ALTER TABLE kb_documents
  ADD CONSTRAINT kb_documents_doc_kind_check
  CHECK (doc_kind IN (
    'rtp','comment_letter','prior_study','nofo','staff_report','policy','other',
    'drawing','exhibit'
  ));

------------------------------------------------------------------------------
-- 4. extraction_source — provenance of the indexed text, when there is any.
------------------------------------------------------------------------------
ALTER TABLE kb_documents
  ADD COLUMN IF NOT EXISTS extraction_source text
  CHECK (extraction_source IN ('text_layer','pasted','none'));

COMMENT ON COLUMN kb_documents.extraction_source IS
  'Where the indexed text came from: text_layer (the file''s own embedded text), pasted (planner-supplied), none (a stored file — no extraction attempted). NULL = row predates this column; not recorded.';

COMMENT ON COLUMN kb_documents.status IS
  'pending/extracting/ready/failed/archived, plus stored = kept for download and reference with NO extraction attempted, by design. Only ready rows are retrievable: the kb_search_chunks RPC filters on status and stored rows carry zero chunks.';

------------------------------------------------------------------------------
-- 5. Bucket: widen the accepted types; the size ceiling moves to the operator
--    env (resolved per request by the upload route), so the bucket-level limit
--    is removed rather than left to contradict it.
------------------------------------------------------------------------------
UPDATE storage.buckets
SET
  file_size_limit = NULL,
  allowed_mime_types = ARRAY[
    -- extractable kinds (text/x-markdown was accepted by the route and
    -- refused by the bucket before this migration — a real, live mismatch)
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/octet-stream',
    -- stored: images (content type is the sniffed one — bytes decide)
    'image/jpeg',
    'image/png',
    'image/tiff',
    -- stored: spreadsheets
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    -- stored: CAD
    'image/vnd.dwg',
    'image/vnd.dxf',
    -- stored: other explicitly-listed office formats
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/rtf',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation'
  ]
WHERE id = 'kb-documents';
