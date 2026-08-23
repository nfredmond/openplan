"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type {
  AerialOrthoCatalog,
  AerialOrthoCatalogState,
  ResolvedAerialOrthoLayer,
  VerifiedAerialOrthoLayer,
} from "@/lib/aerial/ortho-map-layers";

type AerialOrthoLayerContextValue = {
  workspaceId: string | null;
  catalogState: AerialOrthoCatalogState;
  layers: VerifiedAerialOrthoLayer[];
  notes: string[];
  selected: Record<string, boolean>;
  failures: Record<string, string>;
  focusRequest: { custodyId: string; sequence: number } | null;
  setSelected: (custodyId: string, on: boolean) => void;
  toggleSelected: (custodyId: string) => void;
  requestFocus: (custodyId: string) => void;
  setLayerFailure: (custodyId: string, message: string | null) => void;
};

const AerialOrthoLayerContext = createContext<AerialOrthoLayerContextValue | null>(null);
const STORAGE_PREFIX = "openplan.cartographic.aerialOrthos";

function storageKey(workspaceId: string | null): string {
  return `${STORAGE_PREFIX}.${workspaceId ?? "none"}`;
}

export function readStoredAerialOrthoSelection(workspaceId: string | null): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, boolean] =>
        typeof entry[1] === "boolean"
      ),
    );
  } catch {
    return {};
  }
}

function storeSelection(workspaceId: string | null, selection: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(selection));
  } catch {
    // The toggles still work for this session if browser storage is blocked.
  }
}

export function AerialOrthoLayerProvider({
  workspaceId,
  children,
}: {
  workspaceId: string | null;
  children: React.ReactNode;
}) {
  const [catalogState, setCatalogState] = useState<AerialOrthoCatalogState>("absent");
  const [layers, setLayers] = useState<VerifiedAerialOrthoLayer[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [selected, setSelectedState] = useState<Record<string, boolean>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [focusRequest, setFocusRequest] = useState<{ custodyId: string; sequence: number } | null>(null);

  useEffect(() => {
    if (!workspaceId) return;

    const controller = new AbortController();
    fetch("/api/map-layers/aerial-orthos", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as Partial<AerialOrthoCatalog>;
        if (!response.ok || !payload.state || !Array.isArray(payload.layers)) {
          throw new Error("catalog response was unreadable");
        }
        return payload as AerialOrthoCatalog;
      })
      .then((catalog) => {
        if (controller.signal.aborted) return;
        setCatalogState(catalog.state);
        setLayers(catalog.layers);
        setNotes(catalog.notes);
        const stored = readStoredAerialOrthoSelection(workspaceId);
        const live = new Set(catalog.layers.map((layer) => layer.custodyId));
        const next = Object.fromEntries(
          Object.entries(stored).filter(([custodyId, on]) => live.has(custodyId) && on),
        );
        // Newly processed imagery is deliberately absent from `next`, so it is
        // never switched on just because the catalog changed.
        setSelectedState(next);
        setFailures((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([custodyId]) => live.has(custodyId))),
        );
        storeSelection(workspaceId, next);
      })
      .catch((error) => {
        if ((error as { name?: string }).name === "AbortError") return;
        setCatalogState("unreadable");
        setLayers([]);
        setNotes([
          "OpenPlan could not read the aerial preview catalog. This is not a finding that no imagery exists.",
        ]);
        // Keep the stored selection. A failed read must not erase a planner's
        // choice and then present the next successful read as a fresh default.
        setSelectedState(readStoredAerialOrthoSelection(workspaceId));
      });

    return () => controller.abort();
  }, [workspaceId]);

  const setSelected = useCallback(
    (custodyId: string, on: boolean) => {
      const live = new Set(layers.map((layer) => layer.custodyId));
      if (!live.has(custodyId)) return;
      setSelectedState((previous) => {
        const next = { ...previous };
        if (on) next[custodyId] = true;
        else delete next[custodyId];
        storeSelection(workspaceId, next);
        return next;
      });
      if (!on) {
        setFailures((previous) => {
          const next = { ...previous };
          delete next[custodyId];
          return next;
        });
      }
    },
    [layers, workspaceId],
  );

  const toggleSelected = useCallback(
    (custodyId: string) => setSelected(custodyId, selected[custodyId] !== true),
    [selected, setSelected],
  );

  const requestFocus = useCallback((custodyId: string) => {
    if (!layers.some((layer) => layer.custodyId === custodyId)) return;
    setFocusRequest((previous) => ({ custodyId, sequence: (previous?.sequence ?? 0) + 1 }));
  }, [layers]);

  const setLayerFailure = useCallback((custodyId: string, message: string | null) => {
    setFailures((previous) => {
      const next = { ...previous };
      if (message) next[custodyId] = message;
      else delete next[custodyId];
      return next;
    });
  }, []);

  const value = useMemo<AerialOrthoLayerContextValue>(
    () => ({
      workspaceId,
      catalogState,
      layers,
      notes,
      selected,
      failures,
      focusRequest,
      setSelected,
      toggleSelected,
      requestFocus,
      setLayerFailure,
    }),
    [workspaceId, catalogState, layers, notes, selected, failures, focusRequest, setSelected, toggleSelected, requestFocus, setLayerFailure],
  );

  return <AerialOrthoLayerContext.Provider value={value}>{children}</AerialOrthoLayerContext.Provider>;
}

const EMPTY_SELECTION: Record<string, boolean> = {};
const EMPTY_FAILURES: Record<string, string> = {};
const EMPTY_LAYERS: VerifiedAerialOrthoLayer[] = [];
const NOOP = () => {};

export function useAerialOrthoLayers(): AerialOrthoLayerContextValue {
  const context = useContext(AerialOrthoLayerContext);
  return context ?? {
    workspaceId: null,
    catalogState: "absent",
    layers: EMPTY_LAYERS,
    notes: [],
    selected: EMPTY_SELECTION,
    failures: EMPTY_FAILURES,
    focusRequest: null,
    setSelected: NOOP,
    toggleSelected: NOOP,
    requestFocus: NOOP,
    setLayerFailure: NOOP,
  };
}

export async function resolveAerialOrthoLayer(
  custodyId: string,
  signal?: AbortSignal,
): Promise<ResolvedAerialOrthoLayer> {
  const response = await fetch(
    `/api/map-layers/aerial-orthos?custodyId=${encodeURIComponent(custodyId)}`,
    { credentials: "same-origin", signal },
  );
  const payload = (await response.json()) as {
    state?: string;
    layer?: ResolvedAerialOrthoLayer;
    detail?: string;
  };
  if (!response.ok || payload.state !== "verified" || !payload.layer) {
    throw new Error(payload.detail ?? "The aerial preview could not be loaded.");
  }
  return payload.layer;
}
