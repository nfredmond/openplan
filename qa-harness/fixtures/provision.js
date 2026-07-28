/**
 * Shared self-provisioning helpers for the local smoke harness.
 *
 * WHY THIS EXISTS
 * ---------------
 * The local smokes used to run a checked-in demo seed and then assert against
 * its hand-written UUIDs. That proved the seed matched itself; it did not
 * prove the product works. Worse, the seed was shaped like one real county,
 * so every "proof" it produced was a proof about that county.
 *
 * These helpers let a smoke build exactly the records it needs through the
 * app's own HTTP routes, in a workspace it created seconds earlier. Two
 * consequences worth stating plainly:
 *
 *   1. Every assertion now runs against data that a real route wrote, so a
 *      broken route fails the smoke instead of a stale fixture hiding it.
 *   2. Each run is hermetic. A fresh auth user is auto-provisioned its own
 *      workspace by the `on_auth_user_created` trigger, so there is no prior
 *      run to clean up and no shared state between smokes.
 *
 * PLACE NEUTRALITY
 * ----------------
 * Nothing here names a jurisdiction, agency, or coordinate that belongs to
 * anybody. Labels are generic ("Example County"), and geometry is generated
 * around a deliberately meaningless origin — see SYNTHETIC_ORIGIN.
 */

const SYNTHETIC_GEOMETRY_STEP_DEG = 0.01;

/**
 * The origin every synthetic fixture geometry is built around: 0°N 0°E, the
 * point in the Atlantic that is famously nowhere.
 *
 * This is a deliberate choice, not laziness. A plausible-looking anchor —
 * some real downtown, some real corridor — would make fixture geometry
 * indistinguishable from real analysis geography the moment it appeared on a
 * screenshot or in a proof log, and it would quietly reintroduce the "shaped
 * like one place" defect these helpers exist to remove. An anchor that is
 * obviously nowhere can never be mistaken for somewhere.
 *
 * The geometry validators these fixtures exercise
 * (`isCorridorLineGeoJson`, `isAoiPolygonGeoJson`, `parseEngagementGeometry`)
 * are position- and range-based, so an equatorial anchor exercises them
 * exactly as any other anchor would.
 */
const SYNTHETIC_ORIGIN = Object.freeze({ lon: 0, lat: 0 });

/**
 * A synthetic county-equivalent geography for routes that require one.
 *
 * `geographyId` is intentionally NOT a real code: `00000` is outside every
 * assigned US county FIPS range, so a fixture run can never be mistaken for a
 * modeling run about a real place, and no real jurisdiction inherits QA rows.
 */
const SYNTHETIC_GEOGRAPHY = Object.freeze({
  geographyType: 'county_fips',
  geographyId: '00000',
  geographyLabel: 'Example County, Example State',
  countyPrefix: 'EXAMPLE',
});

/** A generic sponsor/funder label. Never a real agency. */
const SYNTHETIC_AGENCY_LABEL = 'Example State Transportation Agency';

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${expected}, received ${actual ?? 'null'}.`);
  }
}

function assertArray(result, label) {
  if (!result.ok) {
    throw new Error(`${label} query failed: ${result.status} ${JSON.stringify(result.data)}`);
  }
  if (!Array.isArray(result.data)) {
    throw new Error(`${label} query did not return an array: ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

function firstRow(result, label) {
  const rows = assertArray(result, label);
  const row = rows[0] ?? null;
  if (!row) {
    throw new Error(`No ${label} row returned: ${JSON.stringify(result.data)}`);
  }
  return row;
}

function assertRowCount(rows, expectedCount, label) {
  if (rows.length !== expectedCount) {
    throw new Error(`${label} count drifted. Expected ${expectedCount}, received ${rows.length}.`);
  }
}

function assertEvery(rows, predicate, label) {
  const failed = rows.filter((row) => !predicate(row));
  if (failed.length > 0) {
    throw new Error(`${label} had rows outside the expected spine: ${JSON.stringify(failed)}`);
  }
}

function inFilter(values) {
  return `in.(${values.join(',')})`;
}

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * A per-run identity. The timestamp keeps concurrent and repeated runs from
 * colliding, and makes every row this harness wrote attributable after the
 * fact without a registry.
 */
function buildRunIdentity(slug) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    stamp,
    suffix: stamp.slice(11, 19).replace(/-/g, ''),
    email: `openplan-local-${slug}-${stamp}@example.invalid`,
    password: `OpenPlan!${Date.now()}${slug.replace(/[^a-z]/gi, '')}`,
  };
}

/**
 * Create the QA auth user. Signing up is all the provisioning a workspace
 * needs — the `on_auth_user_created` trigger creates one and attaches the user
 * as owner — so this function deliberately does NOT touch `workspaces` or
 * `workspace_members`. If that trigger ever regresses, every smoke built on
 * this helper fails at the first `POST /api/projects`, which is the correct
 * outcome.
 */
async function createQaAuthUser({ supabaseUrl, serviceRoleKey, email, password, purpose }) {
  const result = await jsonFetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        purpose,
        created_by: 'qa-harness',
        created_at: new Date().toISOString(),
      },
    }),
  });

  if (!result.ok) {
    throw new Error(`Failed to create QA auth user ${email}: ${result.status} ${JSON.stringify(result.data)}`);
  }

  const userId = result.data?.user?.id ?? result.data?.id ?? null;
  assertOk(userId, `QA auth user ${email} was created without an id.`);
  return userId;
}

/**
 * Service-role read access to Postgres.
 *
 * VERIFICATION ONLY, with one named exception (see `restInsert`). A smoke that
 * writes its fixture through the service role is back to asserting against a
 * hand-written fixture — the exact failure mode this file exists to end.
 */
function createRestClient({ supabaseUrl, serviceRoleKey }) {
  const restHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  async function restSelect(table, params) {
    const query = new URLSearchParams(params);
    return jsonFetch(`${supabaseUrl}/rest/v1/${table}?${query.toString()}`, { headers: restHeaders });
  }

  async function selectRows(table, params, label) {
    return assertArray(await restSelect(table, params), label);
  }

  /**
   * Direct insert. Legitimate ONLY for a table the product exposes no write
   * route for — today that is `project_corridors`, whose only historical
   * producer was the deleted demo seed. Every call site must say which route
   * is missing, so the workaround stays visible instead of becoming a habit.
   */
  async function restInsert(table, payload, missingRouteReason) {
    assertOk(
      typeof missingRouteReason === 'string' && missingRouteReason.length > 0,
      `restInsert("${table}") requires an explicit reason naming the write route that does not exist.`
    );
    const result = await jsonFetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        ...restHeaders,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });
    if (!result.ok) {
      throw new Error(`${table} insert failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
    return Array.isArray(result.data) ? result.data : [result.data];
  }

  /**
   * Direct update. Same rule as `restInsert`: legitimate ONLY for a column the
   * product exposes no write route for. Today those are the map-anchor columns
   * `projects.latitude/longitude` and `rtp_cycles.anchor_latitude/_longitude`,
   * whose only historical producer was the deleted demo seed — which means a
   * project or RTP cycle created through the app never appears on the map.
   */
  async function restUpdate(table, filterParams, payload, missingRouteReason) {
    assertOk(
      typeof missingRouteReason === 'string' && missingRouteReason.length > 0,
      `restUpdate("${table}") requires an explicit reason naming the write route that does not exist.`
    );
    const query = new URLSearchParams(filterParams);
    const result = await jsonFetch(`${supabaseUrl}/rest/v1/${table}?${query.toString()}`, {
      method: 'PATCH',
      headers: {
        ...restHeaders,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });
    if (!result.ok) {
      throw new Error(`${table} update failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
    return Array.isArray(result.data) ? result.data : [result.data];
  }

  return { restSelect, selectRows, restInsert, restUpdate };
}

/** Sign in through the real form so the smoke holds a real session cookie. */
async function signInThroughBrowser(page, { baseUrl, email, password, landingPath = '/sign-in' }) {
  await page.goto(`${baseUrl}${landingPath}`, { waitUntil: 'networkidle' });
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20000 }),
    page.getByRole('button', { name: /^sign in$/i }).click(),
  ]);
  await page.waitForLoadState('networkidle');
}

/**
 * Call app routes from inside the signed-in page, so requests carry the same
 * session cookie a planner's browser would.
 */
function createAppFetch(page) {
  return async function appFetch(route, payload, method = payload ? 'POST' : 'GET') {
    return page.evaluate(
      async ({ route, payload, method }) => {
        const response = await fetch(route, {
          method,
          headers: payload ? { 'Content-Type': 'application/json' } : undefined,
          body: payload ? JSON.stringify(payload) : undefined,
        });
        const text = await response.text();
        let data;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
        return { ok: response.ok, status: response.status, data };
      },
      { route, payload, method }
    );
  };
}

/** POST/PATCH through the app and fail loudly with the route's own message. */
function createExpectingAppFetch(appFetch) {
  return async function expectAppFetch(route, payload, expectedStatus, label, method) {
    const result = await appFetch(route, payload, method);
    if (result.status !== expectedStatus) {
      throw new Error(`${label} failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
    return result.data;
  };
}

// ---------------------------------------------------------------------------
// Synthetic geometry — all anchored on SYNTHETIC_ORIGIN, all obviously nowhere
// ---------------------------------------------------------------------------

function syntheticPoint(index) {
  return {
    lon: SYNTHETIC_ORIGIN.lon + index * SYNTHETIC_GEOMETRY_STEP_DEG,
    lat: SYNTHETIC_ORIGIN.lat + index * SYNTHETIC_GEOMETRY_STEP_DEG,
  };
}

/** A LineString with `vertexCount` positions, offset so each index differs. */
function syntheticLineString(index, vertexCount = 4) {
  assertOk(vertexCount >= 2, 'A synthetic LineString needs at least 2 vertices.');
  const base = syntheticPoint(index);
  const coordinates = [];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    coordinates.push([
      Number((base.lon + vertex * SYNTHETIC_GEOMETRY_STEP_DEG).toFixed(6)),
      Number((base.lat + vertex * SYNTHETIC_GEOMETRY_STEP_DEG * 0.5).toFixed(6)),
    ]);
  }
  return { type: 'LineString', coordinates };
}

/** A closed rectangular ring (5 positions, first === last). */
function syntheticPolygon(index, sizeDeg = SYNTHETIC_GEOMETRY_STEP_DEG * 2) {
  const base = syntheticPoint(index);
  const minLon = Number(base.lon.toFixed(6));
  const minLat = Number(base.lat.toFixed(6));
  const maxLon = Number((base.lon + sizeDeg).toFixed(6));
  const maxLat = Number((base.lat + sizeDeg).toFixed(6));
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}

/**
 * A land-use program for the `ite_trip_generation` managed-run engine.
 *
 * This engine is the one managed run a place-neutral smoke can drive: it is a
 * pure computation over a land-use program, so unlike the corridor engine it
 * needs no real geography and no live Census/LODES coverage to succeed.
 */
function syntheticTripGenProgram({ dwellingUnits, officeKsf }) {
  return {
    lineItems: [
      {
        rate: {
          key: 'residential',
          landUse: 'Single-family detached housing',
          unitBasis: 'dwelling_unit',
          dailyTripsPerUnit: 9.4,
          amPeakShareOfDaily: 0.08,
          amInboundShare: 0.25,
          pmPeakShareOfDaily: 0.1,
          pmInboundShare: 0.63,
        },
        quantity: dwellingUnits,
      },
      {
        rate: {
          key: 'office',
          landUse: 'General office building',
          unitBasis: 'ksf',
          dailyTripsPerUnit: 9.7,
          amPeakShareOfDaily: 0.12,
          amInboundShare: 0.88,
          pmPeakShareOfDaily: 0.13,
          pmInboundShare: 0.17,
        },
        quantity: officeKsf,
      },
    ],
    avgTripLengthMiles: 5,
    comparisonBasis: 'no_build_zero',
  };
}

module.exports = {
  SYNTHETIC_AGENCY_LABEL,
  SYNTHETIC_GEOGRAPHY,
  SYNTHETIC_ORIGIN,
  assertArray,
  assertEqual,
  assertEvery,
  assertOk,
  assertRowCount,
  buildRunIdentity,
  createAppFetch,
  createExpectingAppFetch,
  createQaAuthUser,
  createRestClient,
  firstRow,
  inFilter,
  isoDaysFromNow,
  jsonFetch,
  signInThroughBrowser,
  syntheticLineString,
  syntheticPoint,
  syntheticPolygon,
  syntheticTripGenProgram,
};
