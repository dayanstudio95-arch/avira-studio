import type { TouchEvent as ReactTouchEvent } from 'react';

/** Where a photo was dropped: a slot of the open page, or a page in the strip. */
export interface DropTarget {
  slot?: number;
  page?: number;
}

/**
 * Dragging a photo with a finger (phones and tablets don't do the browser's drag and drop):
 * press and hold on a photo, and it lifts and follows the finger; let go over a slot or a page.
 * A quick swipe still scrolls the photos as usual. Targets carry `data-slot` / `data-drop-page`.
 */
export function touchDrag(src: string, onDrop: (target: DropTarget) => void, disabled = false) {
  return {
    onTouchStart(e: ReactTouchEvent) {
      if (disabled || e.touches.length !== 1) return;
      const start = e.touches[0];
      const sx = start.clientX;
      const sy = start.clientY;
      let dragging = false;
      let ghost: HTMLImageElement | null = null;
      let over: HTMLElement | null = null;

      const place = (x: number, y: number) => {
        if (ghost) ghost.style.transform = `translate(${x - 40}px, ${y - 40}px)`;
      };
      const timer = window.setTimeout(() => {
        dragging = true;
        navigator.vibrate?.(15);
        ghost = document.createElement('img');
        ghost.src = src;
        ghost.className = 'touch-ghost';
        ghost.alt = '';
        document.body.appendChild(ghost);
        place(sx, sy);
      }, 320);

      const cleanup = () => {
        window.clearTimeout(timer);
        ghost?.remove();
        over?.classList.remove('drop-over');
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', cleanup);
      };
      const move = (ev: TouchEvent) => {
        const t = ev.touches[0];
        if (!dragging) {
          // Moving before the hold ends = scrolling, not dragging.
          if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) cleanup();
          return;
        }
        ev.preventDefault();
        place(t.clientX, t.clientY);
        const target = (document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-slot],[data-drop-page]') ?? null;
        if (target !== over) {
          over?.classList.remove('drop-over');
          target?.classList.add('drop-over');
          over = target;
        }
      };
      const end = (ev: TouchEvent) => {
        if (dragging) {
          ev.preventDefault(); // no click after a drag
          if (over?.dataset.slot !== undefined) onDrop({ slot: Number(over.dataset.slot) });
          else if (over?.dataset.dropPage !== undefined) onDrop({ page: Number(over.dataset.dropPage) });
        }
        cleanup();
      };
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', end);
      document.addEventListener('touchcancel', cleanup);
    },
    onContextMenu(e: { preventDefault: () => void }) {
      // Holding a photo would otherwise open the phone's image menu.
      e.preventDefault();
    },
  };
}
