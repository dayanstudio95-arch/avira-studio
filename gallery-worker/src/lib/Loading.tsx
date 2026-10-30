/** A calm placeholder while a page loads: soft blocks in the shape of what's coming, no "loading…" text. */
export function Loading({ light = false }: { light?: boolean }) {
  return (
    <div className={`sk-screen${light ? ' light' : ''}`} role="status" aria-live="polite" data-testid="loading">
      <span className="sr-only">טוען</span>
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="sk-blocks">
        <div className="sk" />
        <div className="sk" />
        <div className="sk" />
      </div>
    </div>
  );
}

/** Something went wrong on the way (no internet, or the server hiccuped): say so and offer to try again. */
export function Offline({ onRetry, light = false }: { onRetry: () => void; light?: boolean }) {
  return (
    <div className={`sk-screen sk-center${light ? ' light' : ''}`} role="alert" data-testid="offline">
      <h1>אין חיבור כרגע</h1>
      <p>לא הצלחנו לטעון את הדף. בדקו את החיבור לאינטרנט ונסו שוב.</p>
      <button type="button" className="sk-retry" onClick={onRetry} data-testid="retry">
        נסו שוב
      </button>
    </div>
  );
}
