// Studio-wide settings the album editor reads (2026-10-08):
//  - branding for the opening spread: logo + a QR to the studio's Instagram + phone — taken from
//    Settings → studio details (tenants.logo_url / instagram_url / phone), nothing typed twice;
//  - layout presets ("⭐ שמור כפריסט"): saved sketch layouts, in app_settings 'album_layout_presets'.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";

export async function brandingFor({ logoUrl, instagramUrl, phone }) {
  let qrDataUrl = null;
  if (instagramUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(instagramUrl, { margin: 0, width: 600, errorCorrectionLevel: "M", color: { dark: "#333333", light: "#ffffff00" } });
    } catch {
      qrDataUrl = null;
    }
  }
  return { logoUrl: logoUrl || null, qrDataUrl, phone: phone || null };
}

export function useStudioBranding(tenantId) {
  const [state, setState] = useState({ data: null, ready: false });
  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    supabase
      .from("tenants")
      .select("logo_url, instagram_url, phone")
      .eq("id", tenantId)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!alive || !data) return;
        const b = await brandingFor({ logoUrl: data.logo_url, instagramUrl: data.instagram_url, phone: data.phone });
        if (alive) setState({ data: b, ready: Boolean(b.logoUrl && b.qrDataUrl && b.phone) });
      });
    return () => {
      alive = false;
    };
  }, [tenantId]);
  return state;
}

const PRESETS_KEY = "album_layout_presets";

export async function loadPresets() {
  const rows = await base44.entities.AppSetting.filter({ key: PRESETS_KEY }).catch(() => []);
  try {
    const list = JSON.parse(rows?.[0]?.value || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function savePresetToSettings(preset) {
  const rows = await base44.entities.AppSetting.filter({ key: PRESETS_KEY });
  let list = [];
  try {
    list = JSON.parse(rows?.[0]?.value || "[]");
  } catch {
    list = [];
  }
  const next = JSON.stringify([...list.filter((p) => p.name !== preset.name), preset].slice(-30));
  if (rows?.[0]) await base44.entities.AppSetting.update(rows[0].id, { value: next });
  else await base44.entities.AppSetting.create({ key: PRESETS_KEY, value: next });
}
