// Thin compatibility re-export: the grant program catalog now lives in the
// jurisdiction registry at ./programs (types, per-jurisdiction bundle
// modules, and the registered GRANT_PROGRAM_BUNDLES / flattened
// GRANT_PROGRAM_CATALOG). Every existing import from
// "@/lib/grants/program-catalog" keeps working unchanged through this module.

export * from "./programs";
