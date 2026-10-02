import type { ExpressionSpecification } from "mapbox-gl";

/**
 * Census tract measures on the Corridor Analysis map: the classes the map paints
 * and the legend lists, defined once.
 *
 * WHAT THIS REPLACED. Each measure had its own multi-hue ramp: poverty ran
 * green to red, minority share navy to green, zero-vehicle households navy to
 * red. Red beside green is the pair the common forms of colour blindness lose,
 * and a green-to-red ramp on poverty reads as good-to-bad. The ramps also
 * blended smoothly between their stops while the legend listed classes, so a
 * tract's colour matched a legend swatch only at the exact break values.
 *
 * NOW: one purple, dim to bright, five classes per measure, painted with `step`
 * so a colour on the map is exactly a colour in the legend. Purple keeps these
 * apart from the blue screening-score ramp on the same map. The breaks are the
 * ones these measures already used; they are display classes, not thresholds
 * with any planning meaning.
 *
 * A value that is missing is the no-data grey, never the lowest class. A
 * measured zero is in the lowest class.
 */
export const NO_DATA_FILL_COLOR = "#64748b";

const PURPLE = ["#3f2d6b", "#5f4597", "#8564bf", "#ad8de0", "#d9c5fb"] as const;

export type TractMeasureKey =
  | "pctMinority"
  | "pctBelowPoverty"
  | "medianIncome"
  | "zeroVehiclePct"
  | "transitCommutePct";

export type TractMeasureClass = { from: number; label: string; color: string };

function classes(froms: readonly number[], labels: readonly string[]): TractMeasureClass[] {
  return froms.map((from, index) => ({ from, label: labels[index], color: PURPLE[index] }));
}

export const TRACT_MEASURE_CLASSES: Record<TractMeasureKey, TractMeasureClass[]> = {
  pctMinority: classes([0, 30, 55, 75, 90], ["Under 30%", "30% to 55%", "55% to 75%", "75% to 90%", "90% and over"]),
  pctBelowPoverty: classes([0, 10, 20, 30, 45], ["Under 10%", "10% to 20%", "20% to 30%", "30% to 45%", "45% and over"]),
  medianIncome: classes(
    [0, 45000, 70000, 100000, 150000],
    ["Under $45,000", "$45,000 to $70,000", "$70,000 to $100,000", "$100,000 to $150,000", "$150,000 and over"],
  ),
  zeroVehiclePct: classes([0, 4, 8, 12, 18], ["Under 4%", "4% to 8%", "8% to 12%", "12% to 18%", "18% and over"]),
  transitCommutePct: classes([0, 2, 5, 8, 12], ["Under 2%", "2% to 5%", "5% to 8%", "8% to 12%", "12% and over"]),
};

/** Paint `ramp` only where `property` holds a value; otherwise the no-data grey. */
export function paintWhereMeasured(property: string, ramp: ExpressionSpecification): ExpressionSpecification {
  return [
    "case",
    [
      "any",
      ["==", ["typeof", ["get", property]], "number"],
      ["==", ["typeof", ["get", property]], "string"],
    ],
    ramp,
    NO_DATA_FILL_COLOR,
  ];
}

/** The stepped paint for one measure, grey where the value is missing. */
export function tractMeasurePaint(key: TractMeasureKey): ExpressionSpecification {
  const [first, ...rest] = TRACT_MEASURE_CLASSES[key];
  return paintWhereMeasured(key, [
    "step",
    ["to-number", ["get", key]],
    first.color,
    ...rest.flatMap((entry) => [entry.from, entry.color]),
  ] as ExpressionSpecification);
}

/** Legend rows for one measure, with the no-data row last. */
export function tractMeasureLegend(key: TractMeasureKey) {
  return [
    ...TRACT_MEASURE_CLASSES[key].map(({ label, color }) => ({ label, color })),
    { label: "No data", color: NO_DATA_FILL_COLOR },
  ];
}

/**
 * The legend label for one tract value: its class, or "No data" when missing.
 * The hover inspector marks this row, so it reads the same breaks as the paint.
 */
export function tractMeasureLabelFor(key: TractMeasureKey, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "No data";
  let match = TRACT_MEASURE_CLASSES[key][0];
  for (const entry of TRACT_MEASURE_CLASSES[key]) if (value >= entry.from) match = entry;
  return match.label;
}
