import React, { useRef, useState } from "react";
import { Archive, Check } from "lucide-react";

// A chat row you can swipe like WhatsApp (2026-10-13, the owner's request). Touch only:
//   swipe right → "✓ טופל" · swipe left → ארכיון · press and hold (or right-click) → menu.
// A small move is still a tap; a mostly-vertical move is the list scrolling, left alone.
const TRIGGER = 80;
const LONG_PRESS_MS = 500;

export default function SwipeRow({ children, enabled = true, onSwipeRight, onSwipeLeft, onLongPress, rightLabel = "✓ טופל" }) {
  const [dx, setDx] = useState(0);
  const st = useRef({ x: 0, y: 0, axis: null, timer: null, moved: false, fired: false });

  const clearTimer = () => {
    if (st.current.timer) clearTimeout(st.current.timer);
    st.current.timer = null;
  };
  const onTouchStart = (e) => {
    if (!enabled) return;
    const t = e.touches[0];
    st.current = { x: t.clientX, y: t.clientY, axis: null, timer: null, moved: false, fired: false };
    if (onLongPress) {
      st.current.timer = setTimeout(() => {
        st.current.fired = true;
        if (navigator.vibrate) navigator.vibrate(10);
        onLongPress();
      }, LONG_PRESS_MS);
    }
  };
  const onTouchMove = (e) => {
    if (!enabled) return;
    const t = e.touches[0];
    const mx = t.clientX - st.current.x;
    const my = t.clientY - st.current.y;
    if (Math.abs(mx) > 8 || Math.abs(my) > 8) {
      st.current.moved = true;
      clearTimer();
    }
    if (!st.current.axis && (Math.abs(mx) > 10 || Math.abs(my) > 10)) st.current.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
    if (st.current.axis === "x") {
      if ((mx > 0 && !onSwipeRight) || (mx < 0 && !onSwipeLeft)) return;
      setDx(Math.max(-140, Math.min(140, mx)));
    }
  };
  const onTouchEnd = () => {
    clearTimer();
    if (dx >= TRIGGER) onSwipeRight?.();
    else if (dx <= -TRIGGER) onSwipeLeft?.();
    setDx(0);
  };
  // A swipe or a long press must not also open the chat.
  const onClickCapture = (e) => {
    if (st.current.moved || st.current.fired) {
      e.preventDefault();
      e.stopPropagation();
      st.current.moved = false;
      st.current.fired = false;
    }
  };

  return (
    <div className="relative overflow-hidden" onContextMenu={onLongPress ? (e) => { e.preventDefault(); onLongPress(); } : undefined}>
      {dx > 0 && (
        <div className={`absolute inset-y-0 left-0 flex items-center gap-1.5 px-5 text-sm font-semibold ${dx >= TRIGGER ? "bg-emerald-600 text-white" : "bg-emerald-900/60 text-emerald-200"}`} style={{ width: dx }}>
          <Check className="h-5 w-5 shrink-0" /> <span className="truncate">{rightLabel.replace("✓ ", "")}</span>
        </div>
      )}
      {dx < 0 && (
        <div className={`absolute inset-y-0 right-0 flex items-center justify-end gap-1.5 px-5 text-sm font-semibold ${dx <= -TRIGGER ? "bg-gray-500 text-white" : "bg-gray-700/60 text-gray-200"}`} style={{ width: -dx }}>
          <span className="truncate">ארכיון</span> <Archive className="h-5 w-5 shrink-0" />
        </div>
      )}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => { clearTimer(); setDx(0); }}
        onClickCapture={onClickCapture}
        className="relative bg-[#0C182D] transition-transform"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transitionDuration: dx ? "0ms" : "150ms" }}
      >
        {children}
      </div>
    </div>
  );
}
