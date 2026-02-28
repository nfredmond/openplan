# GIS Pilot Data Hardening Checklist — OpenPlan v1

## 1) Canonical Layer Registry
- [ ] Corridor centerlines
- [ ] Intersections/crossings
- [ ] Sidewalk/ADA frontage network
- [ ] Curb use/loading zones
- [ ] Transit stops and access buffers
- [ ] Collision/safety events
- [ ] Speed/volume observation points
- [ ] Parcel/frontage references

For each layer capture:
- owner
- source system
- refresh frequency
- schema version
- CRS
- quality risks

## 2) Schema + Geometry QA
- [ ] Required fields present
- [ ] Data types/constraints valid
- [ ] Null/blank critical fields within tolerance
- [ ] Geometry validity checks pass
- [ ] Topology checks pass (gaps/overlaps/duplicates as relevant)
- [ ] CRS harmonized

## 3) Integrity + Traceability
- [ ] Source-to-derived lineage documented
- [ ] Last refresh timestamp recorded
- [ ] Known limitations logged
- [ ] “Safe for decision-support” status assigned

## 4) Output
- [ ] QA log created
- [ ] Remediation list created
- [ ] Go/hold recommendation issued for pilot analytics usage
