// The Google Drive's space as the Drive helper reported it (2026-11-02, 0101): app_settings drive_storage_used /
// drive_storage_limit, in bytes. Shown on the galleries page and in Settings.

const TB = 1024 ** 4;
const GB = 1024 ** 3;

/** 1.2e12 → "1.1TB", 5.4e10 → "50GB". */
export function bytesText(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "";
  if (v >= TB) return `${(v / TB).toFixed(v >= 10 * TB ? 0 : 1).replace(/\.0$/, "")}TB`;
  return `${Math.round(v / GB)}GB`;
}

/** { used, limit, free, pct, level: 'ok' | 'high' | 'full' } or null when nothing (good) was reported. */
export function driveSpace(used, limit) {
  const u = Number(used);
  const l = Number(limit);
  if (!Number.isFinite(u) || !Number.isFinite(l) || l <= 0 || u < 0) return null;
  const pct = Math.min(100, Math.round((u / l) * 100));
  return { used: u, limit: l, free: Math.max(0, l - u), pct, level: pct >= 95 ? "full" : pct >= 85 ? "high" : "ok" };
}

/** "1.1TB בשימוש מתוך 2TB · נשארו 0.9TB", or '' when nothing was reported. */
export function driveSpaceText(used, limit) {
  const s = driveSpace(used, limit);
  return s ? `${bytesText(s.used)} בשימוש מתוך ${bytesText(s.limit)} · נשארו ${bytesText(s.free)}` : "";
}
