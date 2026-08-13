import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Driving the shared in-app confirmation from a test.
 *
 * These read the SAME dialog every destructive surface now opens, which is the
 * point: before this, each test stubbed `window.confirm` and asserted on a
 * string nobody could see or style. A test that stubs the thing it is named for
 * cannot prove that thing — so these helpers touch the rendered dialog, and a
 * component that forgot to render `confirmDialog` fails here rather than
 * silently never asking.
 */

/** The open dialog, once it exists. Fails the test if the surface never asked. */
export async function openConfirmDialog(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole("alertdialog"));
}

/** The question and the consequence, as one string, for asserting on the wording. */
export async function confirmDialogText(): Promise<string> {
  const dialog = await openConfirmDialog();
  return dialog.textContent ?? "";
}

/** Press the destructive button. Pass its label when a surface has more than one dialog. */
export async function confirmDestructiveAction(label?: string | RegExp): Promise<void> {
  const dialog = await openConfirmDialog();
  const button = label
    ? within(dialog).getByRole("button", { name: label })
    : // The destructive button is the last of the dialog's actions, and the one
      // the component marks. Named explicitly wherever a test can.
      within(dialog).getAllByRole("button").at(-1)!;
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}

/** Decline. Every ambiguous exit resolves the same way, so this is the shape of "no". */
export async function declineConfirmation(): Promise<void> {
  const dialog = await openConfirmDialog();
  fireEvent.click(within(dialog).getAllByRole("button")[0]);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}
