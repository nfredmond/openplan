/**
 * A minimum `<dialog>` for jsdom, so component tests can mount a guided flow.
 *
 * WHY THIS FILE EXISTS. jsdom 28 ships `HTMLDialogElement` with exactly one
 * property — `open`. Probed, not remembered:
 *
 *     protoKeys: constructor,open
 *     showModal type: undefined   threw: d.showModal is not a function
 *
 * So every test that renders a component built on `<dialog>` throws on mount
 * unless something supplies the three methods. That something is this file,
 * imported once from `src/test/setup.ts`.
 *
 * WHAT THIS PROVES: NOTHING about modality. Not that the background is inert,
 * not that focus is trapped, not that the sheet is full-height on a phone, not
 * that it sits in the top layer above every z-index, not that the footer stays
 * on screen. jsdom applies no stylesheet and has no box model, so it cannot
 * measure any of that, and no test using this shim may claim it. Those are
 * browser facts and are measured in a real browser at 1600x900 and 390x844.
 *
 * WHAT IT DOES MODEL, because the component's behaviour depends on it:
 *   - `showModal()` / `show()` open the element (`open` attribute set).
 *   - `close(value)` removes `open`, records `returnValue`, fires `close`.
 *   - Escape fires a cancelable `cancel` at the top-most open dialog, and
 *     closes it only if nothing called `preventDefault()`. That ordering is the
 *     whole mechanism behind "dismissing with unsaved input asks first", so a
 *     shim that just closed on Escape would let the defect through green.
 */

type DialogWithStack = HTMLDialogElement & { __openedModal?: boolean };

const openDialogs: DialogWithStack[] = [];

export function installJsdomDialogShim(): void {
  if (typeof HTMLDialogElement === "undefined") return;
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    __openplanShim?: boolean;
  };
  if (proto.__openplanShim) return;
  proto.__openplanShim = true;

  function open(this: DialogWithStack, modal: boolean) {
    if (this.hasAttribute("open")) return;
    this.setAttribute("open", "");
    this.__openedModal = modal;
    if (modal) openDialogs.push(this);
  }

  proto.show = function show(this: DialogWithStack) {
    open.call(this, false);
  };

  proto.showModal = function showModal(this: DialogWithStack) {
    open.call(this, true);
  };

  proto.close = function close(this: DialogWithStack, returnValue?: string) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    if (typeof returnValue === "string") this.returnValue = returnValue;
    const index = openDialogs.indexOf(this);
    if (index >= 0) openDialogs.splice(index, 1);
    this.dispatchEvent(new Event("close"));
  };

  if (typeof document !== "undefined") {
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") return;
        const top = openDialogs[openDialogs.length - 1];
        if (!top || !top.isConnected) return;
        const cancel = new Event("cancel", { cancelable: true });
        const proceeded = top.dispatchEvent(cancel);
        if (proceeded) top.close();
      },
      true
    );
  }
}
