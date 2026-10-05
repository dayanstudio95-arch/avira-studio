import { supabase } from "@/api/supabaseClient";

// Push notifications for "אווירה צ'אט" on this device (stage 1ב, 2026-10-05).
//
// The application server key is PUBLIC by design (it is what the browser hands to Apple /
// Google); the matching private key lives only in the VAPID_KEYS_B64 Edge Function secret.
export const VAPID_PUBLIC_KEY = "BAbi4eMwIu2Zdj6_Ox-wRgW14K-8nQb2G4B9ILYFOp63Rrn6zSA_eJruu1-FnYpK4kUgKforDUOSW2XkEyI11Qs";

import { DEFAULT_PREFS, PREF_ROWS, mergePrefs } from "./pushPrefs";
export { DEFAULT_PREFS, PREF_ROWS, mergePrefs };

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyToBytes(b64url) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function registerChatServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw-chat.js", { scope: "/chat" });
  } catch (e) {
    console.error("service worker registration failed:", e);
    return null;
  }
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "אייפון";
  if (/iPad/.test(ua) || isIOS()) return "אייפד";
  if (/Android/.test(ua)) return "אנדרואיד";
  if (/Mac/.test(ua)) return "מק";
  if (/Windows/.test(ua)) return "מחשב Windows";
  return "מכשיר";
}

// This device's row, or null.
export async function currentSubscriptionRow() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/chat");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  const { data } = await supabase.from("push_subscriptions").select("*").eq("endpoint", sub.endpoint).maybeSingle();
  return data || null;
}

// Must be called from a tap (iOS allows the permission prompt only then).
export async function enablePush({ tenantId, userId, prefs }) {
  if (!pushSupported()) throw new Error("הדפדפן הזה לא תומך בהתראות");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("לא אושרו התראות. אפשר לשנות בהגדרות המכשיר.");
  const reg = (await registerChatServiceWorker()) || (await navigator.serviceWorker.ready);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) });
  const json = sub.toJSON();
  const row = {
    tenant_id: tenantId,
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    device_label: deviceLabel(),
    prefs: mergePrefs(prefs),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("push_subscriptions").upsert(row, { onConflict: "endpoint" }).select().single();
  if (error) throw error;
  return data;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration("/chat");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe().catch(() => {});
  }
}

export async function savePrefs(rowId, prefs) {
  const { error } = await supabase.from("push_subscriptions").update({ prefs: mergePrefs(prefs), updated_at: new Date().toISOString() }).eq("id", rowId);
  if (error) throw error;
}

export function setBadge(n) {
  try {
    if (!("setAppBadge" in navigator)) return;
    if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge();
  } catch { /* not supported */ }
}
