import { seriousInjuryAvailabilityForRecord } from "@/lib/safety/serious-injury-availability";

/**
 * The serious-injury sentence for the crashes on screen, when they do not
 * separate serious injuries. The same function words it for the corridor
 * analysis and the reports, so the Safety banner cannot disagree with them
 * about the same crashes.
 */
export function SeriousInjuryCaveat({
  sourceId,
  severityCompleteness,
}: {
  sourceId: string | null | undefined;
  severityCompleteness: string;
}) {
  const seriousInjury = seriousInjuryAvailabilityForRecord({ sourceId, severityCompleteness });
  if (seriousInjury.separable) return null;
  return (
    <p className="text-muted-foreground" data-testid="safety-serious-injury-caveat">
      {seriousInjury.statement}
    </p>
  );
}
