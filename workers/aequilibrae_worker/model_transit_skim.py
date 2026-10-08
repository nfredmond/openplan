"""Numerical skimming of a prepared feed, without worker startup or source reads.

Callers may pass explicit numerical settings or use local defaults. This does not
establish explicit setting transfer, retained byte custody or OS containment.
"""
from datetime import datetime, timezone
import gtfs_skim

def _transit_feed_summary(los, *, settings=None) -> dict:
    """What a successfully skimmed feed reports about ITSELF, for the evidence panel.

    Extracted so the two skim paths — a run's chosen workspace feed and the
    discovered/operator/bundled feed — cannot report a different set of facts.
    A shared capability living inside one of its two callers gets reimplemented
    wrongly by the other; that has already happened twice in this repo.

    Every value here is derived by the worker's OWN parser from the bytes it
    read. The `feed_service_*_date` values that sit beside these in the packet
    come from the database instead, and the two are deliberately kept apart:
    migration 20260805000006 records that a feed's calendar-derived window and
    the window its ingest recorded legitimately disagree, and collapsing them
    would destroy the evidence that they did.
    """
    settings = gtfs_skim.skim_settings() if settings is None else settings
    return {
        "service_day": los.service_day,
        "service_start": los.service_start,
        "service_end": los.service_end,
        # None — not the string "None..None" — when the feed's calendar states no
        # window. An unknown service window must not render downstream as a
        # confident one.
        "service_period": (
            f"{los.service_start}..{los.service_end}"
            if los.service_start and los.service_end
            else None
        ),
        "n_routes": los.n_routes,
        "n_served_stops": los.n_stops,
        "n_lines": len(los.lines),
        "skim_settings": settings.to_record(),
        "access_buffer_miles": settings.access_miles,
        "flat_fare_usd": settings.flat_fare_usd,
        # Trips published as a headway band rather than departure times. Excluded
        # from the skim and counted, so a transit share built from part of a feed
        # never presents itself as one built from all of it.
        "frequency_trips_excluded": los.frequency_trips_excluded,
        "scheduled_trips_used": los.scheduled_trips_used,
        # ── THE EXPIRY DISCLOSURE, ON EVERY ORIGIN ────────────────────────────
        # `schedule_expired` had exactly ONE caller — the chosen-workspace-feed
        # path — so a run that used the operator's GTFS_URL, a discovered catalog
        # feed, or the feed bundled with the worker modeled from a schedule of
        # any age with nothing on any surface admitting it. That is not a corner
        # case: the bundled feed is expired TODAY, and it is what every
        # deployment without a workspace feed models transit from.
        #
        # Derived from the PARSER'S OWN calendar window here, so the disclosure
        # is produced by the same function that produces the skim summary and
        # cannot be present on one path and missing on the other. The chosen-feed
        # path overwrites these three with the values its INGEST recorded — see
        # `skim_selected_feed_version` — because migration 20260805000006 records
        # that the two windows legitimately disagree.
        "feed_service_end_date": gtfs_skim.iso_service_date(los.service_end),
        "feed_schedule_expired": gtfs_skim.schedule_expired(
            gtfs_skim.iso_service_date(los.service_end)
        ),
        # "Expired" is a claim about a MOMENT, and this run is the moment. A
        # packet re-read next year must not present today's answer as timeless.
        "feed_expiry_evaluated_at": datetime.now(timezone.utc).isoformat(),
    }


_INGEST_AUTHORITATIVE_FEED_KEYS = (
    "feed_service_start_date",
    "feed_service_end_date",
    "feed_schedule_expired",
    "feed_expiry_evaluated_at",
)


def _feed_expiry_log_note(meta: dict) -> str:
    """The run-log sentence for a schedule that has already ended, or "".

    ONE sentence, shared by both skim paths. An expired schedule is the ORDINARY
    case — three of four real Sacramento-area feeds are expired, SacRT's by
    sixteen months — and is usually still the right thing to model with, being
    the last schedule the agency published. It must simply never be silent, and
    it must not be silent on some origins and loud on others.
    """
    if not meta.get("feed_schedule_expired"):
        return ""
    return (
        "NOTE: this feed's published service ended on "
        f"{meta.get('feed_service_end_date')}. It is still the schedule the agency last "
        "published, and it is what this run's transit level of service was built from — "
        "but it is not the schedule in force today.\n"
    )


def skim_prepared_feed_version(los, prepared_meta: dict, lons, lats, *,
                               deadline: float | None = None,
                               feed_origin: str = "workspace_feed_version",
                               settings: gtfs_skim.TransitSkimSettings | None = None) -> tuple:
    """Compute the skim from an already loaded feed and its original metadata.

    Loading, source selection and credentialed reads belong to the caller.
    Preserve ingest facts while adding the parser's numerical summary.
    """
    settings = gtfs_skim.skim_settings() if settings is None else settings
    meta = dict(prepared_meta)
    meta["source_url"] = los.source_url
    meta["source_name"] = los.source_name

    log = _feed_expiry_log_note(meta)
    if meta.get("feed_version_is_current") is False:
        log += (
            "NOTE: a newer ingest of this feed exists and is the one the Data Hub now shows. "
            "This run deliberately skimmed the version it was launched with, so its numbers "
            "stay reproducible.\n"
        )
    if los.frequency_trips_excluded:
        log += (
            f"{los.frequency_trips_excluded} trip(s) in this feed are defined by "
            "frequencies.txt (a published headway band rather than departure times) and were "
            f"excluded; {los.scheduled_trips_used} scheduled trip(s) were skimmed.\n"
        )

    gtfs_skim.check_deadline(deadline, "reading and parsing the chosen feed")
    if not gtfs_skim.feed_covers(los, lons, lats, buffer_miles=settings.access_miles):
        # A chosen feed with no stops in the study area is a fact about THAT FEED.
        # It must not be reported as `no_local_feed`, which asserts that a feed was
        # looked for and none covers the area — nobody checked that here, and the
        # claim would then sit under a VMT number a planner has to defend.
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_has_no_stops_in_study_area",
            "The transit feed chosen for this run has no stops inside this study area, so it "
            "was not skimmed. Pick the feed that serves this area, or launch without one and "
            "let the worker look for a covering feed.",
        )

    skim = gtfs_skim.transit_skim(los, lons, lats, deadline=deadline, settings=settings)
    # THE INGEST'S OWN SERVICE WINDOW WINS ON THIS PATH. `_transit_feed_summary`
    # derives an expiry from the parser's calendar for the origins that have no
    # database row behind them; here there IS one, and migration 20260805000006
    # records that the two windows legitimately disagree in real feeds. Letting
    # the summary overwrite them would destroy the evidence that they did — and
    # would silently change what the expiry statement above was computed from.
    _from_ingest = {k: meta[k] for k in _INGEST_AUTHORITATIVE_FEED_KEYS if k in meta}
    meta.update(_transit_feed_summary(los, settings=settings))
    meta.update(_from_ingest)
    log += (
        f"Transit LOS from {los.source_url or los.source_name} "
        f"({feed_origin}): {los.n_routes} route(s), {los.n_stops} served stop(s), "
        f"service day {los.service_day}, service window "
        f"{meta['service_period'] or 'not stated in the feed calendar'}.\n"
    )
    return meta, skim, log
