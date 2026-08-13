/**
 * The four ways a guided flow makes the product WORSE than the inline form it
 * replaced, each asserted against the real primitive.
 *
 * WHAT JSDOM CANNOT SEE, AND WHAT NOTHING HERE MAY CLAIM. jsdom applies no
 * stylesheet and has no box model. It cannot prove the sheet is full-height on
 * a phone, that the footer is pinned, that the body scrolls while the page
 * behind it does not, that focus is contained, that the background is inert, or
 * that a nested confirm is DRAWN above the flow. `<dialog>` itself is a shim
 * here (see `guided-flow-jsdom-dialog-shim.ts`). All of that is measured in
 * real Chrome; the numbers are in the lane's report, and at 390x844 they are:
 * dialog 0,0,390x844, body scrollHeight 749 vs client 640, footer bottom 844
 * unmoved after scrolling the body, window.scrollY 0 throughout.
 *
 * What IS provable here is the logic: which step owns a problem, what the
 * submit checks, whether typed work survives a dismissal, and whether a second
 * press can start a second write.
 */

import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";
import { Input } from "@/components/ui/input";

type Values = { comment: string; nickname: string };

/**
 * Deliberately shaped like the defect that shipped on the public portal: the
 * REQUIRED answer lives on a step the submit button is not on. In `sections`
 * mode every step is reachable, so a planner really can be standing on the
 * "send" step with the required control unmounted — which is the exact
 * situation where a browser `required` attribute silently does nothing.
 */
function harness({
  onSubmit = vi.fn(async () => {}),
  mode = "sections" as "sections" | "sequence",
  breakTheContract = false,
}) {
  function Harness() {
    const steps = React.useMemo<GuidedFlowStep<Values>[]>(
      () => [
        {
          id: "what",
          title: "What do you want to say?",
          fields: [
            {
              name: "comment",
              label: "a comment",
              required: true,
              requiredMessage: "Write your comment before you send it.",
            },
          ],
          render: (flow) =>
            breakTheContract ? (
              // A step that declares a field and renders no control for it.
              <p>nothing to type into</p>
            ) : (
              <GuidedFlowRow flow={flow} name="comment" label="Your comment">
                <Input {...flow.text("comment")} />
              </GuidedFlowRow>
            ),
        },
        {
          id: "send",
          title: "Who is sending it?",
          fields: [{ name: "nickname", label: "a name" }],
          render: (flow) => (
            <GuidedFlowRow flow={flow} name="nickname" label="Your name">
              <Input {...flow.text("nickname")} />
            </GuidedFlowRow>
          ),
        },
      ],
      []
    );

    const flow = useGuidedFlow<Values>({
      id: "test-flow",
      title: "Leave a comment",
      mode,
      submitLabel: "Send it",
      initialValues: { comment: "", nickname: "" },
      steps,
      onSubmit,
    });

    return (
      <div>
        <button type="button" data-testid="trigger" onClick={flow.open}>
          Leave a comment
        </button>
        <GuidedFlow flow={flow} />
      </div>
    );
  }

  return render(<Harness />);
}

function openFlow() {
  fireEvent.click(screen.getByTestId("trigger"));
}

describe("guided flow — a required answer is reachable from the step carrying the submit", () => {
  it("refuses a submit pressed on a step where the required control is not even mounted, and moves the planner to the step that owns it", async () => {
    const onSubmit = vi.fn(async () => {});
    harness({ onSubmit });
    openFlow();

    // Stand on the step with the send button. The required comment control is
    // NOT in the document — this is the shape of the defect.
    fireEvent.click(screen.getByRole("button", { name: "Who is sending it?" }));
    await waitFor(() => expect(screen.getByLabelText("Your name")).toBeInTheDocument());
    expect(screen.queryByLabelText("Your comment")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send it" }));

    await waitFor(() => {
      expect(screen.getByTestId("guided-flow-test-flow-problems")).toHaveTextContent(
        "Write your comment before you send it."
      );
    });
    // Nothing was written…
    expect(onSubmit).not.toHaveBeenCalled();
    // …and the planner is now looking at the control that has to change.
    const comment = screen.getByLabelText("Your comment");
    expect(comment).toBeInTheDocument();
    expect(comment).toHaveAttribute("aria-invalid", "true");
  });

  it("submits once the required answer exists", async () => {
    const onSubmit = vi.fn(async () => {});
    harness({ onSubmit });
    openFlow();

    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "Fix the crossing" } });
    fireEvent.click(screen.getByRole("button", { name: "Send it" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ comment: "Fix the crossing", nickname: "" });
  });

  it("refuses to render a step that declares a field it does not give the planner a control for", () => {
    // The flow would otherwise validate an answer with nowhere to type it: the
    // planner could not submit and could not see why.
    expect(() => {
      harness({ breakTheContract: true });
      openFlow();
    }).toThrow(/declares "comment" but renders no control/);
  });
});

describe("guided flow — typed work is never discarded silently", () => {
  it("asks before throwing away a dismissal with typed input, and keeps every answer when the planner says no", async () => {
    harness({});
    openFlow();
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "Half a thought" } });

    fireEvent.click(screen.getByRole("button", { name: /Close without saving/i }));

    const question = await screen.findByRole("alertdialog");
    expect(question).toHaveTextContent(/Close without saving\?/);
    expect(question).toHaveTextContent(/not saved anywhere yet/);

    fireEvent.click(screen.getByRole("button", { name: /Keep filling it in/i }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByLabelText("Your comment")).toHaveValue("Half a thought");
  });

  it("closes without a question when nothing has been typed", async () => {
    harness({});
    openFlow();
    expect(screen.getByTestId("guided-flow-test-flow")).toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: /Close without saving/i }));

    await waitFor(() =>
      expect(screen.getByTestId("guided-flow-test-flow")).not.toHaveAttribute("open")
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("routes Escape through the same question rather than eating the answer", async () => {
    harness({});
    openFlow();
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "Typed" } });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/Close without saving\?/);
    expect(screen.getByTestId("guided-flow-test-flow")).toHaveAttribute("open");
  });
});

describe("guided flow — one write per press", () => {
  it("does not start a second write while the first is still going", async () => {
    let release: () => void = () => {};
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    harness({ onSubmit });
    openFlow();
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "Once" } });

    const send = () => screen.getByRole("button", { name: "Send it" });
    fireEvent.click(send());
    fireEvent.click(send());
    fireEvent.click(send());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() =>
      expect(screen.getByTestId("guided-flow-test-flow")).not.toHaveAttribute("open")
    );
  });

  it("keeps the flow open and says what went wrong when the write fails", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("That project no longer exists.");
    });
    harness({ onSubmit });
    openFlow();
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "Once" } });
    fireEvent.click(screen.getByRole("button", { name: "Send it" }));

    await waitFor(() =>
      expect(screen.getByTestId("guided-flow-test-flow-error")).toHaveTextContent(
        "That project no longer exists."
      )
    );
    expect(screen.getByTestId("guided-flow-test-flow")).toHaveAttribute("open");
    // The answers are still there to correct.
    expect(screen.getByLabelText("Your comment")).toHaveValue("Once");
  });
});

describe("guided flow — a sequence does not let a step be skipped past", () => {
  it("blocks Next on the step that owns the missing answer and focuses the control", async () => {
    harness({ mode: "sequence" });
    openFlow();

    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));

    await waitFor(() =>
      expect(screen.getByTestId("guided-flow-test-flow-problems")).toHaveTextContent(
        "Write your comment before you send it."
      )
    );
    // Still on step one — a planner cannot walk past the question.
    expect(screen.getByLabelText("Your comment")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });
});
