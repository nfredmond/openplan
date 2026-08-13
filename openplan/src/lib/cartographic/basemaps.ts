/**
 * The registry of map backgrounds a person may switch between.
 *
 * WHY A REGISTRY AND NOT A LIST IN A COMPONENT. Twelve map call sites in this
 * product each hardcode their own `mapbox://styles/...` string, and the two
 * engagement maps disagree with the RTP cycle map about what a map should look
 * like for the same reason: nobody could see the other one's literal. A picker
 * built the same way would be a thirteenth. The style ids live here, once; a
 * component receives resolved choices and never spells a style URL.
 *
 * WHAT A TOKEN ACTUALLY BUYS YOU — the constraint that shapes this file.
 * A Mapbox access token can load two kinds of style: the ones Mapbox itself
 * publishes under the `mapbox` account, and the ones owned by the token's OWN
 * account. OpenPlan is self-hosted by people whose Mapbox accounts it cannot
 * know, so a Studio style id is unverifiable from here: offering one would put a
 * choice on a resident's screen that resolves to a 404 and a blank rectangle.
 * An option that silently shows nothing is worse than not offering the option.
 * So the registry contains Mapbox-published styles ONLY, and that is a
 * capability statement, not a preference — see `describeBasemapAvailability`.
 *
 * WHAT IS AND IS NOT A HARDCODED PLACE. A style id names a cartographic design,
 * not a jurisdiction: `streets-v12` renders a rural county and Nairobi alike, and
 * nothing here fixes a bbox, a country, or an agency. The one thing an operator
 * genuinely may want to vary — WHICH of these are offered, and which opens
 * first — is configuration, read from the environment below.
 */

/** Stable ids. These appear in operator configuration, so they are an API. */
export const PUBLIC_BASEMAP_IDS = [
  "streets",
  "satellite",
  "terrain",
  "light",
  "dark",
] as const;

export type PublicBasemapId = (typeof PUBLIC_BASEMAP_IDS)[number];

export type PublicBasemapChoice = {
  id: PublicBasemapId;
  /**
   * The style Mapbox GL is handed. Only ever a `mapbox://styles/mapbox/…` URL —
   * see the header: any other account's style cannot be verified from here.
   */
  styleUrl: string;
  /**
   * What a resident reads. Deliberately not the cartographic name: nobody
   * outside GIS calls this a "basemap", and "Mapbox Standard Satellite" tells a
   * person looking for their own street nothing about what they will see.
   */
  label: string;
  /** One sentence, in the same register. Shown under the label. */
  description: string;
  /**
   * Whether the background is dark. Drawn shapes and the resident's own sketch
   * are coloured against it, so the caller may need to know.
   */
  dark: boolean;
};

/**
 * Every background OpenPlan knows how to offer.
 *
 * ORDER IS THE DEFAULT OFFER ORDER, and it starts with streets on purpose. The
 * engagement maps have opened on `dark-v11` since they were built, which is a
 * night-mode cartography chosen for a planner's dashboard. A resident who
 * arrived from a postcard is looking for their own street on a phone in
 * daylight, and a dark map is the wrong thing to hand them.
 */
const BASEMAP_REGISTRY: Record<PublicBasemapId, PublicBasemapChoice> = {
  streets: {
    id: "streets",
    styleUrl: "mapbox://styles/mapbox/streets-v12",
    label: "Streets",
    description: "Roads, place names and landmarks.",
    dark: false,
  },
  satellite: {
    id: "satellite",
    styleUrl: "mapbox://styles/mapbox/satellite-streets-v12",
    label: "Satellite",
    description: "Photographs from above, with street names on top.",
    dark: true,
  },
  terrain: {
    id: "terrain",
    styleUrl: "mapbox://styles/mapbox/outdoors-v12",
    label: "Terrain",
    description: "Hills, trails, parks and waterways.",
    dark: false,
  },
  light: {
    id: "light",
    styleUrl: "mapbox://styles/mapbox/light-v11",
    label: "Plain and pale",
    description: "A quiet background, so the marked shapes stand out.",
    dark: false,
  },
  dark: {
    id: "dark",
    styleUrl: "mapbox://styles/mapbox/dark-v11",
    label: "Plain and dark",
    description: "A quiet dark background, easier at night.",
    dark: true,
  },
};

/** Offered when the operator has configured nothing. */
const DEFAULT_OFFER: PublicBasemapId[] = ["streets", "satellite", "terrain", "light"];

/** Comma-separated ids: which backgrounds this deployment offers, in order. */
export const PUBLIC_BASEMAP_OFFER_ENV = "OPENPLAN_PUBLIC_BASEMAPS";
/** A single id: which one a map opens on. */
export const PUBLIC_BASEMAP_DEFAULT_ENV = "OPENPLAN_PUBLIC_BASEMAP_DEFAULT";

export type PublicBasemapConfig = {
  /** In offer order. EMPTY means: draw no picker (and, with no token, no map). */
  choices: PublicBasemapChoice[];
  /** The id a map opens on, or null when `choices` is empty. */
  defaultId: PublicBasemapId | null;
  /**
   * Operator-facing, never shown to a resident: what was asked for in the
   * environment and could not be honoured. A configured id OpenPlan does not
   * know is dropped rather than passed through to Mapbox, because passing it
   * through is how a blank rectangle reaches the public.
   */
  configNotes: string[];
};

function isKnownId(value: string): value is PublicBasemapId {
  return (PUBLIC_BASEMAP_IDS as readonly string[]).includes(value);
}

function parseIdList(raw: string | undefined): { ids: PublicBasemapId[]; unknown: string[] } {
  const ids: PublicBasemapId[] = [];
  const unknown: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (isKnownId(token)) {
      if (!ids.includes(token)) ids.push(token);
    } else if (!unknown.includes(token)) {
      unknown.push(token);
    }
  }
  return { ids, unknown };
}

/**
 * What this deployment may offer, given its token and its configuration.
 *
 * CALL THIS ON THE SERVER and pass the result down. Two reasons: the picker
 * component then holds no environment access and no style literal at all, and
 * the token check happens before a map stage is ever rendered.
 *
 * NO TOKEN, NO CHOICES. `resolvePublicMapboxToken` returns `""` for a missing
 * token and for a mis-scoped secret one. Either way Mapbox GL will draw
 * nothing, and a background picker over a map that does not exist is a control
 * that lies about what it does.
 */
export function resolvePublicBasemapConfig(options: {
  mapboxToken: string;
  /**
   * Typed as a plain record rather than `NodeJS.ProcessEnv` deliberately: the
   * latter requires `NODE_ENV`, so every test that wants to vary one variable
   * has to either cast or fabricate an environment. `process.env` satisfies
   * this, and a resolver that is awkward to test under a chosen environment is
   * a resolver whose configuration branches go unmeasured.
   */
  env?: Record<string, string | undefined>;
}): PublicBasemapConfig {
  const env = options.env ?? process.env;
  const configNotes: string[] = [];

  if (!options.mapboxToken) {
    return { choices: [], defaultId: null, configNotes };
  }

  const offer = parseIdList(env[PUBLIC_BASEMAP_OFFER_ENV]);
  for (const bad of offer.unknown) {
    configNotes.push(
      `${PUBLIC_BASEMAP_OFFER_ENV} names “${bad}”, which OpenPlan does not know, so it is not offered. ` +
        `Known backgrounds: ${PUBLIC_BASEMAP_IDS.join(", ")}.`
    );
  }

  const ids = offer.ids.length > 0 ? offer.ids : DEFAULT_OFFER;
  const choices = ids.map((id) => BASEMAP_REGISTRY[id]);

  const requestedDefault = (env[PUBLIC_BASEMAP_DEFAULT_ENV] ?? "").trim();
  let defaultId: PublicBasemapId = choices[0].id;
  if (requestedDefault) {
    if (isKnownId(requestedDefault) && ids.includes(requestedDefault)) {
      defaultId = requestedDefault;
    } else {
      configNotes.push(
        `${PUBLIC_BASEMAP_DEFAULT_ENV} is “${requestedDefault}”, which is not among the backgrounds this ` +
          `deployment offers, so maps open on “${defaultId}” instead.`
      );
    }
  }

  return { choices, defaultId, configNotes };
}

/**
 * The honest sentence about why the list is what it is.
 *
 * Exported so an operator-facing surface can say it rather than each one
 * inventing its own account of a limit that is Mapbox's, not OpenPlan's.
 */
export function describeBasemapAvailability(): string {
  return (
    "These are the map backgrounds Mapbox publishes for every access token. A style you designed in " +
    "Mapbox Studio is not offered: it only loads for the account that owns it, and OpenPlan cannot check " +
    "from here whose token this deployment uses — so the option would resolve to an empty map for some " +
    "installs and work for others."
  );
}
