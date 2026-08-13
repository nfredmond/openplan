import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { useConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { stripSourceComments } from "./helpers/source-text";

/**
 * ONE way to ask a planner to confirm something irreversible.
 *
 * Fifteen surfaces called `window.confirm()`. A native dialog cannot be themed,
 * cannot name the records that refer to the one being deleted, cannot offer a
 * non-destructive way out, and is silently suppressed by Chrome after a user
 * ticks "prevent this page from creating more dialogs" — at which point every
 * delete button in the product stops working with no message at all.
 *
 * These tests exercise the rendered dialog rather than a stub. A test that stubs
 * the thing it is named for cannot prove that thing, and `window.confirm` tests
 * proved only that a string had been passed to a function jsdom had replaced.
 */

function Harness({
  request,
  onAnswer,
}: {
  request: ConfirmRequest;
  onAnswer?: (answer: boolean) => void;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [answer, setAnswer] = useState<string>("unanswered");

  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const result = await confirm(request);
          setAnswer(result ? "yes" : "no");
          onAnswer?.(result);
        }}
      >
        Open the question
      </button>
      <button type="button">Something else on the page</button>
      <p data-testid="answer">{answer}</p>
      {confirmDialog}
    </div>
  );
}

const BASE: ConfirmRequest = {
  headline: "Remove “STBG apportionment” ($4,200,000) from this plan's financial element?",
  consequence: "This cannot be undone, and the fiscal-constraint check will be recomputed without it.",
  confirmLabel: "Remove this line",
};

async function open(request: ConfirmRequest = BASE, onAnswer?: (answer: boolean) => void) {
  const { unmount } = render(<Harness request={request} onAnswer={onAnswer} />);
  const trigger = screen.getByRole("button", { name: "Open the question" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("alertdialog");
  return { trigger, dialog, unmount };
}

describe("the shared confirmation dialog", () => {
  it("asks the question and states what is lost, in the page's own theme", async () => {
    const { dialog } = await open();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The headline names the record and the consequence names the loss; a
    // planner should be able to answer without reading anything else.
    expect(dialog.textContent).toContain("STBG apportionment");
    expect(dialog.textContent).toContain("the fiscal-constraint check will be recomputed without it");
    // Labelled BY the headline and described BY the consequence, so a screen
    // reader announces both on open rather than reading "dialog".
    const labelledBy = dialog.getAttribute("aria-labelledby");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(document.getElementById(labelledBy!)?.textContent).toContain("STBG apportionment");
    expect(document.getElementById(describedBy!)?.textContent).toContain("cannot be undone");
  });

  it("puts the keyboard on the safe button, never the destructive one", async () => {
    const { dialog } = await open();

    // A planner who opens this and presses Enter out of habit must not delete
    // anything. This is the assertion the native dialog could never make.
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Keep it"));
    expect(document.activeElement).not.toBe(
      within(dialog).getByRole("button", { name: "Remove this line" })
    );
  });

  it("resolves true only when the destructive button is pressed", async () => {
    const answers: boolean[] = [];
    const { dialog } = await open(BASE, (answer) => answers.push(answer));

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove this line" }));

    await waitFor(() => expect(screen.getByTestId("answer")).toHaveTextContent("yes"));
    expect(answers).toEqual([true]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("treats every ambiguous exit as no — cancel, Escape, and the backdrop", async () => {
    for (const exit of ["cancel", "escape", "backdrop"] as const) {
      const answers: boolean[] = [];
      const { dialog } = await open(BASE, (answer) => answers.push(answer));

      if (exit === "cancel") {
        fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
      } else if (exit === "escape") {
        fireEvent.keyDown(dialog, { key: "Escape" });
      } else {
        fireEvent.mouseDown(screen.getByTestId("confirm-dialog-backdrop"));
      }

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      await waitFor(() => expect(screen.getByTestId("answer")).toHaveTextContent("no"));
      expect(answers, `exit: ${exit}`).toEqual([false]);
      cleanup();
    }
  });

  it("gives the keyboard back to whatever opened it", async () => {
    const { trigger, dialog } = await open();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Keep it"));

    fireEvent.keyDown(dialog, { key: "Escape" });

    // Otherwise a keyboard user lands back at the top of the document and has
    // to tab through the whole page to get to the row they were working on.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("wraps the keyboard inside the dialog in both directions", async () => {
    const { dialog } = await open();
    const buttons = within(dialog).getAllByRole("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("names what refers to the record, and links it, when the caller can supply it", async () => {
    const { dialog } = await open({
      ...BASE,
      headline: "Delete “Countywide parcels”?",
      references: [
        { id: "c1", label: "Downtown listening", href: "/engagement/c1", detail: "drawn on the campaign map" },
        { id: "r1", label: "2050 RTP draft", href: "/reports/r1" },
      ],
    });

    // "This layer is in use" tells a planner nothing they can act on. The list
    // of what uses it tells them exactly where to go.
    const campaign = within(dialog).getByRole("link", { name: "Downtown listening" });
    expect(campaign).toHaveAttribute("href", "/engagement/c1");
    expect(within(dialog).getByRole("link", { name: "2050 RTP draft" })).toHaveAttribute(
      "href",
      "/reports/r1"
    );
    expect(dialog.textContent).toContain("drawn on the campaign map");
  });

  it("offers the non-destructive way out, and taking it is not a yes", async () => {
    const retire = vi.fn();
    const answers: boolean[] = [];
    const { dialog } = await open(
      {
        ...BASE,
        alternative: {
          label: "Mark it complete instead",
          description: "Retiring a project keeps its record and can be undone.",
          onSelect: retire,
        },
      },
      (answer) => answers.push(answer)
    );

    expect(dialog.textContent).toContain("Retiring a project keeps its record");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark it complete instead" }));

    await waitFor(() => expect(retire).toHaveBeenCalledTimes(1));
    expect(answers).toEqual([false]);
  });

  it("does not dress a non-destructive step in the destructive button", async () => {
    const { dialog: caution } = await open({
      headline: "Show “Proposed alignment” to participants?",
      consequence: "Anyone with this campaign's public link can see the geometry and download it.",
      confirmLabel: "Show it to participants",
      tone: "caution",
    });
    expect(
      within(caution).getByRole("button", { name: "Show it to participants" })
    ).toHaveAttribute("data-variant", "default");
    cleanup();

    // If every irreversible step were red, red would stop meaning anything —
    // and the steps that really do destroy a record are the ones that lose by it.
    const { dialog: destructive } = await open();
    expect(
      within(destructive).getByRole("button", { name: "Remove this line" })
    ).toHaveAttribute("data-variant", "destructive");
  });

  it("answers no when the surface unmounts with the question still open", async () => {
    const answers: boolean[] = [];
    const { unmount } = await open(BASE, (answer) => answers.push(answer));

    // Every caller awaits this promise before doing the irreversible thing. An
    // unsettled promise would hang that await forever; settling it TRUE would
    // delete something nobody agreed to.
    unmount();

    await waitFor(() => expect(answers).toEqual([false]));
  });
});

describe("no surface asks the browser instead", () => {
  function sourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry);
      if (statSync(absolute).isDirectory()) {
        found.push(...sourceFiles(absolute));
      } else if (/\.(?:tsx?|jsx?)$/.test(entry)) {
        found.push(absolute);
      }
    }
    return found;
  }

  it("renders the dialog everywhere it asks for one", () => {
    // THE SHIPPED-INVISIBLE SHAPE. `useConfirmDialog` returns both the asking
    // function and the node. A surface that calls `confirm(...)` and never
    // renders `confirmDialog` compiles, type-checks, and leaves a delete button
    // that does nothing at all forever — the promise never settles, because
    // nothing is ever on screen to settle it. Four of the converted surfaces
    // have no test that presses their delete button, so this is what stands
    // between them and that defect.
    const root = join(process.cwd(), "src");
    const missing: string[] = [];

    for (const file of [...sourceFiles(join(root, "components")), ...sourceFiles(join(root, "app"))]) {
      const code = stripSourceComments(readFileSync(file, "utf8"));
      if (!code.includes("useConfirmDialog(")) continue;
      if (file.endsWith(join("ui", "confirm-dialog.tsx"))) continue;
      if (!/\{\s*confirmDialog\s*\}/.test(code)) missing.push(file.slice(root.length + 1));
    }

    expect(
      missing,
      "These surfaces ask a question they never render. Put {confirmDialog} in the returned markup."
    ).toEqual([]);
  });

  it("has no window.confirm left in any component or route", () => {
    const root = join(process.cwd(), "src");
    const offenders: string[] = [];

    for (const file of [...sourceFiles(join(root, "components")), ...sourceFiles(join(root, "app"))]) {
      // Comments are stripped first, with the shared stripper: `confirm-dialog.tsx`
      // explains at length why `window.confirm` is wrong, and a guard defeated by
      // its own explanation is this repo's oldest recurring failure.
      const code = stripSourceComments(readFileSync(file, "utf8"));
      if (/\b(?:window|globalThis)\.confirm\s*\(/.test(code)) {
        offenders.push(file.slice(root.length + 1));
      }
    }

    expect(
      offenders,
      "Use `useConfirmDialog` from @/components/ui/confirm-dialog. A native confirm ignores the " +
        "theme, cannot name what refers to the record, and is suppressed by Chrome on repeat."
    ).toEqual([]);
  });
});
