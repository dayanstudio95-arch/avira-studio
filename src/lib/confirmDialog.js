// The in-app confirmation window (work order 9.10 item 20; Avira `src/components/ui/confirm-dialog.jsx` at f31bcbd):
// every "are you sure?" in the hub is asked inside the app, never with the browser's own confirm box.
//
//   if (!(await confirmDialog({ title: "למחוק את השאלה?", message: "…", confirmText: "מחק", danger: true }))) return;
//   if (!(await confirmDialog("למחוק את השאלה?"))) return;      // a plain string works too (see confirmOptions)
//
// It always answers a Promise<boolean>, so every call must be awaited. One <ConfirmHost/> (components/ConfirmHost.jsx)
// is mounted next to <Toaster/> in App.jsx and draws the question. A second question while one is open answers the
// first with "no". Without a mounted host (a test, another entry point) it falls back to the browser's box, so a call
// never silently does nothing. `npm run lint` (scripts/check-no-window-confirm.mjs) refuses the browser's box anywhere
// else in src.

/** A delete question gets the red "מחק" button. */
const DELETE_WORDS = /למחוק|מחיקה|לצמיתות/;

/**
 * The window's words from what the caller passed: `{ title, message, confirmText, cancelText, danger }`.
 * A plain string (the old window.confirm text): its first line (or first question) is the title, the rest the
 * explanation.
 */
export function confirmOptions(input) {
  if (input && typeof input === "object") {
    const title = String(input.title ?? "").trim();
    const message = String(input.message ?? "").trim();
    // A delete question: red; the button says "מחק" when the title itself asks to delete.
    const danger = typeof input.danger === "boolean" ? input.danger : DELETE_WORDS.test(`${title}\n${message}`);
    return {
      title: title || "לאשר?",
      message,
      danger,
      confirmText: String(input.confirmText || (danger && DELETE_WORDS.test(title) ? "מחק" : "אישור")),
      cancelText: String(input.cancelText || "ביטול"),
    };
  }
  const text = String(input ?? "").trim();
  // The title ends at the first line break; on one line, at the question mark of the first sentence
  // ("למחוק את הסט? התמונות שלו לא נמחקות…" → title "למחוק את הסט?", the rest below it).
  const nl = text.indexOf("\n");
  const q = nl < 0 ? text.search(/\?\s+\S/) : -1;
  const cut = nl >= 0 ? nl : q >= 0 ? q + 1 : -1;
  return confirmOptions({
    title: cut < 0 ? text : text.slice(0, cut),
    message: cut < 0 ? "" : text.slice(cut + 1),
  });
}

/** The whole question as one text (the browser fallback, and what a test reads). */
export function confirmText(opts) {
  return [opts.title, opts.message].filter(Boolean).join("\n\n");
}

let current = null; // { opts, resolve }
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(current ? current.opts : null));

/** The host subscribes; returns the unsubscribe. While nobody listens, confirmDialog uses the fallback. */
export function subscribeConfirm(fn) {
  listeners.add(fn);
  fn(current ? current.opts : null);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && current) answerConfirm(false);
  };
}

/**
 * Asks the question. Resolves true for the confirm button (or Enter), false for cancel, Escape, a click outside.
 * @param {string | { title?: string, message?: string, confirmText?: string, cancelText?: string, danger?: boolean }} input
 * @param {{ fallback?: (question: string) => boolean }} [options] what to ask when no window is mounted (tests)
 * @returns {Promise<boolean>}
 */
export function confirmDialog(input, { fallback } = {}) {
  const opts = confirmOptions(input);
  if (listeners.size === 0) {
    // eslint-disable-next-line no-restricted-properties -- the one fallback: no window mounted to ask in.
    const ask = fallback || (typeof window !== "undefined" && typeof window.confirm === "function" ? (q) => window.confirm(q) : () => false);
    return Promise.resolve(!!ask(confirmText(opts)));
  }
  return new Promise((resolve) => {
    const prev = current;
    current = { opts, resolve };
    prev?.resolve(false); // a second question replaces an open one → the first is "no"
    emit();
  });
}

// The event that answered the last question (the Escape or Enter key that closed it): it is still travelling to the
// page's own key listeners after the window is gone, and must not act there too.
let answeredBy = null;

/** The host's answer for the open question (nothing open → nothing happens). */
export function answerConfirm(answer) {
  const open = current;
  if (!open) return;
  current = null;
  answeredBy = (typeof window !== "undefined" && window.event) || null;
  open.resolve(!!answer);
  emit();
}

/**
 * True while a question is open. A page's keyboard shortcuts (the album editors' Delete, ⌘Z and arrows, the inbox's
 * D / E / Esc) check it with their key event, so a key pressed in the window never also acts on the page behind it —
 * including the Escape / Enter that answered it.
 * @param {Event} [event] the key event being handled
 */
export function isConfirmOpen(event) {
  if (current) return true;
  if (event && event === answeredBy) return true;
  return typeof document !== "undefined" && !!document.querySelector?.("[data-confirm-dialog]");
}
