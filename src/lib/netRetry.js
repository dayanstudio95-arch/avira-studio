// Retry a network step that can drop for a moment (album editor export, 2026-11-05). A 30-spread export downloads
// ~150 originals from Drive and uploads 60 files; one dropped request ("Failed to fetch") used to throw the whole
// export away. Retried: the connection dropping, 408 / 429 / 5xx, and Drive's rate limits. Not retried: anything
// else (a folder no longer shared, a file deleted…) — trying again can't fix those.

export const RETRY_DELAYS = [2000, 5000, 15000, 30000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isNetworkError(e) {
  if (!e) return false;
  if (e.name === "TypeError") return true; // fetch() itself: offline, connection reset, a response without CORS
  return /failed to fetch|networkerror|network error|load failed|network request failed|err_network|err_internet/i.test(String(e.message || ""));
}

export function isTransient(e) {
  if (!e) return false;
  if (e.transient) return true;
  const status = Number(e.status ?? e.statusCode);
  if (status === 408 || status === 429 || status >= 500) return true;
  return isNetworkError(e);
}

// fn() is called again after each delay while the error is transient. onRetry(n, error) before each wait.
export async function withRetry(fn, { delays = RETRY_DELAYS, retryable = isTransient, isCancelled = () => false, onRetry = () => {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delays.length || isCancelled() || !retryable(e)) throw e;
      onRetry(attempt + 1, e);
      await sleep(delays[attempt]);
      if (isCancelled()) throw e;
    }
  }
}

// What went wrong, in words, for the end of a Hebrew sentence. `drive`: a refused Drive download also looks like a
// dropped connection to the browser (no CORS headers on Google's 503), so it can't tell the two apart.
export function reasonText(e, { drive = false } = {}) {
  if (e?.hebrew) return e.message;
  if (isNetworkError(e)) return drive ? "גוגל דרייב לא ענה, או שהחיבור לאינטרנט נקטע" : "החיבור לאינטרנט נקטע";
  const status = Number(e?.status ?? e?.statusCode);
  if (status === 429 || e?.transient) return "גוגל ביקש להאט (יותר מדי הורדות ברצף)";
  if (status) return `שגיאה ${status}`;
  return e?.message || "שגיאה לא ידועה";
}
