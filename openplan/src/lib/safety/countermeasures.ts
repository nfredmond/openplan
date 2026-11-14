/**
 * The countermeasure list a planner can attach to a high-injury segment.
 *
 * The list lives in a versioned data file with its source and retrieval date,
 * not in components. This module only validates and reads it. The list never
 * applies a crash modification factor by itself. An entry's note names up to
 * three CMF Clearinghouse entries, read on a stated day, for the planner to
 * choose from; an entry with none read carries a visible [VERIFY] note.
 *
 * Each entry also records whether it is on FHWA's Proven Safety
 * Countermeasures list. FHWA removed four items OpenPlan carries between June
 * 30 and July 10, 2026. They stay so saved plans keep them, and every place
 * that shows or prints an entry states that fact through
 * `countermeasureListStatus`.
 */

import { z } from "zod";
import fhwaProvenSafetyCountermeasures from "./countermeasures/fhwa-proven-safety-countermeasures.v1.json";

export const COUNTERMEASURE_CRASH_TYPES = [
  "pedestrian",
  "bicyclist",
  "speed_related",
  "roadway_departure",
  "nighttime",
  "intersection_turning",
  "intersection_angle",
  "rear_end",
] as const;
export type CountermeasureCrashType = (typeof COUNTERMEASURE_CRASH_TYPES)[number];

export const COUNTERMEASURE_CRASH_TYPE_LABELS: Record<CountermeasureCrashType, string> = {
  pedestrian: "Pedestrian",
  bicyclist: "Bicyclist",
  speed_related: "Speed-related",
  roadway_departure: "Roadway departure",
  nighttime: "Nighttime",
  intersection_turning: "Turning at intersections",
  intersection_angle: "Angle at intersections",
  rear_end: "Rear-end",
};

export const COUNTERMEASURE_FOCUS_AREAS = [
  "speed_management",
  "pedestrian_bicyclist",
  "roadway_departure",
  "intersections",
  "crosscutting",
] as const;

const httpsUrl = z.string().regex(/^https:\/\/[^\s]+$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** An Internet Archive capture of an FHWA page. */
const fhwaCaptureUrl = z.string().regex(/^https:\/\/web\.archive\.org\/web\/\d{8,14}\/https:\/\/highways\.dot\.gov\/[^\s]+$/);
const LIVE_FHWA_URL = /^https:\/\/highways\.dot\.gov\//;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-07-10" as "July 10, 2026", from the string itself so no host time zone applies. */
function longDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** The digits of an ISO date, as they start an Internet Archive timestamp. */
function captureStamp(date: string): string {
  return date.replace(/-/g, "");
}

/**
 * Whether the item is on FHWA's list. `removed` records the captures that show
 * the change and the capture of the item's former FHWA page, which the entry
 * cites in place of a live URL that no longer resolves.
 */
const fhwaListSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("on_list") }).strict(),
  z.object({
    status: z.literal("removed"),
    lastSeenOnList: isoDate,
    firstMissingFromList: isoDate,
    stillMissingOn: isoDate,
    listCaptureUrl: fhwaCaptureUrl,
    formerPageCapturedOn: isoDate,
    readOn: isoDate,
  }).strict().refine(
    (entry) => entry.lastSeenOnList < entry.firstMissingFromList && entry.firstMissingFromList <= entry.stillMissingOn
      && entry.stillMissingOn <= entry.readOn && entry.formerPageCapturedOn <= entry.lastSeenOnList
      && entry.listCaptureUrl.startsWith(`https://web.archive.org/web/${captureStamp(entry.stillMissingOn)}`),
    { message: "A removal must cite captures in date order, and the list capture of its newest date" },
  ),
]);

const CMF_ENTRY_URL = /^https:\/\/cmfclearinghouse\.fhwa\.dot\.gov\/detail\.php\?facid=\d+$/;

const cmfSchema = z.object({
  value: z.number().positive().lt(10),
  cmfId: z.number().int().positive(),
  url: z.string().regex(CMF_ENTRY_URL),
  appliesTo: z.string().min(1),
});

/**
 * One CMF Clearinghouse entry a note names, as its page gave it on the day it
 * was read. `stars` is null for an entry the Clearinghouse cannot rate (some
 * Highway Safety Manual factors). These entries inform the planner; the list
 * never applies one (`cmf` stays null).
 */
const cmfEntrySchema = z.object({
  id: z.number().int().positive(),
  factor: z.number().positive().lt(10),
  stars: z.number().int().min(1).max(5).nullable(),
  url: z.string().regex(CMF_ENTRY_URL),
}).strict().refine((entry) => entry.url.endsWith(`facid=${entry.id}`), { message: "A Clearinghouse entry must cite its own page" });
type CmfEntry = z.infer<typeof cmfEntrySchema>;

const STAR_WORDS = ["one", "two", "three", "four", "five"];

/** The Clearinghouse ids a note names, in order, each written "entry 1234". */
function cmfEntryIdsNamed(note: string): number[] {
  return [...note.matchAll(/\bentry (\d+)/g)].map((match) => Number(match[1]));
}

/**
 * A read note names exactly its entries, each followed (before the next
 * "entry") by its factor and star rating as the Clearinghouse gives them, and
 * the day it was read. It carries no bracketed marker: exports count those.
 */
function readNoteMatchesEntries(note: string, entries: readonly CmfEntry[], readOn: string): boolean {
  const named = cmfEntryIdsNamed(note);
  if (note.includes("[") || !note.includes(`read ${longDate(readOn)}`)) return false;
  if (named.length !== entries.length || new Set(named).size !== named.length) return false;
  const segments = note.split(/(?=\bentry \d+)/).slice(1);
  return entries.every((entry) => {
    const index = named.indexOf(entry.id);
    if (index < 0) return false;
    const stars = entry.stars === null ? "not star-rated" : `${STAR_WORDS[entry.stars - 1]} star`;
    return segments[index].includes(String(entry.factor)) && segments[index].includes(stars);
  });
}

const countermeasureSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1),
    focusArea: z.enum(COUNTERMEASURE_FOCUS_AREAS),
    crashTypes: z.array(z.enum(COUNTERMEASURE_CRASH_TYPES)).min(1),
    addresses: z.string().min(1),
    sourceUrl: httpsUrl,
    fhwaList: fhwaListSchema,
    cmf: cmfSchema.nullable(),
    cmfNote: z.string().optional(),
    /** The day the entries in `cmfEntries` were read; present exactly when they are. */
    cmfReadOn: isoDate.optional(),
    cmfEntries: z.array(cmfEntrySchema).min(1).max(3).optional(),
  })
  .refine(
    (entry) => entry.cmf !== null || entry.cmfEntries !== undefined || (entry.cmfNote ?? "").includes("[VERIFY]"),
    { message: "A countermeasure without a cited CMF or a read Clearinghouse entry must carry a [VERIFY] note" },
  )
  .refine(
    (entry) => (entry.cmfEntries === undefined) === (entry.cmfReadOn === undefined),
    { message: "Clearinghouse entries need the date they were read, and a read date needs entries" },
  )
  .refine(
    (entry) => entry.cmfEntries === undefined
      ? cmfEntryIdsNamed(entry.cmfNote ?? "").length === 0
      : readNoteMatchesEntries(entry.cmfNote ?? "", entry.cmfEntries, entry.cmfReadOn ?? ""),
    { message: "A note must name exactly its read Clearinghouse entries, each with its factor and stars, and the day read, with no marker" },
  )
  .refine(
    (entry) => entry.cmf === null || entry.cmf.url.endsWith(`facid=${entry.cmf.cmfId}`),
    { message: "A CMF value must cite its own Clearinghouse entry" },
  )
  // An item on the list cites FHWA's live page. A removed item cites the
  // capture of its former page, so it is never cited as a current list item.
  .refine(
    (entry) => entry.fhwaList.status === "on_list"
      ? LIVE_FHWA_URL.test(entry.sourceUrl)
      : fhwaCaptureUrl.safeParse(entry.sourceUrl).success
        && entry.sourceUrl.startsWith(`https://web.archive.org/web/${captureStamp(entry.fhwaList.formerPageCapturedOn)}`),
    { message: "An item on FHWA's list cites its FHWA page; a removed item cites the capture of its former page" },
  );

export const countermeasureFileSchema = z.object({
  schema: z.literal("openplan.safety_countermeasures.v1"),
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.object({
    title: z.string().min(1),
    publisher: z.string().min(1),
    url: httpsUrl,
    terms: z.string().min(1),
    retrievedOn: isoDate,
    newestCaptureOn: isoDate,
    newestCaptureUrl: fhwaCaptureUrl,
    retrievalNote: z.string().min(1),
  }),
  listNote: z.string().min(1),
  cmfPolicy: z.string().min(1),
  countermeasures: z.array(countermeasureSchema).min(1),
});

export type CountermeasureFile = z.infer<typeof countermeasureFileSchema>;
export type SafetyCountermeasure = CountermeasureFile["countermeasures"][number];

/** Validate a countermeasure file. Throws with the first problem found. */
export function parseCountermeasureFile(raw: unknown): CountermeasureFile {
  const parsed = countermeasureFileSchema.parse(raw);
  const ids = new Set<string>();
  for (const entry of parsed.countermeasures) {
    if (ids.has(entry.id)) throw new Error(`Duplicate countermeasure id: ${entry.id}`);
    ids.add(entry.id);
  }
  return parsed;
}

export const SAFETY_COUNTERMEASURE_FILE: CountermeasureFile = parseCountermeasureFile(fhwaProvenSafetyCountermeasures);
export const SAFETY_COUNTERMEASURES: readonly SafetyCountermeasure[] = SAFETY_COUNTERMEASURE_FILE.countermeasures;

export function getSafetyCountermeasure(id: string): SafetyCountermeasure | null {
  return SAFETY_COUNTERMEASURES.find((entry) => entry.id === id) ?? null;
}

function monthYear(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

function removedPhrase(entry: SafetyCountermeasure): string | null {
  if (entry.fhwaList.status !== "removed") return null;
  return `not on FHWA's Proven Safety Countermeasures list since ${monthYear(entry.fhwaList.firstMissingFromList)}`;
}

/** One line for an item FHWA removed from its list; null for an item on it. */
export function countermeasureListStatus(entry: SafetyCountermeasure): string | null {
  const phrase = removedPhrase(entry);
  return phrase ? `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.` : null;
}

/** The item's name, followed by its status in parentheses when FHWA removed it. */
export function countermeasureLabel(entry: SafetyCountermeasure): string {
  const phrase = removedPhrase(entry);
  return phrase ? `${entry.name} (${phrase})` : entry.name;
}

/** The status line with the captures behind it, for printed documents. */
export function countermeasureListStatusDetail(entry: SafetyCountermeasure): string | null {
  const line = countermeasureListStatus(entry);
  if (!line || entry.fhwaList.status !== "removed") return null;
  const list = entry.fhwaList;
  return `${line} Internet Archive captures of FHWA's list show it on ${longDate(list.lastSeenOnList)} and not on ${longDate(list.firstMissingFromList)} or ${longDate(list.stillMissingOn)}. The source is FHWA's former page for it, captured ${longDate(list.formerPageCapturedOn)} and read ${longDate(list.readOn)}.`;
}

/** The one sentence about funding programs, printed only beside a removed item. */
export const COUNTERMEASURE_FUNDING_CHECK =
  "Check the current notice of funding opportunity for what a program counts as an eligible or proven countermeasure.";

/**
 * The source line printed under any countermeasure table. `ids` limits the
 * note about removed items to the items a plan uses; without it the whole
 * list is described.
 */
export function describeCountermeasureSource(options: { ids?: readonly string[]; file?: CountermeasureFile } = {}): string {
  const file = options.file ?? SAFETY_COUNTERMEASURE_FILE;
  const inScope = options.ids
    ? file.countermeasures.filter((entry) => options.ids!.includes(entry.id))
    : file.countermeasures;
  const base = `Source: ${file.source.publisher}, ${file.source.title}, ${file.source.url}, read from Internet Archive captures, newest ${file.source.newestCaptureOn} (${file.source.newestCaptureUrl}). Retrieved ${file.source.retrievedOn}; list version ${file.version}.`;
  if (!inScope.some((entry) => entry.fhwaList.status === "removed")) return base;
  return `${base} An item marked as not on FHWA's list cites the Internet Archive capture of its former FHWA page. ${COUNTERMEASURE_FUNDING_CHECK}`;
}
