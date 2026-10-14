import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/SupabaseAuthContext';

// The profile lookup failed (network, expired login, a server hiccup) — 2026-10-14. Before,
// this showed "you are not registered" and stayed there. Now: it says what happened, tries
// again by itself every 15 seconds (5 times), and offers "נסה שוב" and a fresh login. The
// error text is shown small so a screenshot tells us what failed.
const AUTO_RETRY_SECONDS = 15;
const MAX_AUTO_RETRIES = 5;

export default function AuthConnectionError({ error }) {
  const { retryAuth, logout } = useAuth();
  const [left, setLeft] = useState(AUTO_RETRY_SECONDS);
  const [tries, setTries] = useState(() => {
    try { return Number(sessionStorage.getItem('auth_auto_retries') || 0); } catch { return 0; }
  });
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  useEffect(() => {
    if (tries >= MAX_AUTO_RETRIES) return undefined;
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [tries]);

  useEffect(() => {
    if (left > 0 || tries >= MAX_AUTO_RETRIES) return;
    const next = tries + 1;
    setTries(next);
    try { sessionStorage.setItem('auth_auto_retries', String(next)); } catch { /* private mode */ }
    setLeft(AUTO_RETRY_SECONDS);
    retryAuth();
  }, [left, tries, retryAuth]);

  return (
    <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/15 text-2xl">📡</div>
        <h1 className="mb-3 text-2xl font-bold text-white">בעיית חיבור למערכת</h1>
        <p className="mb-2 text-gray-300">
          {offline ? 'נראה שאין חיבור לאינטרנט במכשיר הזה.' : 'לא הצלחנו לטעון את החשבון שלך. בדרך כלל זה זמני.'}
        </p>
        {tries < MAX_AUTO_RETRIES ? (
          <p className="mb-6 text-sm text-gray-500">מנסה שוב בעוד {left} שניות…</p>
        ) : (
          <p className="mb-6 text-sm text-gray-500">אם זה לא עובר — נסו "התנתק והתחבר מחדש".</p>
        )}
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => { setLeft(AUTO_RETRY_SECONDS); retryAuth(); }} className="w-full rounded-xl bg-yellow-400 py-3 font-semibold text-gray-900 hover:bg-yellow-300">
            נסה שוב
          </button>
          <button type="button" onClick={() => logout(true)} className="w-full rounded-xl border border-gray-700 py-3 text-gray-200 hover:bg-gray-800">
            התנתק והתחבר מחדש
          </button>
        </div>
        {error?.message && (
          <p className="mt-5 break-words text-xs text-gray-600" dir="ltr">
            {error.code ? `[${error.code}] ` : ''}{error.message}
          </p>
        )}
      </div>
    </div>
  );
}
