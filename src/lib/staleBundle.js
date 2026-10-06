// UX-02 (audit 2026-10-05): after a deploy the browser may still run the previous version,
// whose lazily-loaded screens point at files that no longer exist on the server → the next
// screen fails to load and the user sees a white page. Reload once to get the new version.
// Guarded so a real, persistent failure cannot cause a reload loop.
const KEY = "avira:stale-bundle-reload-at";
const MIN_GAP_MS = 60 * 1000;

export function isChunkLoadError(error) {
  const msg = String(error?.message || error || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \S+ failed/i.test(msg);
}

export function reloadOnceForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < MIN_GAP_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked — still reload once; the guard is best-effort */
  }
  window.location.reload();
  return true;
}

export function installStaleBundleReload() {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceForNewVersion()) event.preventDefault();
  });
}
