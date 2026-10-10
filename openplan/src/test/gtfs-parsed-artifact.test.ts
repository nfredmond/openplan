// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { decodeGtfsParsedArtifact } from "@/lib/gtfs/parsed-artifact";
import { gtfsWorkerFixture } from "./helpers/gtfs-worker-fixture";
let fixture: Awaited<ReturnType<typeof gtfsWorkerFixture>>;
beforeAll(async()=>{fixture=await gtfsWorkerFixture();});
const expected=()=>({parsed:true,archiveBytes:fixture.bytes.length});
const copy=()=>structuredClone(fixture.parsed);
function change(raw:unknown,path:string,value:unknown,remove=false){
 const keys=path.split('.');let parent=raw as Record<string,unknown>;
 for(const key of keys.slice(0,-1))parent=parent[key] as Record<string,unknown>;
 if(remove)delete parent[keys.at(-1)!];else parent[keys.at(-1)!]=value;
}
const fields=["ok","feed.filesPresent","feed.agencies.0.name","feed.agencies.0.agencyId","feed.agencies.0.url","feed.agencies.0.timezone","feed.agencies.0.lang","feed.agencies.0.phone",
 "feed.feedInfo.publisherName","feed.feedInfo.publisherUrl","feed.feedInfo.lang","feed.feedInfo.startDate","feed.feedInfo.endDate","feed.feedInfo.version",
 "feed.routes.0.routeId","feed.routes.0.agencyId","feed.routes.0.shortName","feed.routes.0.longName","feed.routes.0.routeType","feed.routes.0.color","feed.routes.0.textColor",
 "feed.stops.0.stopId","feed.stops.0.name","feed.stops.0.lat","feed.stops.0.lon","feed.stops.0.locationType","feed.stops.0.parentStation","feed.stops.0.wheelchairBoarding",
 "feed.serviceWindow.startDate","feed.serviceWindow.endDate","feed.serviceWindow.source","feed.serviceDayBases.0.serviceDay","feed.serviceDayBases.0.representativeDate",
 "feed.serviceDayBases.0.serviceIds","feed.serviceDayBases.0.tripCount","feed.serviceDayBases.0.candidateDateCount",
 "feed.routeServiceLevels.0.routeId","feed.routeServiceLevels.0.directionId","feed.routeServiceLevels.0.stopsServed",
 "feed.stopServiceLevels.0.stopId","feed.stopServiceLevels.0.routeIds","feed.stopServiceLevels.0.routesServing","feed.derivationMethod","feed.warnings",
 ...["archiveBytes","bytesDecompressed","elapsedMs","stopTimesRows","stopTimesWithoutTime","tripRows","stopServicePairs","routeServicePairs","scheduledTrips","frequencyTrips","exactTimesFrequencyTrips"].map(f=>`feed.stats.${f}`),
 ...["serviceDay","representativeDate","tripsPerDay","firstDepartureSeconds","lastDepartureSeconds","spanSeconds","peakHour","peakHourDepartures","peakHeadwayMinutes","peakHeadwayIsLowerBound","medianHeadwayMinutes","medianHeadwayBasis","servedHours","spanHours","frequentServiceTierMinutes","derivationMethod","scheduledTripCount","frequencyTripCount","departuresBeyondBinRange"].map(f=>`feed.stopServiceLevels.0.${f}`)];
describe("complete retained GTFS parser protocol",()=>{
 it("preserves the actual parser's full result and independent route/stop counts",()=>{
  expect(decodeGtfsParsedArtifact(fixture.parsed,expected())).toEqual(fixture.parsed);
  expect(fixture.parsed.feed.routeServiceLevels).toHaveLength(14);expect(fixture.parsed.feed.stopServiceLevels).toHaveLength(7);
  expect(fixture.parsed.feed.routes).toHaveLength(1);expect(fixture.parsed.feed.stops).toHaveLength(1);
  expect(fixture.parsed.feed.derivationMethod).toBe("mixed");
 });
 it("preserves worldwide coordinates and optional unknown agency facts",()=>{
  const raw=copy();raw.feed.agencies[0].timezone=null;raw.feed.routes[0].routeType=null;
  raw.feed.stops[0].lat=-33.9;raw.feed.stops[0].lon=18.4;
  expect(decodeGtfsParsedArtifact(raw,expected())).toEqual(raw);
 });
 it("retains parser failure with its original code and explanation",()=>{
  const raw={ok:false,code:"missing_required_file",detail:"stops.txt is missing"};
  expect(decodeGtfsParsedArtifact(raw,{...expected(),parsed:false})).toEqual(raw);
 });
 it.each(fields)("requires parser field %s",path=>{const raw=copy();change(raw,path,undefined,true);expect(()=>decodeGtfsParsedArtifact(raw,expected())).toThrow();});
 it.each(["", "feed", "feed.agencies.0", "feed.feedInfo", "feed.routes.0", "feed.stops.0", "feed.serviceWindow", "feed.serviceDayBases.0", "feed.stopServiceLevels.0", "feed.routeServiceLevels.0", "feed.stats"])("refuses unknown fields in %s",path=>{
  const raw=copy();change(raw,path?`${path}.extra`:"extra",true);expect(()=>decodeGtfsParsedArtifact(raw,expected())).toThrow();
 });
 it("refuses unsupported warning fields",()=>{
  const raw=copy();raw.feed.warnings=[{code:"bad_csv_row",count:1,examples:[]}];change(raw,"feed.warnings.0.extra",true);
  expect(()=>decodeGtfsParsedArtifact(raw,expected())).toThrow();
 });
 it("refuses unsupported failure fields",()=>{expect(()=>decodeGtfsParsedArtifact({ok:false,code:"not_a_zip",detail:"invalid",extra:true},{...expected(),parsed:false})).toThrow();});
 it.each([
  ["receipt", "parsed outcome differs from receipt"], ["archive", "parsed archive size differs"],
  ["entities", "entity identities repeat"], ["basis", "basis repeats or is incomplete"],
  ["service", "service identities repeat"], ["reference", "references a missing entity"],
  ["routes", "stop route count differs"], ["date", "service date differs"],
  ["count", "departure counts differ"], ["span", "service span differs"],
 ])("refuses inconsistent %s evidence",(kind,message)=>{
  const raw=copy();const e=expected();
  if(kind==="receipt")e.parsed=false;if(kind==="archive")e.archiveBytes++;
  if(kind==="entities")raw.feed.routes.push({...raw.feed.routes[0]});
  if(kind==="basis")raw.feed.serviceDayBases.pop();if(kind==="service")raw.feed.stopServiceLevels.push({...raw.feed.stopServiceLevels[0]});
  if(kind==="reference")raw.feed.routeServiceLevels[0].routeId="missing";
  if(kind==="routes")raw.feed.stopServiceLevels[0].routesServing++;
  if(kind==="date")raw.feed.stopServiceLevels[0].representativeDate="2027-01-01";
  if(kind==="count")raw.feed.stopServiceLevels[0].scheduledTripCount++;
  if(kind==="span")raw.feed.stopServiceLevels[0].spanSeconds=999;
  expect(()=>decodeGtfsParsedArtifact(raw,e)).toThrow(message);
 });
 it.each([["feed.stops.0.lat",91],["feed.stops.0.lon",181],["feed.routeServiceLevels.0.serviceDay","weekday"],
  ["feed.routeServiceLevels.0.tripsPerDay",-1],["feed.routeServiceLevels.0.peakHour",30],["feed.stats.tripRows",1.5],
  ["feed.serviceWindow.startDate","2026-02-30"],["feed.stopServiceLevels.0.peakHeadwayMinutes",Infinity],
 ] as const)("refuses invalid domain value %s",(path,value)=>{const raw=copy();change(raw,path,value);expect(()=>decodeGtfsParsedArtifact(raw,expected())).toThrow();});
});
