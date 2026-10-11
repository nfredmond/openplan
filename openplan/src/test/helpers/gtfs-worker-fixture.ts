import JSZip from "jszip";
import { parseGtfsFeed } from "@/lib/gtfs/parse";

/** Synthetic global-coordinate feed with two directions and mixed derivation. */
export async function gtfsWorkerFixture() {
  const zip = new JSZip();
  zip.file("agency.txt", "agency_id,agency_name,agency_url,agency_timezone\nA,Test Transit,https://example.invalid,Pacific/Guam\n");
  zip.file("stops.txt", "stop_id,stop_name,stop_lat,stop_lon\nS,Test stop,13.4443,144.7937\n");
  zip.file("routes.txt", "route_id,route_short_name,route_type\nR,1,3\n");
  zip.file("trips.txt", "trip_id,route_id,service_id,direction_id\nT1,R,W,0\nT2,R,W,1\n");
  zip.file("calendar.txt", "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nW,1,1,1,1,1,1,1,20260101,20261231\n");
  zip.file("stop_times.txt", "trip_id,stop_id,arrival_time,departure_time,stop_sequence\nT1,S,08:00:00,08:00:00,1\nT2,S,08:00:00,08:00:00,1\n");
  zip.file("frequencies.txt", "trip_id,start_time,end_time,headway_secs,exact_times\nT2,08:00:00,09:00:00,1800,0\n");
  zip.file("feed_info.txt", "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\nTest publisher,https://example.invalid,en,20260101,20261231,1\n");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const parsed = await parseGtfsFeed(bytes);
  if (!parsed.ok) throw new Error(`Synthetic fixture parse failed: ${parsed.code}`);
  return { bytes, parsed };
}
