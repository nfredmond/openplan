"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function ProgramsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ModuleError
      error={error}
      reset={reset}
      moduleName="Programming Cycles"
      backHref="/programs"
      backLabel="Back to Programming Cycles"
      logTag="programs-error"
    />
  );
}
