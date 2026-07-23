-- Wave 7.2 fix — kb_search_chunks: OR (any-term) retrieval, not AND (all-terms).
--
-- The original 20260723000002 used websearch_to_tsquery directly, which ANDs
-- every lexeme. A natural-language question ("Based on my uploaded documents,
-- what are the buyer-safe boundaries...") therefore required EVERY significant
-- word — including ones absent from the document ("based", "name", "used") — to
-- be present, so real questions matched nothing (caught in the Wave 7 live
-- walkthrough: the Planner Agent saw "no knowledge base excerpts" for a document
-- that was clearly relevant).
--
-- Fix: rewrite the parsed query to OR semantics by swapping the tsquery's ' & '
-- operators for ' | '. English stopwords are already dropped by the config, so
-- this ORs the *meaningful* lexemes; ts_rank still orders by relevance and LIMIT
-- caps the result, keeping this a screening-grade keyword retriever. Phrase
-- operators (<->) are left intact. NULLIF guards an all-stopword query (empty
-- tsquery -> NULL -> no rows).

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
    ts_rank(c.content_tsv, parsed.query)::real AS rank
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

COMMENT ON FUNCTION public.kb_search_chunks(uuid, uuid, text, integer) IS
  'Lexical full-text retrieval over Knowledge Base document chunks. Parses the query with websearch_to_tsquery then rewrites & -> | so a natural-language question matches on ANY significant lexeme (ts_rank orders by relevance). Workspace-scoped (SECURITY INVOKER -> caller RLS applies), optional project narrow (+ workspace-wide docs), ready docs only. Screening-grade keyword retriever — NOT semantic (Wave 7.2).';
