export class ApiError extends Error {
  /** `data`: the whole answer (e.g. the saved album with an album save's 409, fix plan P57). */
  constructor(public status: number, message: string, public data: Record<string, unknown> | null = null) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, raw?: { blob: Blob; type: string }): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (raw) {
    init.body = raw.blob;
    (init.headers as Record<string, string>)['Content-Type'] = raw.type;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `שגיאה (${res.status})`;
    throw new ApiError(res.status, msg, (data as Record<string, unknown> | null) ?? null);
  }
  return data as T;
}
