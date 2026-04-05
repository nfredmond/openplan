"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export function LocationPickerMap({
  latitude,
  longitude,
  onLocationChange,
}: {
  latitude: string;
  longitude: string;
  onLocationChange: (lat: string, lng: string) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-121.0, 39.2], // rough fallback center (e.g. Nevada County ish)
      zoom: 8,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("click", (e) => {
      const lat = e.lngLat.lat.toFixed(5);
      const lng = e.lngLat.lng.toFixed(5);
      onLocationChange(lat, lng);
      
      if (!markerRef.current) {
        markerRef.current = new mapboxgl.Marker({ color: "hsl(var(--primary))" })
          .setLngLat([e.lngLat.lng, e.lngLat.lat])
          .addTo(map);
      } else {
        markerRef.current.setLngLat([e.lngLat.lng, e.lngLat.lat]);
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onLocationChange]);

  // Sync prop changes to marker
  useEffect(() => {
    if (!mapRef.current) return;
    
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    
    if (!isNaN(lat) && !isNaN(lng)) {
      if (!markerRef.current) {
        markerRef.current = new mapboxgl.Marker({ color: "hsl(var(--primary))" })
          .setLngLat([lng, lat])
          .addTo(mapRef.current);
      } else {
        markerRef.current.setLngLat([lng, lat]);
      }
      mapRef.current.flyTo({ center: [lng, lat], zoom: Math.max(mapRef.current.getZoom(), 13) });
    } else if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, [latitude, longitude]);

  if (!MAPBOX_ACCESS_TOKEN) {
    return (
      <div className="flex h-[200px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground p-4 text-center">
        Map is unavailable because Mapbox access token is missing.
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border">
      <div ref={mapContainerRef} className="h-[240px] w-full bg-muted/10" />
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
        {latitude && longitude ? (
          <>
            <span className="font-mono text-muted-foreground">
              {latitude}, {longitude}
            </span>
            <button
              type="button"
              className="ml-2 font-medium text-destructive hover:underline"
              onClick={() => onLocationChange("", "")}
            >
              Clear
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">Click the map to drop a pin</span>
        )}
      </div>
    </div>
  );
}
