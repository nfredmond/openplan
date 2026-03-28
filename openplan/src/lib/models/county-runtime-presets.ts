import type { CountyRuntimeOptions } from "@/lib/api/county-onramp";

export const COUNTY_RUNTIME_PRESET_KEYS = ["standard", "activitysim_behavioral_smoke"] as const;

export type CountyRuntimePresetKey = (typeof COUNTY_RUNTIME_PRESET_KEYS)[number];

export const ACTIVITYSIM_BEHAVIORAL_SMOKE_CLI_TEMPLATE =
  "bash -lc 'python -m pip install --no-cache-dir activitysim==1.5.1 && python -m activitysim.cli.run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}'";

export const COUNTY_RUNTIME_PRESET_DEFINITIONS: ReadonlyArray<{
  key: CountyRuntimePresetKey;
  label: string;
  summary: string;
  caveat: string;
}> = [
  {
    key: "standard",
    label: "Standard county onboarding runtime",
    summary: "Default county bootstrap path with the existing runtime configuration.",
    caveat: "Uses the shipped county onboarding flow only. No containerized ActivitySim behavioral runtime is requested.",
  },
  {
    key: "activitysim_behavioral_smoke",
    label: "Containerized behavioral smoke runtime (prototype)",
    summary: "Requests the proven Python 3.11 containerized ActivitySim smoke path during county bootstrap.",
    caveat:
      "Prototype only. This surfaces a containerized behavioral smoke path for internal inspection and should not be read as calibrated production modeling or client-ready forecasting.",
  },
] as const;

export function buildCountyRuntimeOptions(preset: CountyRuntimePresetKey): CountyRuntimeOptions {
  if (preset === "activitysim_behavioral_smoke") {
    return {
      keepProject: true,
      activitysimContainerImage: "python:3.11-slim",
      containerEngineCli: "docker",
      activitysimContainerCliTemplate: ACTIVITYSIM_BEHAVIORAL_SMOKE_CLI_TEMPLATE,
      containerNetworkMode: "bridge",
    };
  }

  return { keepProject: true };
}

export function inferCountyRuntimePresetKey(runtimeOptions: CountyRuntimeOptions | null | undefined): CountyRuntimePresetKey {
  if (
    runtimeOptions?.activitysimContainerImage?.trim() === "python:3.11-slim" &&
    runtimeOptions?.containerEngineCli?.trim() === "docker" &&
    runtimeOptions?.activitysimContainerCliTemplate?.trim() === ACTIVITYSIM_BEHAVIORAL_SMOKE_CLI_TEMPLATE &&
    runtimeOptions?.containerNetworkMode?.trim() === "bridge"
  ) {
    return "activitysim_behavioral_smoke";
  }

  return "standard";
}

export function getCountyRuntimePresetLabel(runtimeOptions: CountyRuntimeOptions | null | undefined): string {
  const presetKey = inferCountyRuntimePresetKey(runtimeOptions);
  return COUNTY_RUNTIME_PRESET_DEFINITIONS.find((preset) => preset.key === presetKey)?.label ?? "Standard county onboarding runtime";
}
