import type { ExpressionSpecification } from "mapbox-gl";

/**
 * Fixed classes for daily assigned volume (passenger-car equivalents per day),
 * shared by the traffic volume map's paint and its legend.
 *
 * FIXED, NOT SCALED TO THE RUN. The map used to stretch its colours between zero
 * and the busiest link in each run, so a road drawn red in a small county run
 * could carry a tenth of the traffic of a road drawn red in a metro run, and the
 * legend could only say "Low" and "High". These classes are the same on every
 * run, so a colour means the same volume wherever it appears, and the legend
 * states the numbers.
 *
 * The breaks are display classes chosen to separate local streets, collectors
 * and arterials, and higher-volume roads at a glance. They are not functional
 * classification thresholds and carry no planning standard.
 *
 * COLOURS are five samples from the upper part of the magma ramp: one
 * direction from dim to bright, perceptually even, and readable with the common
 * forms of colour blindness. The darkest part of the ramp is left out because
 * this map sits on a dark basemap, where it disappeared. The old ramp ran teal,
 * green, yellow, orange, red.
 */
export const TRAFFIC_VOLUME_CLASSES = [
  { from: 0, label: "Under 5,000", color: "#b5367a", width: 1.5 },
  { from: 5000, label: "5,000 to 10,000", color: "#e55964", width: 2.5 },
  { from: 10000, label: "10,000 to 20,000", color: "#fb8761", width: 3.5 },
  { from: 20000, label: "20,000 to 40,000", color: "#fec287", width: 5 },
  { from: 40000, label: "40,000 and over", color: "#fcfdbf", width: 7 },
] as const;

function stepBy(property: string, pick: (entry: (typeof TRAFFIC_VOLUME_CLASSES)[number]) => string | number) {
  const [first, ...rest] = TRAFFIC_VOLUME_CLASSES;
  return [
    "step",
    ["to-number", ["get", property], 0],
    pick(first),
    ...rest.flatMap((entry) => [entry.from, pick(entry)]),
  ] as ExpressionSpecification;
}

export function trafficVolumeColor(property = "pce_tot"): ExpressionSpecification {
  return stepBy(property, (entry) => entry.color);
}

export function trafficVolumeWidth(property = "pce_tot"): ExpressionSpecification {
  return stepBy(property, (entry) => entry.width);
}

/** The class a volume falls in, for a popup swatch that matches the line. */
export function trafficVolumeClass(volume: number) {
  let match: (typeof TRAFFIC_VOLUME_CLASSES)[number] = TRAFFIC_VOLUME_CLASSES[0];
  for (const entry of TRAFFIC_VOLUME_CLASSES) if (volume >= entry.from) match = entry;
  return match;
}
