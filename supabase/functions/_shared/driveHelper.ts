// The owner's Google Drive helper (Avira, 2026-11-02; 0101): what the Apps Script may send drive-helper, checked.
// Pure — drive-helper reads and writes the database.

export const DRIVE_TOKEN_KEY = 'drive_helper_token_hash';
/** When the current script was made: work written before it is never handed out (an old removal stays put). */
export const DRIVE_CONNECTED_KEY = 'drive_helper_connected_at';
export const DRIVE_LAST_KEY = 'drive_helper_last_at';
export const DRIVE_USED_KEY = 'drive_storage_used';
export const DRIVE_LIMIT_KEY = 'drive_storage_limit';
/** Work older than this is not handed out: the owner meant it then, not weeks later. */
export const DRIVE_TASK_DAYS = 7;
export const DRIVE_TASKS_PER_RUN = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOLDER = /^[A-Za-z0-9_-]{10,100}$/;

export interface DriveResult {
  id: string;
  ok: boolean;
  error: string;
  prevParentId: string;
}

/** A whole number of bytes (0 … 10^16), or null. */
function bytes(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1e16 ? Math.floor(n) : null;
}

/** The script's report: the Drive's used / total space (when sent) and what each task came to. */
export function parseSync(body: unknown): { storage: { used: number; limit: number } | null; results: DriveResult[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const s = (b.storage && typeof b.storage === 'object' ? b.storage : null) as Record<string, unknown> | null;
  const used = s ? bytes(s.used) : null;
  const limit = s ? bytes(s.limit) : null;
  const results = (Array.isArray(b.results) ? b.results : [])
    .slice(0, 50)
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
    .filter((r) => UUID.test(String(r.id ?? '')))
    .map((r) => ({
      id: String(r.id),
      ok: r.ok === true,
      error: String(r.error ?? '').slice(0, 300),
      prevParentId: FOLDER.test(String(r.prevParentId ?? '')) ? String(r.prevParentId) : '',
    }));
  return { storage: used !== null && limit !== null ? { used, limit } : null, results };
}
