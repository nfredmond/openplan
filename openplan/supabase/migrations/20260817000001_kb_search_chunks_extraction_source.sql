-- kb_search_chunks now returns each chunk's document extraction_source, so a
-- retrieved passage can say whether its text was READ WITH OCR.
--
-- Why: OCR-transcribed text reached every grounded drafting surface (grant
-- narratives, RTP chapter drafts, report narratives, assistant chat) as a
-- [fact:id]-citable quote indistinguishable from author-embedded text — a
-- misread digit in a scanned adopted plan became a cited figure with no way to
-- know it needed checking against the page (found 2026-08-17). The document
-- list already showed KB_OCR_PROVENANCE_NOTICE off this same column; the
-- excerpt/RPC path dropped it. This adds it back with no new column and no
-- denormalization — the JOIN to kb_documents was already here.
--
-- The argument signature is unchanged, but Postgres refuses CREATE OR REPLACE
-- when a RETURNS TABLE row type gains a column (SQLSTATE 42P13), so the function
-- is dropped and recreated, and EXECUTE is re-granted. Kept SECURITY INVOKER, so
-- caller RLS on kb_documents still governs the read.

DROP FUNCTION IF EXISTS public.kb_search_chunks(uuid, uuid, text, integer);

CREATE OR REPLACE FUNCTION public.kb_search_chunks(
  p_workspace_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 8
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  doc_kind text,
  page_from integer,
  page_to integer,
  chunk_index integer,
  content text,
  rank real,
  extraction_source text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH parsed AS (
    SELECT NULLIF(
      replace(websearch_to_tsquery('english', p_query)::text, ' & ', ' | '),
      ''
    )::tsquery AS query
  )
  SELECT
    c.id,
    c.document_id,
    d.title,
    d.doc_kind,
    c.page_from,
    c.page_to,
    c.chunk_index,
    c.content,
    ts_rank(c.content_tsv, parsed.query)::real AS rank,
    d.extraction_source
  FROM kb_document_chunks c
  JOIN kb_documents d ON d.id = c.document_id
  CROSS JOIN parsed
  WHERE c.workspace_id = p_workspace_id
    AND d.status = 'ready'
    AND (p_project_id IS NULL OR d.project_id = p_project_id OR d.project_id IS NULL)
    AND parsed.query IS NOT NULL
    AND c.content_tsv @@ parsed.query
  ORDER BY rank DESC, c.document_id, c.chunk_index
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25);
$$;

GRANT EXECUTE ON FUNCTION public.kb_search_chunks(uuid, uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.kb_search_chunks(uuid, uuid, text, integer) IS
  'Lexical full-text retrieval over Knowledge Base document chunks. Parses the query with websearch_to_tsquery then rewrites & -> | so a natural-language question matches on ANY significant lexeme (ts_rank orders by relevance). Workspace-scoped (SECURITY INVOKER -> caller RLS applies), optional project narrow (+ workspace-wide docs), ready docs only. Returns extraction_source so a passage read with OCR can say so. Screening-grade keyword retriever — NOT semantic (Wave 7.2).';
