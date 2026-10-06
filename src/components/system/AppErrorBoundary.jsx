import React from "react";
import { isChunkLoadError, reloadOnceForNewVersion } from "@/lib/staleBundle";

// UX-02 (audit 2026-10-05): without an error boundary, any render error left a blank white
// screen with no way out. Now: a stale-version error reloads once by itself (see
// staleBundle.js); anything else shows a short Hebrew message and a reload button.
export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[AppErrorBoundary]", error, info?.componentStack);
    if (isChunkLoadError(error)) reloadOnceForNewVersion();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div dir="rtl" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0f17", color: "#e5e7eb", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>משהו השתבש בטעינת המסך</h1>
          <p style={{ color: "#9ca3af", fontSize: 14, marginBottom: 20 }}>
            בדרך כלל טעינה מחדש פותרת את זה. שום מידע לא נמחק.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ background: "#facc15", color: "#111827", border: 0, borderRadius: 10, padding: "10px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
          >
            טען מחדש
          </button>
        </div>
      </div>
    );
  }
}
