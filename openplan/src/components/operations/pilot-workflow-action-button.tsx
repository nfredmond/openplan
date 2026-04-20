"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";
import { executeAction } from "@/lib/runtime/action-registry";

type PilotWorkflowPacketAction = Extract<
  AssistantQuickLinkExecuteAction,
  { kind: "generate_report_artifact" }
>;

type PilotWorkflowActionButtonProps = {
  action: PilotWorkflowPacketAction;
  label: string;
  pendingLabel: string;
  successLabel: string;
};

export function PilotWorkflowActionButton({
  action,
  label,
  pendingLabel,
  successLabel,
}: PilotWorkflowActionButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleAction() {
    setStatus("running");
    setMessage(null);

    try {
      await executeAction(action, {
        onCompleted: () => {
          router.refresh();
        },
      });
      setStatus("done");
      setMessage(successLabel);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Packet generation failed.");
    }
  }

  return (
    <div className="grid justify-items-start gap-1 sm:justify-items-end">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={handleAction}
        disabled={status === "running"}
      >
        {status === "running" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {pendingLabel}
          </>
        ) : status === "done" ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            {successLabel}
          </>
        ) : (
          <>
            <WandSparkles className="h-3.5 w-3.5" />
            {label}
          </>
        )}
      </Button>
      {message ? (
        <p
          role={status === "error" ? "alert" : "status"}
          className={[
            "max-w-[16rem] text-xs leading-relaxed",
            status === "error" ? "text-red-700 dark:text-red-300" : "text-muted-foreground",
          ].join(" ")}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
