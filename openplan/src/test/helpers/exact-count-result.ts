/** Count an explicitly complete fixture before a caller applies any range. */
export function exactCountResult<T extends { data: unknown; error?: unknown; count?: number | null }>(result: T) {
  return {
    ...result,
    count: result.count !== undefined ? result.count : !result.error && Array.isArray(result.data) ? result.data.length : null,
  };
}
