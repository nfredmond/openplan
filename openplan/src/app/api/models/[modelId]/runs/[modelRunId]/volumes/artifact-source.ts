// Lifted to src/lib/models/artifact-source.ts so non-volumes routes (artifact
// downloads) can share the resolver; re-exported here to keep existing imports
// and tests stable.
export {
  workerLocalRoot,
  parseStorageRef,
  storageRefAllowed,
  resolveContainedLocalPath,
  loadJsonArtifact,
  resolveRunWorkDir,
} from "@/lib/models/artifact-source";
export type { ArtifactReadScope } from "@/lib/models/artifact-source";
