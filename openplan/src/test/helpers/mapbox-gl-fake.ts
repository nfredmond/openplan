/**
 * A MAPBOX GL DOUBLE THAT ACTUALLY RUNS THE MAP CODE.
 *
 * ============================================================================
 * WHY THIS EXISTS — the mock that proved nothing
 * ============================================================================
 *
 * Every test touching the participant map mocked `mapbox-gl` with an object
 * whose `isStyleLoaded()` returned false and whose `once()` was `vi.fn()` — a
 * no-op that recorded a callback and never called it. The map component's whole
 * drawing path lives inside a `paint()` closure handed to
 * `map.once("style.load", paint)`, so in every one of those tests `paint` NEVER
 * RAN. Nothing about pins, submitted shapes, popups, context layers, the camera
 * or the style was under test at all, and the suite was green while the surface
 * was broken: four separate mutations survived, including DELETING THE ENTIRE
 * LEGEND from the stage.
 *
 * A fake whose lifecycle never advances is not a fake of a map. This one is a
 * small state machine with the three transitions a Mapbox map really has:
 *
 *     new Map({ style })   → a style is requested, nothing is loaded
 *     loadStyle()          → `style.load` fires; `isStyleLoaded()` becomes true
 *     failStyle()          → an `error` event, exactly as Mapbox reports a
 *                            revoked token, a URL-restricted one, or a blocked
 *                            api.mapbox.com — by EVENT, never by throwing
 *
 * plus a real source/layer registry, so `syncContextLayers` — which reads
 * `getStyle().layers`, retires what it no longer wants and re-registers what it
 * does — exercises its whole path, and `setStyle()` wipes that registry the way
 * a real style swap does. A test can then ask what is actually ON the map
 * rather than what a component says it asked for.
 *
 * ============================================================================
 * WHAT IT STILL CANNOT PROVE — read this before believing a green result
 * ============================================================================
 *
 * It is not Mapbox. It renders nothing, measures nothing, and projects nothing.
 * It cannot show that a style URL is valid, that a layer is visible, that a
 * colour is legible, that a tap target is reachable, or that the map fills the
 * viewport. It also cannot prove the REAL library fires the events this one
 * fires — that mapping was read off Mapbox's documented event names and has to
 * be re-checked in a browser after any major-version bump. What it proves is
 * the wiring on OpenPlan's side of the boundary, which is where every defect
 * this file was written for actually lived.
 *
 * ============================================================================
 * HOW TO USE IT
 * ============================================================================
 *
 *     vi.mock("mapbox-gl", async () => {
 *       const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
 *       return createMapboxGlModuleFake();
 *     });
 *
 *     // …render…
 *     const map = lastFakeMap();
 *     act(() => map.loadStyle());          // the paint closure runs HERE
 *     expect(map.layerIds()).toContain(…);
 *
 * `vi.mock` factories are hoisted above imports, so the module is reached
 * through a dynamic import inside the factory; the registry below is module
 * state, and a test that imports this helper normally sees the very same
 * instances the mocked module produced. Call `resetFakeMaps()` in `afterEach`.
 */

type Listener = (event?: unknown) => void;

export type FakeMapOptions = {
  container?: unknown;
  style?: string;
  center?: [number, number];
  zoom?: number;
  [key: string]: unknown;
};

export type FakeMarkerRecord = {
  element: HTMLElement | null;
  lngLat: [number, number] | null;
  popupContent: HTMLElement | null;
  added: boolean;
  removed: boolean;
};

export type FakeFitBounds = {
  bounds: FakeLngLatBounds;
  options: Record<string, unknown> | undefined;
};

/** A bounds object that records what was extended into it. */
export class FakeLngLatBounds {
  readonly positions: [number, number][] = [];

  extend(position: [number, number] | { lng: number; lat: number }): this {
    if (Array.isArray(position)) this.positions.push([position[0], position[1]]);
    else this.positions.push([position.lng, position.lat]);
    return this;
  }

  isEmpty(): boolean {
    return this.positions.length === 0;
  }
}

class FakeControl {
  constructor(readonly options?: unknown) {}
}

class FakePopup {
  content: HTMLElement | null = null;
  lngLat: [number, number] | null = null;
  addedTo: FakeMapboxMap | null = null;

  constructor(readonly options?: unknown) {}

  setLngLat(value: [number, number]): this {
    this.lngLat = value;
    return this;
  }

  setDOMContent(node: HTMLElement): this {
    this.content = node;
    return this;
  }

  addTo(map: FakeMapboxMap): this {
    this.addedTo = map;
    map.openPopups.push(this);
    return this;
  }

  remove(): this {
    return this;
  }
}

class FakeMarker {
  readonly record: FakeMarkerRecord;
  private popup: FakePopup | null = null;

  constructor(options?: { element?: HTMLElement }) {
    this.record = {
      element: options?.element ?? null,
      lngLat: null,
      popupContent: null,
      added: false,
      removed: false,
    };
  }

  setLngLat(value: [number, number]): this {
    this.record.lngLat = value;
    return this;
  }

  setPopup(popup: FakePopup): this {
    this.popup = popup;
    this.record.popupContent = popup.content;
    return this;
  }

  addTo(map: FakeMapboxMap): this {
    this.record.added = true;
    map.markers.push(this);
    return this;
  }

  remove(): this {
    this.record.removed = true;
    return this;
  }

  /** The popup a resident would open by tapping this pin. */
  popupContent(): HTMLElement | null {
    return this.popup?.content ?? null;
  }
}

type RegisteredLayer = { id: string; spec: Record<string, unknown>; beforeId?: string };

/**
 * The registry lives on `globalThis`, not in a module-level array, and that is
 * not incidental. A suite that calls `vi.resetModules()` — every test of this
 * surface does, because the map component reads its token at module scope —
 * gets a SECOND copy of this helper: the one the `vi.mock` factory imports and
 * the one the test file imported are then different modules with different
 * arrays, and the test looks for maps in an array nothing ever wrote to. The
 * symptom is "no map was constructed" on a page that built one.
 */
const REGISTRY = Symbol.for("openplan.test.mapbox-gl-fake.instances");
const registry = ((globalThis as Record<symbol, unknown>)[REGISTRY] ??= []) as FakeMapboxMap[];

export class FakeMapboxMap {

  readonly options: FakeMapOptions;
  readonly controls: unknown[] = [];
  readonly markers: FakeMarker[] = [];
  readonly openPopups: FakePopup[] = [];
  readonly fitBoundsCalls: FakeFitBounds[] = [];
  readonly setStyleCalls: string[] = [];
  readonly panByCalls: [number, number][] = [];
  removed = false;
  keyboardEnabled = true;

  /** Current style URL and whether it has finished loading. */
  styleUrl: string | undefined;
  private styleLoaded = false;

  private sources = new Map<string, { data: unknown; setData: (data: unknown) => void }>();
  private layers: RegisteredLayer[] = [];
  private listeners = new Map<string, Listener[]>();
  private onceListeners = new Map<string, Listener[]>();

  readonly keyboard = { disable: () => { this.keyboardEnabled = false; } };

  constructor(options: FakeMapOptions) {
    this.options = options;
    this.styleUrl = options.style;
    registry.push(this);
  }

  // ── the lifecycle a test drives ──────────────────────────────────────────

  /**
   * The style arrived. Fires `style.load` for both `on` and `once` listeners,
   * which is the transition every drawing path in this product waits on.
   */
  loadStyle(): void {
    this.styleLoaded = true;
    this.emit("style.load");
  }

  /**
   * Mapbox reports a revoked token, a URL-restricted one, a wrong-scope one and
   * a blocked host all the same way: an `error` EVENT. Never a throw — which is
   * why a stage without an error handler shows a grey rectangle forever.
   */
  failStyle(message = "Unauthorized: invalid token"): void {
    this.emit("error", { error: { message } });
  }

  /** Fire any registered handler, e.g. a map click or `movestart`. */
  emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    const onces = this.onceListeners.get(type) ?? [];
    this.onceListeners.set(type, []);
    for (const listener of onces) listener(event);
  }

  /** Fire a layer-scoped handler, e.g. a click on a submitted shape. */
  emitOnLayer(type: string, layerId: string, event?: unknown): void {
    for (const listener of this.listeners.get(`${type}::${layerId}`) ?? []) listener(event);
  }

  // ── what the map code calls ──────────────────────────────────────────────

  on(type: string, layerIdOrHandler: string | Listener, maybeHandler?: Listener): void {
    const key = typeof layerIdOrHandler === "string" ? `${type}::${layerIdOrHandler}` : type;
    const handler = typeof layerIdOrHandler === "string" ? maybeHandler : layerIdOrHandler;
    if (!handler) return;
    this.listeners.set(key, [...(this.listeners.get(key) ?? []), handler]);
  }

  once(type: string, handler: Listener): void {
    this.onceListeners.set(type, [...(this.onceListeners.get(type) ?? []), handler]);
  }

  off(): void {}

  addControl(control: unknown): void {
    this.controls.push(control);
  }

  isStyleLoaded(): boolean {
    return this.styleLoaded;
  }

  /**
   * A real style swap throws away every source and layer, which is why the
   * stage repaints from scratch on `style.load`. A fake that kept the registry
   * would hide a repaint that never happened.
   */
  setStyle(url: string): void {
    this.setStyleCalls.push(url);
    this.styleUrl = url;
    this.styleLoaded = false;
    this.sources.clear();
    this.layers = [];
  }

  getSource(id: string): unknown {
    return this.sources.get(id);
  }

  addSource(id: string, source: { data?: unknown }): void {
    const entry = {
      data: source?.data,
      setData: (data: unknown) => {
        entry.data = data;
      },
    };
    this.sources.set(id, entry);
  }

  removeSource(id: string): void {
    this.sources.delete(id);
  }

  getLayer(id: string): unknown {
    return this.layers.find((layer) => layer.id === id);
  }

  addLayer(spec: { id: string } & Record<string, unknown>, beforeId?: string): void {
    this.layers.push({ id: spec.id, spec, beforeId });
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((layer) => layer.id !== id);
  }

  getStyle(): { layers: Array<{ id: string }> } {
    return { layers: this.layers.map((layer) => ({ id: layer.id })) };
  }

  getCenter(): { lng: number; lat: number } {
    const center = (this.options.center as [number, number]) ?? [0, 0];
    return { lng: center[0], lat: center[1] };
  }

  project(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }

  panBy(offset: [number, number]): void {
    this.panByCalls.push(offset);
  }

  zoomIn(): void {}
  zoomOut(): void {}
  resize(): void {}

  fitBounds(bounds: FakeLngLatBounds, options?: Record<string, unknown>): void {
    this.fitBoundsCalls.push({ bounds, options });
  }

  getCanvas(): { setAttribute: () => void; style: Record<string, string> } {
    return { setAttribute: () => {}, style: {} };
  }

  remove(): void {
    this.removed = true;
  }

  // ── what a test asks ─────────────────────────────────────────────────────

  /** Every layer id currently registered, in the order they were added. */
  layerIds(): string[] {
    return this.layers.map((layer) => layer.id);
  }

  layer(id: string): RegisteredLayer | undefined {
    return this.layers.find((entry) => entry.id === id);
  }

  sourceIds(): string[] {
    return [...this.sources.keys()];
  }

  sourceData(id: string): unknown {
    return this.sources.get(id)?.data;
  }

  /** Only the pins still on the map — the paint path removes and rebuilds them. */
  liveMarkers(): FakeMarkerRecord[] {
    return this.markers.filter((marker) => !marker.record.removed).map((marker) => marker.record);
  }

  markerPopups(): (HTMLElement | null)[] {
    return this.markers.filter((marker) => !marker.record.removed).map((marker) => marker.popupContent());
  }
}

/** Every map constructed since the last reset, oldest first. */
export function fakeMaps(): readonly FakeMapboxMap[] {
  return registry;
}

/**
 * The map the component under test just built. Throws rather than returning
 * undefined: a test that silently skipped its assertions because no map existed
 * is exactly the failure this helper was written to end.
 */
export function lastFakeMap(): FakeMapboxMap {
  const map = registry.at(-1);
  if (!map) throw new Error("No mapbox map was constructed — the component rendered no map at all.");
  return map;
}

export function resetFakeMaps(): void {
  registry.length = 0;
}

/**
 * The module shape `import mapboxgl from "mapbox-gl"` and
 * `import { Map } from "mapbox-gl"` both expect.
 */
export function createMapboxGlModuleFake() {
  const api = {
    Map: FakeMapboxMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    NavigationControl: FakeControl,
    AttributionControl: FakeControl,
    LngLatBounds: FakeLngLatBounds,
    accessToken: "",
  };
  return { default: api, ...api };
}
