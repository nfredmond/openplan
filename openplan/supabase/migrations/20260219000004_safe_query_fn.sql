CREATE OR REPLACE FUNCTION execute_safe_query(query_text TEXT, p_feed_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  normalized TEXT;
BEGIN
  normalized := upper(trim(query_text));
  IF NOT (normalized LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'Only SELECT queries allowed';
  END IF;
  IF normalized ~ '\y(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE)\y' THEN
    RAISE EXCEPTION 'Query contains disallowed operation';
  END IF;
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text)
  INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION execute_safe_query TO service_role;
