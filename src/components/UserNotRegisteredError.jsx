import React from 'react';
import { useAuth } from '@/lib/SupabaseAuthContext';

// Shown only when the login works but no studio profile exists for it (2026-10-14: a
// failed lookup now shows AuthConnectionError instead). Hebrew, with a way out.
const UserNotRegisteredError = () => {
  const { logout } = useAuth();
  return (
    <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-orange-500/15 text-2xl">⚠️</div>
        <h1 className="mb-3 text-2xl font-bold text-white">אין גישה למערכת</h1>
        <p className="mb-6 text-gray-300">החשבון הזה לא משויך לאף סטודיו. אם זו טעות — התחברו עם החשבון הנכון, או בקשו מבעל הסטודיו להוסיף אתכם.</p>
        <button type="button" onClick={() => logout(true)} className="w-full rounded-xl bg-yellow-400 py-3 font-semibold text-gray-900 hover:bg-yellow-300">
          התנתק והתחבר מחדש
        </button>
      </div>
    </div>
  );
};

export default UserNotRegisteredError;
