"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useAerialOrthoLayers, resolveAerialOrthoLayer } from "./aerial-ortho-layer-context";
import {
  paintAerialOrthoLayers,
  type AerialOrthoMapTarget,
} from "@/lib/cartographic/aerial-ortho-map-layers";
import type { ResolvedAerialOrthoLayer } from "@/lib/aerial/ortho-map-layers";

const REFRESH_BEFORE_EXPIRY_MS = 60_000;

export function useAerialOrthoMapBinding(input: {
  mapRef: { current: AerialOrthoMapTarget | null };
  ready: boolean;
  enabled: boolean;
  resolveAnchorLayerId: (map: AerialOrthoMapTarget) => string | undefined;
}) {
  const { layers, selected, focusRequest, setLayerFailure } = useAerialOrthoLayers();
  const [resolved, setResolved] = useState<Record<string, ResolvedAerialOrthoLayer>>({});
  const anchorResolverRef = useRef(input.resolveAnchorLayerId);
  const knownCustodyIdsRef = useRef(new Set<string>());
  anchorResolverRef.current = input.resolveAnchorLayerId;
  for (const layer of layers) knownCustodyIdsRef.current.add(layer.custodyId);

  const selectedIds = useMemo(
    () => layers.filter((layer) => selected[layer.custodyId] === true).map((layer) => layer.custodyId),
    [layers, selected],
  );
  const selectedKey = selectedIds.join(",");

  useEffect(() => {
    if (!input.enabled) return;
    const selectedSet = new Set(selectedIds);
    setResolved((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([id]) => selectedSet.has(id))),
    );

    const controllers: AbortController[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    const load = (custodyId: string) => {
      const controller = new AbortController();
      controllers.push(controller);
      resolveAerialOrthoLayer(custodyId, controller.signal)
        .then((layer) => {
          if (controller.signal.aborted) return;
          setResolved((previous) => ({ ...previous, [custodyId]: layer }));
          setLayerFailure(custodyId, null);
          const delay = Math.max(Date.parse(layer.expiresAt) - Date.now() - REFRESH_BEFORE_EXPIRY_MS, 1_000);
          timers.push(setTimeout(() => load(custodyId), delay));
        })
        .catch((error) => {
          if ((error as { name?: string }).name === "AbortError") return;
          setLayerFailure(
            custodyId,
            error instanceof Error ? error.message : "The preview could not be loaded.",
          );
        });
    };

    for (const custodyId of selectedIds) load(custodyId);
    return () => {
      controllers.forEach((controller) => controller.abort());
      timers.forEach((timer) => clearTimeout(timer));
    };
    // selectedKey is the stable identity of the explicit planner selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.enabled, selectedKey, setLayerFailure]);

  useEffect(() => {
    const map = input.mapRef.current;
    if (!map || !input.ready || !input.enabled) return;
    const paint = () =>
      paintAerialOrthoLayers(map, {
        // Keep IDs seen earlier in this mounted map. If custody is later
        // withdrawn, the current catalog no longer contains the ID that tells
        // the painter which stale Mapbox source must be removed.
        catalogCustodyIds: [...knownCustodyIdsRef.current],
        layers: Object.values(resolved),
        anchorLayerId: anchorResolverRef.current(map),
      });

    paint();
    const eventMap = map as AerialOrthoMapTarget & {
      on?: (event: string, handler: () => void) => void;
      off?: (event: string, handler: () => void) => void;
    };
    eventMap.on?.("style.load", paint);
    return () => eventMap.off?.("style.load", paint);
  }, [input.mapRef, input.ready, input.enabled, layers, resolved]);

  useEffect(() => {
    const map = input.mapRef.current;
    if (!map || !input.ready || !input.enabled || !focusRequest) return;
    const layer = layers.find((candidate) => candidate.custodyId === focusRequest.custodyId);
    if (!layer || selected[layer.custodyId] !== true) return;
    const [west, south, east, north] = layer.bounds;
    map.fitBounds?.([[west, south], [east, north]], { padding: 72, maxZoom: 19 });
  }, [input.mapRef, input.ready, input.enabled, layers, selected, focusRequest]);

}
