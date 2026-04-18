-- Drop the dormant execute_safe_query SECURITY DEFINER function.
--
-- Confirmed dormant on 2026-04-18: no TypeScript, edge-function, or
-- migration callers reference it. The AI query pipeline described in
-- CLAUDE.md was never wired into this function; current analysis flows
-- use scoped RPCs + RLS directly.
--
-- SECURITY DEFINER functions with weak allowlist guards are a standing
-- RLS-bypass risk if a future caller passes user-controlled SQL. Dropping
-- narrows the security surface rather than hardening a phantom one.

DROP FUNCTION IF EXISTS execute_safe_query(TEXT, UUID);
