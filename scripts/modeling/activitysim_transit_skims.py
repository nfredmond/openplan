"""Opt-in, scheduled GTFS skims for prototype_mtc, using SciPy Dijkstra.

Time-expanded directed graphs preserve missed connections and on-board dwell.
No demand, observed choices, or AequilibraE assignment enters this calculation.
"""
from __future__ import annotations

import argparse
from bisect import bisect_left
from collections import defaultdict
import csv
from datetime import date
import hashlib
import io
import json
import math
from pathlib import Path
import platform
import sys
import zipfile

PERIODS = {"EA": (0, 5), "AM": (5, 9), "MD": (9, 14), "PM": (14, 18), "EV": (18, 24)}
FAMILIES = {"LOC", "EXP", "HVY", "LRF", "COM", "TRN"}
TYPE_FAMILY = {"0": "LRF", "1": "HVY", "2": "COM", "3": "LOC", "4": "LRF"}
COMPONENTS = ("TOTIVT", "KEYIVT", "FERRYIVT", "IWAIT", "XWAIT", "WAIT", "BOARDS",
              "WACC", "WEGR", "WAUX", "DTIM", "DDIST", "FAR", "TOTAL", "TRANSFERS")


class TransitUnavailable(ValueError):
    """An input cannot support scheduled transit skims; retain the reason."""


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require_runtime():
    if platform.python_implementation() != "CPython" or sys.version_info[:2] != (3, 11):
        raise TransitUnavailable("Transit computation requires CPython 3.11")


def number(value, name, *, positive=False):
    value = float(value)
    if not math.isfinite(value) or value < 0 or (positive and value == 0):
        raise TransitUnavailable(f"{name} must be finite and {'positive' if positive else 'nonnegative'}")
    return value


def seconds(value):
    parts = value.split(":")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise TransitUnavailable(f"Missing or invalid scheduled time: {value!r}")
    h, m, s = map(int, parts)
    if m >= 60 or s >= 60:
        raise TransitUnavailable("Invalid GTFS minute or second")
    return h * 3600 + m * 60 + s


def rows(archive, name, required=False):
    if name not in archive.namelist():
        if required:
            raise TransitUnavailable(f"Missing GTFS table {name}")
        return iter(())
    # Stream stop_times instead of retaining the full multi-week table.
    return csv.DictReader(io.TextIOWrapper(archive.open(name), encoding="utf-8-sig", newline=""))


def keyed(records, key):
    result = {}
    for row in records:
        value = row[key]
        if not value or value in result:
            raise TransitUnavailable(f"Empty or duplicate {key}")
        result[value] = row
    return result


def load_feed(path, service_date, route_families):
    day = date.fromisoformat(service_date)
    stamp = day.strftime("%Y%m%d")
    weekday = day.strftime("%A").lower()
    with zipfile.ZipFile(path) as z:
        if list(rows(z, "frequencies.txt")):
            raise TransitUnavailable("Frequency-based service is unsupported; no invented departure phase")
        stops = keyed(rows(z, "stops.txt", True), "stop_id")
        routes = keyed(rows(z, "routes.txt", True), "route_id")
        active = {r["service_id"] for r in rows(z, "calendar.txt")
                  if r["start_date"] <= stamp <= r["end_date"] and r[weekday] == "1"}
        exceptions = []
        for r in rows(z, "calendar_dates.txt"):
            if r["date"] != stamp:
                continue
            exceptions.append(r)
            if r["exception_type"] == "1":
                active.add(r["service_id"])
            elif r["exception_type"] == "2":
                active.discard(r["service_id"])
            else:
                raise TransitUnavailable("Invalid calendar exception")
        trips = {k: v for k, v in keyed(rows(z, "trips.txt", True), "trip_id").items()
                 if v["service_id"] in active}
        if not trips:
            raise TransitUnavailable(f"No service on {service_date}")
        stop_times = defaultdict(list)
        for r in rows(z, "stop_times.txt", True):
            if r["trip_id"] not in trips:
                continue
            if r["stop_id"] not in stops:
                raise TransitUnavailable(f"Unmatched stop {r['stop_id']}")
            if r.get("pickup_type", "0") not in ("", "0", "1") or r.get("drop_off_type", "0") not in ("", "0", "1"):
                raise TransitUnavailable("Demand-responsive pickup/drop-off is unsupported")
            stop_times[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"],
                seconds(r["arrival_time"]), seconds(r["departure_time"]),
                r.get("pickup_type") != "1", r.get("drop_off_type") != "1"))
        services = []
        for tid, trip in sorted(trips.items()):
            route = routes.get(trip["route_id"])
            if route is None:
                raise TransitUnavailable("Trip references an unmatched route")
            family = route_families.get(trip["route_id"], TYPE_FAMILY.get(route["route_type"]))
            if family not in FAMILIES - {"TRN"}:
                raise TransitUnavailable(f"Unsupported route type or family: {route['route_type']}")
            times = sorted(stop_times[tid])
            if len(times) < 2 or len({r[0] for r in times}) != len(times):
                raise TransitUnavailable(f"Missing or duplicate stop sequence: {tid}")
            previous = -1
            for _, sid, arr, dep, _, _ in times:
                if arr < previous or dep < arr:
                    raise TransitUnavailable(f"Nonmonotonic timetable: {tid}")
                previous = dep
            services.append((tid, trip["route_id"], family, route["route_type"] == "4", times))
        transfers = list(rows(z, "transfers.txt"))
        for r in transfers:
            if any(r.get(k) for k in ("from_trip_id", "to_trip_id", "from_route_id", "to_route_id")):
                raise TransitUnavailable("Trip/route-specific transfer rules are unsupported")
            if r["from_stop_id"] not in stops or r["to_stop_id"] not in stops:
                raise TransitUnavailable("Unmatched transfer stop")
            if r["transfer_type"] not in ("0", "2", "3"):
                raise TransitUnavailable("Timed/in-seat transfer rules are unsupported")
        agencies = list(rows(z, "agency.txt", True))
        timezones = sorted({r["agency_timezone"] for r in agencies})
        if len(timezones) != 1:
            raise TransitUnavailable("One agency timezone is required per input feed")
        custody = {"active_service_ids": sorted(active), "calendar_exceptions": exceptions,
                   "service_date": service_date, "agency_timezone": timezones[0],
                   "feed_info": list(rows(z, "feed_info.txt")), "active_trips": len(services),
                   "calendar_handling": "inclusive calendar range and weekday, then date additions/removals; GTFS times may exceed 24:00; no adjacent service-day merge"}
        fares = list(rows(z, "fare_attributes.txt"))
        fare_rules = list(rows(z, "fare_rules.txt"))
    return stops, services, transfers, custody, fares, fare_rules


def distance_m(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    v = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(v)))


def coordinates(lon, lat):
    lon, lat = float(lon), float(lat)
    if not math.isfinite(lon+lat) or not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise TransitUnavailable("Invalid zone/stop coordinates")
    return lon, lat


def connectors(zones, stops, served, settings):
    radius = number(settings["walk_access_m"], "walk_access_m", positive=True)
    speed = number(settings["walk_mps"], "walk_mps", positive=True)
    points = {sid: coordinates(stops[sid]["stop_lon"], stops[sid]["stop_lat"]) for sid in sorted(served)}
    walk = []
    for z in zones:
        point = coordinates(z["centroid_lon"], z["centroid_lat"])
        walk.append({sid: (d/speed, 0.0) for sid, p in points.items() if (d := distance_m(point, p)) <= radius})
    drive_in = [dict() for _ in zones]
    drive_out = [dict() for _ in zones]
    position = {int(float(z["zone_id"])): i for i, z in enumerate(zones)}
    for row in settings.get("drive_connectors", []):
        if not row.get("source") or int(row["zone_id"]) not in position or row["stop_id"] not in served:
            raise TransitUnavailable("Unmatched or unsourced drive connector")
        if row["direction"] not in ("access", "egress"):
            raise TransitUnavailable("Drive connector direction must be access or egress")
        target = drive_in if row["direction"] == "access" else drive_out
        i, sid = position[int(row["zone_id"])], row["stop_id"]
        if sid in target[i]:
            raise TransitUnavailable("Duplicate drive connector")
        target[i][sid] = (number(row["minutes"], "drive minutes", positive=True)*60,
                          number(row["miles"], "drive miles", positive=True))
    return walk, drive_in, drive_out, points


def fare_for_path(boardings, fares, rules, policy):
    """Return nominal USD or None. Complex fares remain unknown, never zero."""
    if policy:
        if policy.get("kind") == "route_period_single_boarding":
            # This bounded policy cannot price transfers, zone fares or discounts.
            if not policy.get("source"):
                raise TransitUnavailable("Fare policy source is required")
            if len(boardings) != 1:
                return None
            route, when = boardings[0]
            schedule = policy.get("route_fares", {}).get(route)
            if schedule is None:
                return None
            matching = [r for r in schedule if seconds(r["start"]) <= when < seconds(r["end"])]
            if len(matching) != 1:
                return None
            return number(matching[0]["usd"], "route fare usd")
        if not policy.get("source") or policy.get("kind") != "flat_per_boarding":
            raise TransitUnavailable("Only sourced flat_per_boarding fare overrides are supported")
        return len(boardings) * number(policy["usd"], "fare usd")
    if rules or len(fares) != 1 or fares[0].get("currency_type") != "USD":
        return None
    fare = fares[0]
    price = number(fare["price"], "fare price")
    allowed = int(fare["transfers"]) if fare.get("transfers") else math.inf
    duration = number(fare["transfer_duration"], "transfer duration") if fare.get("transfer_duration") else math.inf
    total, used, start = 0.0, math.inf, -math.inf
    for _, when in boardings:
        if used >= allowed or when-start > duration:
            total += price
            start, used = when, 0
        else:
            used += 1
    return total


class TimetableGraph:
    """Two layers require a ride on the named primary mode, with local feeders."""
    def __init__(self, services, transfers, points, family, start, end, settings):
        import numpy as np
        from scipy.sparse import csr_matrix
        self.nodes = []
        self.edges = {}
        self.departures = defaultdict(list)
        self.arrivals = defaultdict(list)
        self.family = family
        def node(kind, sid, t):
            self.nodes.append((kind, sid, t))
            return len(self.nodes)-1
        def edge(a, b, kind, detail=None):
            elapsed = self.nodes[b][2]-self.nodes[a][2]
            if elapsed < 0:
                raise TransitUnavailable("Backward edge in timetable")
            self.edges[a, b] = (elapsed, kind, detail)
        onboard = []
        for tid, rid, mode, ferry, times in services:
            if family != "TRN" and mode not in {"LOC", family}:
                continue
            previous = None
            for _, sid, arr, dep, pickup, dropoff in times:
                if dep < start or arr > end:
                    previous = None
                    continue
                a, d = node("arrival", sid, arr), node("departure", sid, dep)
                edge(a, d, "ride", (mode, ferry))
                if previous is not None:
                    edge(previous, a, "ride", (mode, ferry))
                previous = d
                onboard.append((a, d, sid, arr, dep, pickup, dropoff, rid))
                if pickup:
                    self.departures[sid].append(dep)
                if dropoff:
                    self.arrivals[sid].append(a)
        timelines = {}
        for sid, times in self.departures.items():
            times = sorted(set(times))
            ids = [node("platform", sid, t) for t in times]
            self.departures[sid] = times
            timelines[sid] = ids
            for a, b in zip(ids, ids[1:]):
                edge(a, b, "wait")
        self.timelines = timelines
        min_transfer = number(settings["min_transfer_seconds"], "min_transfer_seconds")
        transfer_map = defaultdict(dict)
        for sid in points:
            transfer_map[sid][sid] = (min_transfer, 0.0)
        for r in transfers:
            a, b = r["from_stop_id"], r["to_stop_id"]
            if a not in points or b not in points:
                continue
            if r["transfer_type"] == "3":
                transfer_map[a].pop(b, None)
                continue
            walk = distance_m(points[a], points[b])/settings["walk_mps"]
            duration = max(walk, number(r.get("min_transfer_time") or min_transfer, "transfer time"))
            transfer_map[a][b] = (duration, walk)
        for a, d, sid, arr, dep, pickup, dropoff, rid in onboard:
            if pickup:
                edge(timelines[sid][bisect_left(self.departures[sid], dep)], d, "board", (rid, dep))
            if dropoff:
                for other, (duration, walk) in transfer_map[sid].items():
                    ts = self.departures.get(other, [])
                    k = bisect_left(ts, arr+duration)
                    if k < len(ts):
                        edge(a, timelines[other][k], "transfer", walk)
        self.size = len(self.nodes)
        rr, cc, vv = [], [], []
        for (a, b), (elapsed, kind, detail) in self.edges.items():
            qualifies = kind == "ride" and elapsed > 0 and (family == "TRN" or detail[0] == family)
            rr.extend((a, a+self.size))
            cc.extend((b+self.size if qualifies else b, b+self.size))
            vv.extend((elapsed, elapsed))
        self.base = csr_matrix((np.array(vv, dtype=float), (rr, cc)), shape=(2*self.size+1, 2*self.size+1))

    def skim_origin(self, access, destinations, start, max_seconds, drive_access, drive_egress, fares, rules, policy):
        import numpy as np
        from scipy.sparse import csr_matrix
        from scipy.sparse.csgraph import dijkstra
        source = 2*self.size
        cols, weights, source_detail = [], [], {}
        for sid, (duration, miles) in access.items():
            ts = self.departures.get(sid, [])
            k = bisect_left(ts, start+duration)
            if k < len(ts):
                target = self.timelines[sid][k]
                cols.append(target)
                weights.append(ts[k]-start)
                source_detail[target] = (duration, miles)
        if not cols:
            return [None]*len(destinations)
        # Sparse addition drops explicit zero edges. Keep them in the base and
        # append only the source row, whose entries cannot overlap base edges.
        graph = csr_matrix((np.concatenate((self.base.data, np.array(weights))),
                            np.concatenate((self.base.indices, np.array(cols, dtype=np.int32))),
                            np.concatenate((self.base.indptr[:-1], [len(self.base.data)+len(cols)]))),
                           shape=self.base.shape)
        distances, pred = dijkstra(graph, directed=True, indices=source, return_predecessors=True, limit=max_seconds)
        best_arrivals = {}
        for sid, arrivals in self.arrivals.items():
            ids = np.asarray(arrivals, dtype=np.int32) + self.size
            selected = int(ids[np.argmin(distances[ids])])
            if math.isfinite(distances[selected]):
                best_arrivals[sid] = selected
        result = []
        for target_access in destinations:
            candidates = [(distances[a+self.size]+duration, a+self.size, duration, miles)
                          for sid, (duration, miles) in target_access.items()
                          if sid in best_arrivals
                          for a in [best_arrivals[sid]-self.size]
                          if distances[a+self.size]+duration <= max_seconds]
            if not candidates:
                result.append(None)
                continue
            total, target, egress, egress_miles = min(candidates)
            path = []
            while pred[target] != source:
                previous = int(pred[target])
                if previous < 0:
                    raise TransitUnavailable("Broken predecessor chain")
                path.append(self.edges[previous % self.size, target % self.size])
                target = previous
            access_seconds, access_miles = source_detail[target]
            first_wait = self.nodes[target][2]-start-access_seconds
            ivt = key = ferry = xwait = xwalk = 0.0
            boards = []
            for elapsed, kind, detail in reversed(path):
                if kind == "ride":
                    ivt += elapsed
                    if detail[0] == self.family and self.family != "LOC" and not detail[1]:
                        key += elapsed
                    if detail[1]:
                        ferry += elapsed
                elif kind == "board":
                    boards.append(detail)
                else:
                    walk = detail if kind == "transfer" else 0.0
                    xwalk += walk
                    if boards:
                        xwait += elapsed-walk
                    else:
                        first_wait += elapsed-walk
            fare = fare_for_path(boards, fares, rules, policy)
            result.append({"TOTIVT": ivt/60, "KEYIVT": key/60, "FERRYIVT": ferry/60,
                "IWAIT": first_wait/60, "XWAIT": xwait/60, "WAIT": (first_wait+xwait)/60,
                "BOARDS": len(boards), "TRANSFERS": max(0,len(boards)-1), "WACC": 0.0 if drive_access else access_seconds/60,
                "WEGR": 0.0 if drive_egress else egress/60, "WAUX": xwalk/60,
                "DTIM": (access_seconds if drive_access else egress if drive_egress else 0)/60,
                "DDIST": access_miles if drive_access else egress_miles if drive_egress else 0,
                "FAR": fare, "TOTAL": total/60})
        return result


def build_transit_skims(zones, config):
    """Return raw minutes/miles/USD with NaN missingness plus a custody record."""
    require_runtime()
    import numpy as np
    import scipy
    record = {"schema": "openplan.activitysim-transit.v1", "status": "unavailable", "config": config,
              "python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__,
              "implementation_sha256": sha256(__file__),
              "method": "scheduled time-expanded directed SciPy Dijkstra; earliest arrival; local feeders plus mandatory primary mode",
              "units": {"times": "minutes", "DDIST": "miles", "FAR": "nominal USD", "BOARDS": "count", "TRANSFERS": "count"},
              "missingness": "NaN components with AVAILABLE=false; fare unknown has FAR=NaN and USABLE=false; zero fare requires a source",
              "mtc_encoding": "times and drive miles multiplied by 100; fares converted to cents; boards unscaled; unavailable TOTIVT=0",
              "zone_ids": [int(float(z["zone_id"])) for z in zones],
              "zone_sha256": hashlib.sha256(json.dumps(list(zones),sort_keys=True).encode()).hexdigest()}
    output = {}
    try:
        if len(set(record["zone_ids"])) != len(zones) or not zones:
            raise TransitUnavailable("Empty or duplicate zone system")
        if not config.get("feed_url") or not config.get("terms_url"):
            raise TransitUnavailable("Feed URL and terms URL are required for custody")
        path = Path(config["feed_path"])
        record["feed_sha256"] = sha256(path)
        if record["feed_sha256"] != config["feed_sha256"]:
            raise TransitUnavailable("GTFS hash differs from configured custody")
        policy = config.get("fare_policy", {})
        if policy.get("kind") == "route_period_single_boarding":
            if policy["service_date"] != config["service_date"]:
                raise TransitUnavailable("Fare schedule service date differs")
            if not policy["effective_from"] <= config["service_date"] <= policy["verified_through"]:
                raise TransitUnavailable("Service date outside verified fare policy dates")
            if sha256(policy["source_path"]) != policy["source_sha256"]:
                raise TransitUnavailable("Fare source hash differs from configured custody")
        stops, services, transfers, custody, fares, rules = load_feed(path, config["service_date"], config.get("route_families", {}))
        record.update(custody)
        served = {r[1] for service in services for r in service[4]}
        walk, drive_in, drive_out, points = connectors(zones, stops, served, config)
        exclusions = config.get("coverage_exclusions", {})
        if exclusions:
            if not exclusions.get("source"):
                raise TransitUnavailable("Coverage exclusions need a source")
            excluded = set(exclusions["zone_ids"])
            if not excluded <= set(record["zone_ids"]):
                raise TransitUnavailable("Excluded zone outside supplied zone system")
            for i, zone_id in enumerate(record["zone_ids"]):
                if zone_id in excluded:
                    walk[i], drive_in[i], drive_out[i] = {}, {}, {}
            record["coverage_exclusions"] = exclusions
        record["walk_access_zone_ids"] = [record["zone_ids"][i] for i,a in enumerate(walk) if a]
        record["zones_without_walk_access"] = [record["zone_ids"][i] for i,a in enumerate(walk) if not a]
        if not any(walk):
            raise TransitUnavailable("No zones have walk access to served stops")
        max_seconds = number(config["max_journey_minutes"], "max_journey_minutes", positive=True)*60
        if set(config["departures"]) != set(PERIODS):
            raise TransitUnavailable("Exactly EA, AM, MD, PM, EV departures are required")
        families = sorted({s[2] for s in services} | {"TRN"})
        record["periods"] = {}
        for period, time in config["departures"].items():
            start = seconds(time)
            lo, hi = PERIODS[period]
            if not lo*3600 <= start < hi*3600:
                raise TransitUnavailable(f"Departure outside {period}")
            stats = {}
            for family in families:
                graph = TimetableGraph(services, transfers, points, family, start, start+max_seconds, config)
                for access_mode, egress_mode, access, egress in [("WLK","WLK",walk,walk), ("DRV","WLK",drive_in,walk), ("WLK","DRV",walk,drive_out)]:
                    if family == "TRN" and (access_mode,egress_mode) != ("WLK","WLK"):
                        continue
                    prefix = f"{access_mode}_{family}_{egress_mode}"
                    matrices = {c: np.full((len(zones),len(zones)),np.nan) for c in COMPONENTS}
                    if any(access) and any(egress):
                        for i, a in enumerate(access):
                            if not a:
                                continue
                            values = graph.skim_origin(a, egress, start, max_seconds, access_mode=="DRV",egress_mode=="DRV",fares,rules,config.get("fare_policy"))
                            for j,v in enumerate(values):
                                if i == j or v is None:
                                    continue
                                for c,value in v.items():
                                    if value is not None:
                                        matrices[c][i,j] = value
                    available = np.isfinite(matrices["TOTIVT"]) & (matrices["TOTIVT"] > 0)
                    usable = available & np.isfinite(matrices["FAR"])
                    matrices["AVAILABLE"] = available
                    matrices["USABLE"] = usable
                    for c,m in matrices.items():
                        output[f"{prefix}_{c}__{period}"] = m
                    vals = matrices["TOTAL"][available]
                    stats[prefix] = {"reachable_pairs": int(available.sum()), "fare_known_pairs": int(usable.sum()),
                        "total_minutes_p50_p90_p95": np.percentile(vals,[50,90,95]).tolist() if len(vals) else None,
                        "unavailable_reason": "no supplied drive connectors" if "DRV" in prefix and not config.get("drive_connectors") else "no scheduled path within access and journey limits",
                        "fare_unknown_pairs": int((available & ~usable).sum())}
            record["periods"][period] = stats
        has_paths = any(m.any() for k,m in output.items() if "_AVAILABLE__" in k)
        record["status"] = "available" if any(m.any() for k,m in output.items() if "_USABLE__" in k) else "los_only_fare_unavailable" if has_paths else "unavailable"
        if not has_paths:
            record["reason"] = "No scheduled paths at the configured departures within access and journey limits"
        record["drive_transit"] = "supplied directional connectors" if config.get("drive_connectors") else "unavailable: no supplied drive connectors"
        record["limitations"] = ["One configured departure per period, not a period average", "Euclidean centroid walk access; no street barriers or pedestrian network", "Transfers use same-stop and explicit transfers.txt only", "No adjacent service-day merge, frequencies, timed/in-seat or route-specific transfers", "Earliest arrival, not a fare/generalized-cost optimal path", "Unknown fares disable mode-choice alternatives; generic accessibility retains measured LOS", "Intrazonal transit unavailable; zone centroids do not represent all residents"]
    except (TransitUnavailable, OSError, zipfile.BadZipFile, KeyError, ValueError) as exc:
        output = {}
        record.update(status="unavailable", reason=str(exc))
    return output, record


def mtc_matrix(name, raw, shape):
    """MTC times/distances scale by 100, fare cents and boards do not."""
    import numpy as np
    base, sep, period = name.partition("__")
    parts = base.split("_")
    if len(parts) != 4 or parts[0] not in {"WLK","DRV"} or parts[1] not in FAMILIES or parts[2] not in {"WLK","DRV"} or not sep:
        raise TransitUnavailable(f"Unknown transit skim name {name}")
    prefix = "_".join(parts[:3])
    component = parts[3]
    source_component = "TOTIVT" if component == "IVT" else component
    if source_component not in COMPONENTS or period not in PERIODS:
        raise TransitUnavailable(f"Unknown transit component/period {name}")
    mask_name = "AVAILABLE" if parts[1] == "TRN" else "USABLE"
    mask = raw.get(f"{prefix}_{mask_name}__{period}", np.zeros(shape,dtype=bool))
    values = raw.get(f"{prefix}_{source_component}__{period}", np.full(shape,np.nan)).copy()
    if component == "WAUX" and parts[1] != "TRN":
        values += raw.get(f"{prefix}_WACC__{period}",0) + raw.get(f"{prefix}_WEGR__{period}",0)
    scale = 1 if component == "BOARDS" else 100
    return np.where(mask,values*scale,0.0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config",required=True)
    parser.add_argument("--zones",required=True)
    parser.add_argument("--output",required=True)
    args = parser.parse_args()
    require_runtime()
    import numpy as np
    config = json.loads(Path(args.config).read_text())
    with Path(args.zones).open() as f:
        zones = list(csv.DictReader(f))
    raw, record = build_transit_skims(zones,config)
    out = Path(args.output)
    out.mkdir(parents=True,exist_ok=False)
    if raw:
        np.savez_compressed(out/"transit_skims.npz",**raw)
        record["artifact_sha256"] = sha256(out/"transit_skims.npz")
    (out/"transit.json").write_text(json.dumps(record,indent=2)+"\n")
    print(json.dumps({k:v for k,v in record.items() if k in {"status","reason","active_trips","drive_transit"}},indent=2))
    return 0 if raw else 2


if __name__ == "__main__":
    raise SystemExit(main())
