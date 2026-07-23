-- Wave 7.2 — Knowledge Base retrieval RPC.
--
-- Lexical full-text search over uploaded-document chunks, ranked by ts_rank.
-- SECURITY INVOKER so the caller's RLS on kb_document_chunks / kb_documents
-- applies (a non-member gets nothing even if they guess a workspace id); the
-- explicit p_workspace_id is a further scope. Screening-grade keyword retrieval,
-- NOT a semantic / embedding model — a future pgvector layer would be additive.
--
-- Project scoping: when p_project_id is given, returns that project's documents
-- PLUS workspace-wide documents (project_id IS NULL apply to every project);
-- when null, returns all of the workspace's ready documents.

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
  rank real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT
    c.id,
    c.document_id,
    d.title,
    d.doc_kind,
    c.page_from,
    c.page_to,
    c.chunk_index,
    c.content,
    ts_rank(c.content_tsv, websearch_to_tsquery('english', p_query))::real AS rank
  FROM kb_document_chunks c
  JOIN kb_documents d ON d.id = c.document_id
  WHERE c.workspace_id = p_workspace_id
    AND d.status = 'ready'
    AND (p_project_id IS NULL OR d.project_id = p_project_id OR d.project_id IS NULL)
    AND websearch_to_tsquery('english', p_query) @@ c.content_tsv
  ORDER BY rank DESC, c.document_id, c.chunk_index
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25);
$$;

COMMENT ON FUNCTION public.kb_search_chunks(uuid, uuid, text, integer) IS
  'Lexical full-text retrieval over Knowledge Base document chunks (ts_rank over websearch_to_tsquery), workspace-scoped (SECURITY INVOKER -> caller RLS applies), optional project narrow (+ workspace-wide docs), ready docs only. A screening-grade keyword retriever for the grounding contract — NOT a semantic/embedding model (Wave 7.2).';

GRANT EXECUTE ON FUNCTION public.kb_search_chunks(uuid, uuid, text, integer) TO authenticated;
