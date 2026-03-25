"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CountyRunDetailResponse,
  CountyRunListResponse,
  CreateCountyRunRequest,
  CreateCountyRunResponse,
  IngestCountyRunManifestRequest,
} from "@/lib/api/county-onramp";
import {
  createCountyRun,
  getCountyRunDetail,
  ingestCountyRunManifest,
  listCountyRuns,
} from "@/lib/api/county-onramp-client";

export function useCountyRuns(params: { workspaceId?: string; stage?: string; geographyId?: string; limit?: number }) {
  const { workspaceId, stage, geographyId, limit } = params;
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

  return {
    data,
    items: data?.items ?? [],
    loading,
    error,
    refresh,
  };
}

export function useCountyRunDetail(countyRunId?: string) {
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
    ingestManifest,
  };
}
