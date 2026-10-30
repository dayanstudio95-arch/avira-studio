import { useCallback, useRef, useSyncExternalStore } from "react";

// Fixed bars at the bottom of a page (BotControlCenter's save bar, the films selection docks) and the
// Layout's floating "המשך הקמה" pill share the bottom-left corner: the pill used to sit on top of the
// save button. A page puts `ref={useBottomBar()}` on its bar; the Layout reads useBottomBarSpace() — how
// many pixels from the bottom of the window the highest such bar reaches — and floats the pill above it.

const heights = new Map();
const listeners = new Set();
let space = 0;
let nextId = 0;

function set(id, px) {
  if (px > 0) heights.set(id, px);
  else heights.delete(id);
  const next = Math.max(0, ...heights.values());
  if (next === space) return;
  space = next;
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// A callback ref for the fixed bar: the space is held while the bar is in the page (a bar shown only
// while something is selected frees it when it goes).
export function useBottomBar() {
  const stop = useRef(null);
  return useCallback((el) => {
    stop.current?.();
    stop.current = null;
    if (!el) return;
    const id = (nextId += 1);
    const measure = () => {
      const rect = el.getBoundingClientRect();
      set(id, rect.height > 0 ? Math.ceil(window.innerHeight - rect.top) : 0);
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    window.addEventListener("resize", measure);
    stop.current = () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      set(id, 0);
    };
  }, []);
}

export function useBottomBarSpace() {
  return useSyncExternalStore(subscribe, () => space, () => 0);
}
