import { useEffect, useRef, type RefObject } from 'react';

/** Open windows, newest last: only the top one answers Esc and Tab. */
const stack: object[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A window over the page (full-screen photo, terms, video) that works from the keyboard and with
 * screen readers: focus moves into it, Tab stays inside, Esc closes, and focus returns to where it
 * was. Give the element role="dialog" and aria-modal="true".
 */
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, opts: { escape?: boolean } = {}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const me = {};
    stack.push(me);
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const first = box?.querySelector<HTMLElement>('[data-autofocus]') ?? box?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === 'Escape' && opts.escape !== false) {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      stack.splice(stack.indexOf(me), 1);
      document.removeEventListener('keydown', onKey);
      before?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * The phone's (or browser's) Back button closes a window instead of leaving the page: opening
 * adds a step to the history, Back removes it.
 */
export function useBackCloses(open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  const pushed = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (!pushed.current) {
      window.history.pushState({ ...(window.history.state ?? {}), overlay: true }, '');
      pushed.current = true;
    }
    const onPop = () => {
      pushed.current = false;
      close.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open]);
  /** Closing from a button: take back the step that opening added. */
  return () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else close.current();
  };
}
