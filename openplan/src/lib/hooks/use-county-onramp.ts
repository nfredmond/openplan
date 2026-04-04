"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CountyRunDetailResponse,
  CountyRunListResponse,
  CountyRunScaffoldResponse,
  PrepareCountyRunValidationResponse,
  CreateCountyRunRequest,
  CreateCountyRunResponse,
  EnqueueCountyRunResponse,
  IngestCountyRunManifestRequest,
  UpdateCountyRunScaffoldRequest,
} from "@/lib/api/county-onramp";
import type { CountyGeographySearchResponse } from "@/lib/api/county-geographies";
import {
  createCountyRun,
  enqueueCountyRun,
  getCountyRunDetail,
  getCountyRunScaffold,
  ingestCountyRunManifest,
  listCountyRuns,
  prepareCountyRunValidation,
  refreshCountyRunValidation,
  updateCountyRunScaffold,
} from "@/lib/api/county-onramp-client";
import { searchCountyGeographies } from "@/lib/api/county-geographies-client";

export function useCountyGeographySearch(query: string, params?: { limit?: number; debounceMs?: number }) {
  const limit = params?.limit ?? 8;
  const debounceMs = params?.debounceMs ?? 250;
  const trimmedQuery = query.trim();
  const searchable = Boolean(trimmedQuery) && (trimmedQuery.length >= 2 || /^\d{5}$/.test(trimmedQuery));
  const [data, setData] = useState<CountyGeographySearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!searchable) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      searchCountyGeographies({ query: trimmedQuery, limit })
        .then((next) => {
          if (!cancelled) {
            setData(next);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            const message = err instanceof Error ? err.message : "Failed to search counties";
            setError(message);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmedQuery, searchable, limit, debounceMs]);

  return {
    data: searchable ? data : { items: [] },
    items: searchable ? data?.items ?? [] : [],
    loading: searchable ? loading : false,
    error: searchable ? error : null,
  };
}

export function useCountyRuns(params: {
  workspaceId?: string;
  stage?: string;
  geographyId?: string;
  limit?: number;
  refreshMs?: number;
}) {
  const { workspaceId, stage, geographyId, limit, refreshMs } = params;
  const [data, setData] = useState<CountyRunListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setData(null);
      setError(null);
      setLoading(false);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await listCountyRuns({ workspaceId, stage, geographyId, limit });
      setData(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load county runs";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [workspaceId, stage, geographyId, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!workspaceId || !refreshMs || refreshMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, refreshMs);

    return () => window.clearInterval(timer);
  }, [workspaceId, refreshMs, refresh]);

  return {
    data,
    items: data?.items ?? [],
    loading,
    error,
    refresh,
  };
}

export function useCountyRunDetail(countyRunId?: string, refreshMs?: number) {
  const [data, setData] = useState<CountyRunDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!countyRunId) {
      setData(null);
      setError(null);
      setLoading(false);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await getCountyRunDetail(countyRunId);
      setData(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load county run detail";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [countyRunId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!countyRunId || !refreshMs || refreshMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, refreshMs);

    return () => window.clearInterval(timer);
  }, [countyRunId, refreshMs, refresh]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}

export function useCountyRunScaffold(countyRunId?: string, enabled = true) {
  const [data, setData] = useState<CountyRunScaffoldResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!countyRunId || !enabled) {
      setData(null);
      setError(null);
      setLoading(false);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await getCountyRunScaffold(countyRunId);
      setData(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load county run scaffold";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [countyRunId, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}

export function useCountyRunMutations() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (input: CreateCountyRunRequest): Promise<CreateCountyRunResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      return await createCountyRun(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create county run";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const enqueue = useCallback(async (countyRunId: string): Promise<EnqueueCountyRunResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      return await enqueueCountyRun(countyRunId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to enqueue county run";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateScaffold = useCallback(
    async (countyRunId: string, input: UpdateCountyRunScaffoldRequest): Promise<CountyRunDetailResponse | null> => {
      setLoading(true);
      setError(null);
      try {
        return await updateCountyRunScaffold(countyRunId, input);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update county run scaffold";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const prepareValidation = useCallback(
    async (countyRunId: string): Promise<PrepareCountyRunValidationResponse | null> => {
      setLoading(true);
      setError(null);
      try {
        return await prepareCountyRunValidation(countyRunId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to prepare county run validation";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const refreshValidation = useCallback(
    async (countyRunId: string): Promise<CountyRunDetailResponse | null> => {
      setLoading(true);
      setError(null);
      try {
        return await refreshCountyRunValidation(countyRunId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to refresh county run validation";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const ingestManifest = useCallback(
    async (
      countyRunId: string,
      input: IngestCountyRunManifestRequest
    ): Promise<CountyRunDetailResponse | { countyRunId: string; status: "failed" } | null> => {
      setLoading(true);
      setError(null);
      try {
        return await ingestCountyRunManifest(countyRunId, input);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to ingest county run manifest";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    loading,
    error,
    create,
    enqueue,
    updateScaffold,
    prepareValidation,
    refreshValidation,
    ingestManifest,
  };
}
